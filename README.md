# ⚙️ Techno World Server — Backend API & Database

Node.js Express (TypeScript ESM) backend powering the Techno World Books e-commerce platform.

## 🛠️ Architecture
- **Framework**: Express.js with TypeScript ESM
- **ORM & DB**: Prisma ORM with SQLite (`prisma/dev.db`) / PostgreSQL
- **Security**: Argon2 password hashing, dual-token JWT cookies (`httpOnly`), Zod schemas
- **Email Engine**: Resilient SMTP dispatcher with database Outbox fallback (`EmailLog`)
- **Shipping Engine**: India Post Speed Post dynamic zone/weight calculator

## 🚀 Commands
```bash
# Install dependencies
npm install

# Generate Prisma Client & Sync DB
npx prisma generate
npx prisma db push

# Seed Sample Catalog
npx tsx prisma/seed.ts

# Start Dev Server (with hot reloading)
npm run dev

# Open Visual Database GUI
npx prisma studio
```

## 📚 API Documentation
- Interactive Swagger docs: [http://localhost:5000/docs](http://localhost:5000/docs)

## 💳 Razorpay Payments
Set these server environment variables with Razorpay **Test Mode** credentials before accepting online payments:

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Configure this webhook in the Razorpay dashboard:
`https://<your-api-host>/api/v1/payments/razorpay/webhook`

The checkout receives the public key from the server, so moving to production only requires replacing the three server-side values with the corresponding Live Mode values. Never expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` to the frontend.

## Cloudinary and webhook security

Cloudinary is configured only from the server environment. Define all three values in `.env`; there are no source-code fallbacks:

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Configure the number of trusted reverse-proxy hops explicitly. Leave it at `0` when the server is directly exposed; set it to the actual proxy count in production:

```env
TRUST_PROXY_HOPS=0
```

India Post webhook requests require both a configured shared secret and an IP allowlist. The webhook is rejected when either is missing:

```env
INDIAPOST_WEBHOOK_SECRET=...
INDIAPOST_ALLOWED_IPS=203.0.113.10
```

## WhatsApp B2B enquiry alerts

After a B2B enquiry is saved, the API can send an alert to the institutional sales admin through the Meta WhatsApp Cloud API. Add these server-side environment variables when the Meta app and WhatsApp business phone number are ready:

```env
WHATSAPP_META_ACCESS_TOKEN=EA...
WHATSAPP_META_PHONE_NUMBER_ID=1234567890
WHATSAPP_ADMIN_PHONE_NUMBER=919876543210
WHATSAPP_META_API_VERSION=v21.0
```

`WHATSAPP_ADMIN_PHONE_NUMBER` must be in international format (country code included, without spaces). The alert uses a plain text message when the Meta account allows it. For business-initiated messages outside WhatsApp's 24-hour customer-service window, create an approved Meta template and configure it:

```env
WHATSAPP_META_TEMPLATE_NAME=b2b_enquiry_alert
WHATSAPP_META_TEMPLATE_LANGUAGE=en_US
```

The approved template must contain five body text placeholders in this order: organization name, representative name, phone, requirements, and enquiry ID. WhatsApp delivery is best-effort: a Meta outage or missing configuration is logged and does not make a successfully saved enquiry fail.
