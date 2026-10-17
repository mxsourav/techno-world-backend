-- AlterTable User: Add avatarKey and age
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarKey" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "age" INTEGER;

-- AlterTable Order: Add trackingToken with unique cuid fallback
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingToken" TEXT;
UPDATE "Order" SET "trackingToken" = md5(random()::text || clock_timestamp()::text) WHERE "trackingToken" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "trackingToken" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_trackingToken_key" ON "Order"("trackingToken");

-- AlterTable Category: Ensure unique name
CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");

-- CreateTable Many-to-Many _BookToCategory
CREATE TABLE IF NOT EXISTS "_BookToCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BookToCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_BookToCategory_B_index" ON "_BookToCategory"("B");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_BookToCategory_A_fkey') THEN
    ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_BookToCategory_B_fkey') THEN
    ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing single category relationships into Many-to-Many table
INSERT INTO "_BookToCategory" ("A", "B")
SELECT b."id", b."categoryId"
FROM "Book" b
WHERE b."categoryId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Seed Science and Techno World Publication categories if not exists
INSERT INTO "Category" ("id", "name", "slug", "description", "isActive", "createdAt", "updatedAt")
VALUES 
  (md5(random()::text || clock_timestamp()::text), 'Science', 'science', 'Academic and scientific textbooks, reference manuals and research literature.', true, NOW(), NOW()),
  (md5(random()::text || clock_timestamp()::text), 'Techno World Publication', 'techno-world-publication', 'Official in-house academic publications, study guides, and solutions by Techno World Books.', true, NOW(), NOW())
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name";
