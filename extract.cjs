const fs = require('fs');
const esbuild = require('esbuild');
global.React = { createElement: () => null, Fragment: () => null };

async function extract() {
  await esbuild.build({
    entryPoints: ['../app/src/data/books.tsx'],
    bundle: true,
    format: 'cjs',
    outfile: 'temp_books.cjs',
    external: ['lucide-react', 'react', 'react-dom', 'sonner', '@/types'],
    jsx: 'transform',
  });
  
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(path) {
    if (path === 'lucide-react' || path === '@/types') {
      return new Proxy({}, { get: () => () => null });
    }
    return originalRequire.apply(this, arguments);
  };
  
  const { BOOKS, CATEGORIES } = require('./temp_books.cjs');
  
  fs.writeFileSync('prisma/seedData.json', JSON.stringify({
    categories: CATEGORIES.map(c => ({ slug: c.slug, name: c.name })),
    books: BOOKS
  }, null, 2));
  
  console.log('Extracted', BOOKS.length, 'books and', CATEGORIES.length, 'categories');
}

extract().catch(console.error);
