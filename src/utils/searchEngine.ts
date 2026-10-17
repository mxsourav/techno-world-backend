/**
 * High-Performance, Typo-Tolerant, Multi-Token Search Engine
 * for Techno World Books Storefront & Admin Catalog.
 */

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

export function isFuzzyWordMatch(queryWord: string, targetWord: string): { match: boolean; dist: number } {
  const q = queryWord.toLowerCase().trim();
  const t = targetWord.toLowerCase().trim();
  if (!q || !t) return { match: false, dist: 99 };
  if (q === t) return { match: true, dist: 0 };
  if (t.includes(q)) return { match: true, dist: 0 };

  // For words with length < 4, only exact substring is accepted
  if (q.length < 4) return { match: false, dist: 99 };

  // Typo thresholds:
  // length 4..6: max edit distance 1 (e.g. "mondel" -> "mondal")
  // length >= 7: max edit distance 2 (e.g. "bactriology" -> "bacteriology")
  const maxDist = q.length >= 7 ? 2 : 1;
  const dist = levenshteinDistance(q, t);
  return { match: dist <= maxDist, dist };
}

export function extractTokens(query: string): string[] {
  const stopWords = new Set(['and', 'of', 'the', 'for', 'in', 'a', 'an', 'to', 'with', 'on', 'by']);
  const rawWords = query
    .toLowerCase()
    .replace(/[^\w\s\u0980-\u09FF]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  const filtered = rawWords.filter(w => !stopWords.has(w) && w.length >= 2);
  return filtered.length > 0 ? filtered : rawWords.filter(w => w.length >= 2);
}

export function buildPrismaSearchWhere(query: string): any {
  const cleanQ = query.trim();
  const tokens = extractTokens(cleanQ);

  const singleField = (field: string, term: string) => ({
    [field]: { contains: term, mode: 'insensitive' as const }
  });

  const relationSome = (relation: string, field: string, term: string) => ({
    [relation]: { some: { [field]: { contains: term, mode: 'insensitive' as const } } }
  });

  const relationSingle = (relation: string, field: string, term: string) => ({
    [relation]: { [field]: { contains: term, mode: 'insensitive' as const } }
  });

  const buildClauseForTerm = (term: string) => ({
    OR: [
      singleField('title', term),
      singleField('subtitle', term),
      singleField('isbn13', term),
      singleField('isbn10', term),
      singleField('bookCode', term),
      singleField('sku', term),
      singleField('seoKeywords', term),
      singleField('tags', term),
      singleField('examination', term),
      singleField('university', term),
      singleField('course', term),
      relationSome('authors', 'name', term),
      relationSingle('publisher', 'name', term),
      relationSingle('category', 'name', term),
      relationSome('categories', 'name', term),
      relationSome('subjects', 'name', term),
    ]
  });

  const orClauses: any[] = [
    // 1. Full query phrase match
    buildClauseForTerm(cleanQ),
  ];

  // 2. If multiple tokens, require books that contain ALL tokens across their fields (AND)
  if (tokens.length > 1) {
    const andClauses = tokens.map(token => buildClauseForTerm(token));
    orClauses.push({ AND: andClauses });

    // Also include individual token ORs so partial matches are found and ranked
    tokens.forEach(token => {
      orClauses.push(singleField('title', token));
      orClauses.push(relationSome('authors', 'name', token));
      orClauses.push(singleField('seoKeywords', token));
      orClauses.push(singleField('tags', token));
      orClauses.push(relationSingle('publisher', 'name', token));
    });
  }

  return { OR: orClauses };
}

export function scoreBook(book: any, query: string, tokens: string[]): number {
  let score = 0;
  const q = query.toLowerCase().trim();
  const title = (book.title || '').toLowerCase();
  const authorNames = (book.authors?.map((a: any) => a.name) || []).join(' ').toLowerCase();
  const publisherName = (book.publisher?.name || '').toLowerCase();
  const seo = (book.seoKeywords || '').toLowerCase();
  const tags = (typeof book.tags === 'string' ? book.tags : JSON.stringify(book.tags || '')).toLowerCase();
  const catNames = [
    book.category?.name || '',
    ...(book.categories?.map((c: any) => c.name) || [])
  ].join(' ').toLowerCase();

  // 1. Exact title match
  if (title === q) {
    score += 2500;
  } else if (title.startsWith(q)) {
    score += 1200;
  } else if (title.includes(q)) {
    score += 700;
  }

  // 2. Full query in author or publisher
  if (authorNames.includes(q)) score += 500;
  if (publisherName.includes(q)) score += 300;

  // 3. Full query in SEO keywords or tags
  if (seo.includes(q) || tags.includes(q)) score += 400;

  // 4. Token-by-token evaluation
  let allTokensInTitle = true;
  let allTokensInBook = true;

  for (const token of tokens) {
    let foundInBook = false;

    if (title.includes(token)) {
      score += 150;
      foundInBook = true;
    } else {
      allTokensInTitle = false;
    }

    if (authorNames.includes(token)) {
      score += 120;
      foundInBook = true;
    }
    if (seo.includes(token)) {
      score += 100;
      foundInBook = true;
    }
    if (tags.includes(token)) {
      score += 80;
      foundInBook = true;
    }
    if (publisherName.includes(token)) {
      score += 60;
      foundInBook = true;
    }
    if (catNames.includes(token)) {
      score += 50;
      foundInBook = true;
    }

    if (!foundInBook) {
      allTokensInBook = false;
    }
  }

  if (tokens.length > 1) {
    if (allTokensInTitle) score += 600;
    else if (allTokensInBook) score += 350;
  }

  if (book.isFeatured) score += 20;
  if (book.isBestseller) score += 15;

  return score;
}

export function fuzzyScoreBook(book: any, tokens: string[]): number {
  let score = 0;
  const titleWords = (book.title || '')
    .toLowerCase()
    .replace(/[^\w\s\u0980-\u09FF]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const authorNames = (book.authors?.map((a: any) => a.name) || []).join(' ');
  const authorWords = authorNames
    .toLowerCase()
    .replace(/[^\w\s\u0980-\u09FF]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const seoRaw = (book.seoKeywords || '') + ' ' + (typeof book.tags === 'string' ? book.tags : JSON.stringify(book.tags || ''));
  const seoWords = seoRaw
    .toLowerCase()
    .replace(/[^\w\s\u0980-\u09FF]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    if (token.length < 3) continue;

    for (const tw of titleWords) {
      const res = isFuzzyWordMatch(token, tw);
      if (res.match) {
        score += Math.max(20, 160 - res.dist * 50);
        break;
      }
    }

    for (const aw of authorWords) {
      const res = isFuzzyWordMatch(token, aw);
      if (res.match) {
        score += Math.max(20, 130 - res.dist * 40);
        break;
      }
    }

    for (const sw of seoWords) {
      const res = isFuzzyWordMatch(token, sw);
      if (res.match) {
        score += Math.max(10, 110 - res.dist * 40);
        break;
      }
    }
  }

  return score;
}
