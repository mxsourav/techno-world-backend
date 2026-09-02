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
