import { z } from 'zod';

// Helper for strict 80-char string sanitization
const addressField = (min = 1, max = 80) =>
  z.string()
    .trim()
    .min(min, `Field must be at least ${min} characters`)
    .max(max, `Field must not exceed ${max} characters`);

const optionalAddressField = (max = 80) =>
  z.string()
    .trim()
    .max(max, `Field must not exceed ${max} characters`)
    .optional()
    .default('');

// 6-digit Indian PIN code
export const pincodeSchema = z.string()
  .trim()
  .regex(/^\d{6}$/, 'PIN code must be exactly 6 digits');

// 10-digit Indian Mobile number
export const mobileSchema = z.string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Mobile number must be a valid 10-digit Indian phone number');

// 13-character India Post Barcode / AWB
export const barcodeSchema = z.string()
  .trim()
  .regex(/^[A-Z]{2}\d{9}[A-Z]{2}$/, 'Barcode must be a valid 13-character India Post format (e.g. EB468827991IN)');

export const articleTypeEnum = z.enum([
  'SP_INLAND_DOC',
  'SP_INLAND_PARCEL',
  'SP',
  'BUSINESS_PARCEL',
  'BP',
  '24_SPEEDPOST_DOC',
  '24_SPP_PARSPL',
  '48_SPEEDPOST_DOC',
]);

// Single Article Booking Schema
export const indiaPostArticleSchema = z.object({
  bulk_customer_id: z.string().default('3000064781'),
  contract_id: z.string().default('41585456'),
  barcode_no: z.string().min(5).max(50),
  pickup_or_dropoff: z.enum(['PICKUP', 'DROPOFF', 'pickup', 'dropoff']).default('DROPOFF'),
  pickup_dropoff_office_id: z.coerce.number().default(21260024),
  article_type: articleTypeEnum.default('SP_INLAND_PARCEL'),
  physical_weight: z.coerce.number().int().min(1).max(35000, 'Physical weight must be between 1g and 35,000g'),
  shape_of_article: z.enum(['DOC', 'ROLL', 'NROL', '']).default('NROL'),
  length: z.coerce.number().min(0).max(150).default(20),
  breadth_diameter: z.coerce.number().min(0).max(150).default(15),
  height: z.coerce.number().min(0).max(150).default(5),
  priority_flag: z.enum(['TRUE', 'FALSE', '']).default(''),
  delivery_instruction: z.enum(['ND', 'OD', 'SD', '']).default(''),
  delivery_slot: z.enum(['9am-2pm', '2pm-5pm', '5pm-8pm', '']).default(''),
  instruction_rts: z.enum(['RTS', 'RTA', '']).default('RTS'),
  
  // Sender Details (80 chars max)
  sender_name: addressField(3, 80),
  sender_company: optionalAddressField(80),
  sender_add_line_1: addressField(3, 80),
  sender_add_line_2: optionalAddressField(80),
  sender_city: addressField(2, 80),
  sender_state: optionalAddressField(80),
  sender_pincode: pincodeSchema,
  sender_emailid: z.string().email().or(z.literal('')).optional().default(''),
  sender_mobile_no: mobileSchema,
  
  // Receiver Details (80 chars max)
  receiver_name: addressField(3, 80),
  receiver_company: optionalAddressField(80),
  receiver_add_line_1: addressField(3, 80),
  receiver_add_line_2: optionalAddressField(80),
  receiver_city: addressField(2, 80),
  receiver_state: optionalAddressField(80),
  receiver_pincode: pincodeSchema,
  receiver_emailid: z.string().email().or(z.literal('')).optional().default(''),
  receiver_mobile_no: mobileSchema,

  // Flags & Optional Services
  alt_address_flag: z.enum(['TRUE', 'FALSE']).default('FALSE'),
  pickup_address_flag: z.enum(['TRUE', 'FALSE', '']).default('FALSE'),
  drop_off_pincode: pincodeSchema.optional().default('600001'),
  prepayment_code: z.string().optional().default(''),
  value_of_prepayment: z.coerce.number().default(0),
  codr_cod: z.string().optional().default(''),
  value_for_codr_cod: z.coerce.number().optional().default(0),
  insurance_type: z.string().optional().default(''),
  value_of_insurance: z.coerce.number().default(0),
  ack: z.enum(['TRUE', 'FALSE']).default('FALSE'),
  reg: z.enum(['TRUE', 'FALSE']).default('FALSE'),
  otp: z.enum(['TRUE', 'FALSE']).default('FALSE'),
  bulk_reference: z.string().max(24).optional().default(''),
});

// Bulk Booking Payload Schema
export const indiaPostBulkBookingSchema = z.object({
  articles: z.array(indiaPostArticleSchema).min(1).max(1000),
});

// Tariff Calculation Request Schema
export const indiaPostTariffRequestSchema = z.object({
  productCode: z.enum(['SP', 'BP', '24_SPEEDPOST_DOC', '24_SPP_PARSPL', '48_SPEEDPOST_DOC']).default('SP'),
  weight: z.coerce.number().int().min(1).max(35000),
  sourcePincode: pincodeSchema,
  destinationPincode: pincodeSchema,
  length: z.coerce.number().min(0).max(150).optional().default(20),
  width: z.coerce.number().min(0).max(150).optional().default(15),
  height: z.coerce.number().min(0).max(150).optional().default(3),
  declaredValue: z.coerce.number().optional().default(0),
  isCOD: z.boolean().optional().default(false),
  codValue: z.coerce.number().optional().default(0),
});

// Webhook Payload Schema
export const indiaPostWebhookPayloadSchema = z.object({
  article_number: z.string().min(5),
  article_type: z.string().optional(),
  event_date: z.string().optional(),
  event_time: z.string().optional(),
  event_office_facility_id: z.string().or(z.number()).optional(),
  event_office_name: z.string().optional(),
  event_code: z.string(),
  event_description: z.string().optional(),
  non_delivery_reason: z.string().optional(),
  booking_ref_id: z.string().or(z.number()).optional(),
  destination_pincode: z.string().or(z.number()).optional(),
  destination_city: z.string().optional(),
  receiver_name: z.string().optional(),
  tariff: z.coerce.number().optional(),
  cod_amount: z.coerce.number().optional(),
  bulk_customer_id: z.string().or(z.number()).optional(),
});

export type TariffResponse = {
  success: boolean;
  message?: string;
  data?: any;
};

export type PostOfficeDetail = {
  pincode: number;
  office_name: string;
  office_id?: string;
  office_type_code?: string;
  state_name: string;
  delivery_office_flag?: boolean;
  city_name?: string;
  taluk_name?: string;
  village_name?: string;
  is_rolled_out?: boolean;
};

export type ArticleTrackingResult = {
  article_number: string;
  status: string;
  tracking?: any;
};
