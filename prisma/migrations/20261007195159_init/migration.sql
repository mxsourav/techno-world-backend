/*
  Warnings:

  - A unique constraint covering the columns `[customerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "B2BEnquiryStatus" AS ENUM ('Pending', 'Contacted', 'Quoted', 'Closed');

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "galleryPublicIds" TEXT DEFAULT '[]',
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerId" VARCHAR(32);

-- CreateTable
CREATE TABLE "B2BEnquiry" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "representativeName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "timeline" TEXT,
    "requirements" TEXT NOT NULL,
    "attachedCartItems" JSONB DEFAULT '[]',
    "status" "B2BEnquiryStatus" NOT NULL DEFAULT 'Pending',
    "adminNotes" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2BEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "B2BEnquiry_status_idx" ON "B2BEnquiry"("status");

-- CreateIndex
CREATE INDEX "B2BEnquiry_createdAt_idx" ON "B2BEnquiry"("createdAt");

-- CreateIndex
CREATE INDEX "Book_isDeleted_idx" ON "Book"("isDeleted");

-- CreateIndex
CREATE INDEX "Book_coverPublicId_idx" ON "Book"("coverPublicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_customerId_key" ON "User"("customerId");
