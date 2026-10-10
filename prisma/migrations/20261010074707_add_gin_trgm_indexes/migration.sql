-- 1. Enable the PostgreSQL Trigram extension for fuzzy string matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. GIN Trigram index on Book title (accelerates ILIKE / contains title queries)
CREATE INDEX IF NOT EXISTS "Book_title_trgm_idx" ON "Book" USING GIN ("title" gin_trgm_ops);

-- 3. GIN Trigram index on Author name (accelerates catalog author lookups)
CREATE INDEX IF NOT EXISTS "Author_name_trgm_idx" ON "Author" USING GIN ("name" gin_trgm_ops);

-- 4. Conditional fallback for denormalized author column if present on Book table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Book' AND column_name='author') THEN
    CREATE INDEX IF NOT EXISTS "Book_author_trgm_idx" ON "Book" USING GIN ("author" gin_trgm_ops);
  END IF;
END $$;
