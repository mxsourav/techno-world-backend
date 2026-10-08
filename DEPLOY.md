# Techno World Backend - Deployment Guide

This repository contains the standalone Express + TypeScript + Prisma backend service for Techno World Books.

## Local Development

`ash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Generate Prisma client & sync schema
npm run db:generate
npm run db:push

# 4. Start development server
npm run dev
`

---

## Google Cloud VM Deployment

Connect to the GCP compute instance:

`ash
gcloud compute ssh instance-20260923-151813 --zone=asia-south1-a
`

Inside the VM, clone and start the standalone backend:

`ash
# 1. Clone the dedicated backend repository
cd /home/technoworldbookswebsite
git clone https://github.com/mxsourav/techno-world-backend.git

# 2. Copy the production .env file
cp /home/technoworldbookswebsite/my-app/server/.env /home/technoworldbookswebsite/techno-world-backend/.env

# 3. Install dependencies and build
cd /home/technoworldbookswebsite/techno-world-backend
npm install
npx prisma generate
npx prisma db push
npm run build

# 4. Update and restart PM2 process
pm2 delete server || true
pm2 start dist/server.js --name server
pm2 save
`

---

## Future Updates on GCP VM

`ash
cd /home/technoworldbookswebsite/techno-world-backend
git pull origin main
npm install --production=false
npx prisma generate
npm run build
pm2 restart server
`

---

## GitHub Actions Auto-Deployment Setup

An example deployment workflow is provided in deploy.yml.example.

To enable automated deployments on git push:
1. Copy deploy.yml.example to .github/workflows/deploy.yml on GitHub.
2. In your GitHub repository settings under **Settings > Secrets and variables > Actions**, add:
   - GCP_VM_HOST: Your VM external IP address.
   - GCP_VM_USERNAME: 	echnoworldbookswebsite
   - GCP_SSH_PRIVATE_KEY: Your SSH private key authorized on the VM.
