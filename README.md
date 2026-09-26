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
