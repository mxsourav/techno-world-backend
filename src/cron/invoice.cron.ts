import { logger } from '../config/logger.js';
import { generateBatchInvoices } from '../services/invoice.service.js';

let lastRunDateStr = '';
let cronInterval: NodeJS.Timeout | null = null;

/**
 * Checks every minute whether current time is 2:15 PM (14:15) IST.
 * At 2:15 PM IST (15 minutes after the 2:00 PM daily dispatch batch cutoff),
 * it generates invoice numbers for all eligible confirmed/processing/shipped orders.
 */
export function startInvoiceCron(): void {
  if (cronInterval) {
    return;
  }

  logger.info('[INVOICE_CRON] Scheduled daily batch invoice generator initialized (runs at 14:15 IST).');

  cronInterval = setInterval(async () => {
    try {
      const now = new Date();
      // Format in Asia/Kolkata timezone
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      // Formats as YYYY-MM-DD, HH:mm
      const parts = formatter.formatToParts(now);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      const hour = parts.find(p => p.type === 'hour')?.value;
      const minute = parts.find(p => p.type === 'minute')?.value;

      const todayStr = `${year}-${month}-${day}`;

      if (hour === '14' && minute === '15' && lastRunDateStr !== todayStr) {
        lastRunDateStr = todayStr;
        logger.info(`[INVOICE_CRON] 2:15 PM IST reached for ${todayStr}. Running batch invoice generation...`);
        const result = await generateBatchInvoices();
        logger.info(`[INVOICE_CRON] Completed: Generated ${result.generated} invoices. Errors: ${result.errors.length}`);
        if (result.errors.length > 0) {
          logger.warn(`[INVOICE_CRON] Batch errors: ${result.errors.join('; ')}`);
        }
      }
    } catch (err: any) {
      logger.error('[INVOICE_CRON] Error executing scheduled invoice task:', err);
    }
  }, 60 * 1000); // Check every 60 seconds
}

export function stopInvoiceCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    logger.info('[INVOICE_CRON] Scheduled invoice cron stopped.');
  }
}
