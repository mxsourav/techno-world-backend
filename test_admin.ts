import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.user.findFirst({ where: { role: 'ADMIN' } }).then(console.log).finally(() = 
