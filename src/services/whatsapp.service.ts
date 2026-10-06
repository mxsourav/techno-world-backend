import axios from 'axios';
import { env } from '../config/env.js';

export interface B2BEnquiryWhatsAppDetails {
  enquiryId: string;
  organizationName: string;
  representativeName: string;
  email: string;
  phone: string;
  timeline: string | null;
  requirements: string;
  attachedCartItemCount: number;
}

interface WhatsAppMessageResponse {
  messages?: Array<{ id?: string }>;
}

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

class WhatsAppService {
  public async sendB2BEnquiryAlert(details: B2BEnquiryWhatsAppDetails): Promise<void> {
    const { WHATSAPP_META_ACCESS_TOKEN: accessToken, WHATSAPP_META_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_ADMIN_PHONE_NUMBER: adminPhoneNumber } = env;

    if (!accessToken || !phoneNumberId || !adminPhoneNumber) {
      return;
    }

    const recipient = adminPhoneNumber.replace(/[^\d]/g, '');
    if (recipient.length < 8) {
      throw new Error('WHATSAPP_ADMIN_PHONE_NUMBER must contain an E.164 phone number');
    }

    const templateName = env.WHATSAPP_META_TEMPLATE_NAME;
    const payload = templateName
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: env.WHATSAPP_META_TEMPLATE_LANGUAGE },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: truncate(details.organizationName, 100) },
                  { type: 'text', text: truncate(details.representativeName, 100) },
                  { type: 'text', text: truncate(details.phone, 40) },
                  { type: 'text', text: truncate(details.requirements, 500) },
                  { type: 'text', text: details.enquiryId.slice(0, 8).toUpperCase() },
                ],
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: {
            preview_url: false,
            body: truncate(
              `New B2B enquiry\n\n` +
                `Organization: ${details.organizationName}\n` +
                `Representative: ${details.representativeName}\n` +
                `Phone: ${details.phone}\n` +
                `Email: ${details.email}\n` +
                `Timeline: ${details.timeline || 'Not specified'}\n` +
                `Requirements: ${details.requirements}\n` +
                `Books attached: ${details.attachedCartItemCount}\n` +
                `Enquiry ID: ${details.enquiryId}`,
              4096
            ),
          },
        };

    const response = await axios.post<WhatsAppMessageResponse>(
      `https://graph.facebook.com/${env.WHATSAPP_META_API_VERSION}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );

    if (!response.data.messages?.[0]?.id) {
      throw new Error('Meta WhatsApp API returned no message ID');
    }
  }
}

export const whatsappService = new WhatsAppService();
