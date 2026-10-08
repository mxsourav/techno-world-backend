import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { TicketDepartment } from '@prisma/client';

export interface ImapAccountConfig {
  department: TicketDepartment;
  user: string;
  pass: string;
  host: string;
  port: number;
  secure: boolean;
}

export class ImapService {
  private static instance: ImapService;
  private pollTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;

  private constructor() {}

  public static getInstance(): ImapService {
    if (!ImapService.instance) {
      ImapService.instance = new ImapService();
    }
    return ImapService.instance;
  }

  /**
   * Resolves IMAP account configs for support@ and team@
   */
  public getAccountConfigs(): ImapAccountConfig[] {
    const host = env.IMAP_HOST || 'imap.hostinger.com';
    const port = Number(env.IMAP_PORT) || 993;
    const secure = port === 993;

    const supportUser = (env.SMTP_SUPPORT_USER || 'support@technoworldbooks.in').trim();
    const supportPass = (env.IMAP_PASS_SUPPORT || env.SMTP_PASSWORD || env.SMTP_PASS || '').trim();

    const teamUser = (env.SMTP_TEAM_USER || 'team@technoworldbooks.in').trim();
    const teamPass = (env.IMAP_PASS_TEAM || env.SMTP_PASSWORD || env.SMTP_PASS || '').trim();

    const configs: ImapAccountConfig[] = [];

    if (supportUser && supportPass) {
      configs.push({
        department: 'SUPPORT',
        user: supportUser,
        pass: supportPass,
        host,
        port,
        secure,
      });
    }

    if (teamUser && teamPass) {
      configs.push({
        department: 'TEAM',
        user: teamUser,
        pass: teamPass,
        host,
        port,
        secure,
      });
    }

    return configs;
  }

  /**
   * Generates a human-friendly ticket ID: TKT-YYYYMMDD-XXXX
   */
  private generateTicketId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `TKT-${year}${month}${day}-${randomSuffix}`;
  }

  /**
   * Attempts to extract order number from text or subject
   * Patterns like ORD-TW-2026-..., TW-123456, or [REF:ORD-...]
   */
  private extractOrderNumber(text: string): string | null {
    if (!text) return null;
    const directMatch = text.match(/\[REF:ORD-([^\]]+)\]/i);
    if (directMatch && directMatch[1]) return directMatch[1].trim();

    const standardMatch = text.match(/(?:ORD[-_]?TW[-_]?[0-9A-Z]+|TW[-_]?[0-9]{4,10})/i);
    if (standardMatch) return standardMatch[0].trim();

    return null;
  }

  /**
   * Syncs a single IMAP mailbox safely without throwing uncaught errors
   */
  private async syncMailbox(account: ImapAccountConfig): Promise<number> {
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
      logger: false, // Suppress raw socket dumps in console
      emitLogs: false,
    });

    let processedCount = 0;

    try {
      await client.connect();

      // Open INBOX with lock
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Fetch unseen messages
        const searchCriteria = { seen: false };
        const messages = client.fetch(searchCriteria, {
          uid: true,
          flags: true,
          envelope: true,
          source: true,
        });

        for await (const message of messages) {
          try {
            if (!message.source) continue;

            const parsed = await simpleParser(message.source);
            const rfcMessageId = parsed.messageId?.trim() || `<uid-${message.uid}-${account.user}>`;

            // 1. Deduplication check: check if messageId already recorded
            const existingMessage = await prisma.ticketMessage.findUnique({
              where: { messageId: rfcMessageId },
            });

            if (existingMessage) {
              // Mark as seen and continue
              await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen']);
              continue;
            }

            const senderAddress = parsed.from?.value?.[0]?.address?.toLowerCase().trim() || '';
            const senderName = parsed.from?.value?.[0]?.name?.trim() || '';
            const subject = parsed.subject?.trim() || '(No Subject)';
            const bodyText = parsed.text?.trim() || '(No content)';
            const bodyHtml = parsed.html ? String(parsed.html) : undefined;
            const messageDate = parsed.date ? new Date(parsed.date) : new Date();

            // Extract references for thread matching
            const inReplyTo = parsed.inReplyTo?.trim() || null;
            let references: string[] = [];
            if (Array.isArray(parsed.references)) {
              references = parsed.references.map((r) => r.trim()).filter(Boolean);
            } else if (typeof parsed.references === 'string') {
              references = [parsed.references.trim()];
            }

            // 2. Thread Matching logic:
            // A) Check by Message-ID references in existing messages
            let matchedTicketId: string | null = null;
            const refIdsToSearch = [inReplyTo, ...references].filter(Boolean) as string[];

            if (refIdsToSearch.length > 0) {
              const matchedMessage = await prisma.ticketMessage.findFirst({
                where: { messageId: { in: refIdsToSearch } },
                select: { ticketId: true },
              });
              if (matchedMessage) {
                matchedTicketId = matchedMessage.ticketId;
              }
            }

            // B) If not matched, check subject for ticket pattern e.g. [TKT-20261008-5481]
            if (!matchedTicketId) {
              const ticketTagMatch = subject.match(/\[(TKT-[A-Z0-9-]+)\]/i);
              if (ticketTagMatch && ticketTagMatch[1]) {
                const foundTicket = await prisma.ticket.findUnique({
                  where: { ticketId: ticketTagMatch[1].trim() },
                  select: { id: true },
                });
                if (foundTicket) {
                  matchedTicketId = foundTicket.id;
                }
              }
            }

            // Extract potential order reference
            const detectedOrder =
              this.extractOrderNumber(subject) || this.extractOrderNumber(bodyText);

            if (matchedTicketId) {
              // Append to existing thread and reopen ticket
              await prisma.$transaction([
                prisma.ticketMessage.create({
                  data: {
                    ticketId: matchedTicketId,
                    sender: 'CUSTOMER',
                    body: bodyText,
                    htmlBody: bodyHtml,
                    messageId: rfcMessageId,
                    timestamp: messageDate,
                  },
                }),
                prisma.ticket.update({
                  where: { id: matchedTicketId },
                  data: {
                    status: 'OPEN', // Customer response re-opens ticket
                    updatedAt: new Date(),
                    ...(detectedOrder ? { orderNumber: detectedOrder } : {}),
                  },
                }),
              ]);
            } else {
              // New ticket creation
              // Try to link customer from User table
              const linkedUser = senderAddress
                ? await prisma.user.findUnique({
                    where: { email: senderAddress },
                    select: { id: true, name: true },
                  })
                : null;

              const newTicketCode = this.generateTicketId();

              await prisma.ticket.create({
                data: {
                  ticketId: newTicketCode,
                  customerId: linkedUser?.id || null,
                  customerEmail: senderAddress || 'anonymous@unknown.com',
                  customerName: linkedUser?.name || senderName || 'Customer',
                  department: account.department,
                  subject,
                  status: 'OPEN',
                  orderNumber: detectedOrder,
                  messages: {
                    create: [
                      {
                        sender: 'CUSTOMER',
                        body: bodyText,
                        htmlBody: bodyHtml,
                        messageId: rfcMessageId,
                        timestamp: messageDate,
                      },
                    ],
                  },
                },
              });
            }

            // Flag message as \Seen in IMAP
            await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen']);
            processedCount++;
          } catch (itemErr: any) {
            logger.error(`Error processing email uid ${message.uid} for ${account.user}: ${itemErr.message}`);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err: any) {
      logger.warn(`IMAP sync failed for ${account.user}: ${err.message}`);
    }

    return processedCount;
  }

  /**
   * Main sync function across all configured accounts
   */
  public async syncInboxes(): Promise<{ processedCount: number; errors: string[] }> {
    if (this.isSyncing) {
      return { processedCount: 0, errors: ['Sync already in progress'] };
    }

    this.isSyncing = true;
    let totalProcessed = 0;
    const errors: string[] = [];

    try {
      const accounts = this.getAccountConfigs();
      if (accounts.length === 0) {
        logger.info('No IMAP accounts configured with valid credentials; skipping sync.');
        return { processedCount: 0, errors: ['No credentials provided for IMAP mailboxes'] };
      }

      for (const account of accounts) {
        try {
          const count = await this.syncMailbox(account);
          totalProcessed += count;
        } catch (accErr: any) {
          errors.push(`${account.user}: ${accErr.message}`);
        }
      }
    } finally {
      this.isSyncing = false;
    }

    return { processedCount: totalProcessed, errors };
  }

  /**
   * Starts background recurring polling
   */
  public startPolling(): void {
    if (this.pollTimer) return;

    const intervalMs = Math.max(30000, Number(env.IMAP_POLL_INTERVAL_MS) || 120000);
    logger.info(`Starting IMAP Helpdesk listener polling every ${intervalMs / 1000}s`);

    // Run initial sync after a short startup delay
    setTimeout(() => {
      this.syncInboxes().catch((err) => {
        logger.warn(`Initial IMAP sync warning: ${err.message}`);
      });
    }, 5000);

    this.pollTimer = setInterval(() => {
      this.syncInboxes().catch((err) => {
        logger.warn(`Scheduled IMAP sync warning: ${err.message}`);
      });
    }, intervalMs);
  }

  /**
   * Stops background recurring polling
   */
  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info('IMAP Helpdesk listener stopped');
    }
  }
}

export const imapService = ImapService.getInstance();
