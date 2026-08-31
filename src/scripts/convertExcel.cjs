const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const sourceDir = 'F:\\Work for Washim Daa\\excel data';
const outputDir = 'F:\\Work for Washim Daa\\excel data';

const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.xlsx'));

// Category mapping from filename
const categoryMap = {
  'ARTS.xlsx': 'Arts',
  'BOTANY.xlsx': 'Botany',
  'CHEMISTRY.xlsx': 'Chemistry',
  'COMMERCE.xlsx': 'Commerce',
  'COMPETITIVE EXAM BOOK.xlsx': 'Competitive Exam',
  'COMPUTER SCIENCE.xlsx': 'Computer Science',
  'MATHEMATICS.xlsx': 'Mathematics',
  'PHYSICS.xlsx': 'Physics',
  'ZOOLOGY.xlsx': 'Zoology',
  'nursing final.xlsx': 'Nursing',
};

const PUBLISHER = 'Techno World Publications';

// Target format headers
const HEADERS = [
  'title', 'subtitle', 'isbn', 'sku', 'bookCode', 'edition',
  'language', 'description', 'price', 'mrp', 'stock',
  'pages', 'publicationDate', 'category', 'author', 'publisher'
];

let globalSkuCounter = 1;

function generateSku(catCode) {
  const num = String(globalSkuCounter++).padStart(4, '0');
  return `TW${catCode}${num}`;
}

function generateBookCode(catCode) {
  const num = String(globalSkuCounter).padStart(4, '0');
  return `${catCode}${num}`;
}

function getCatCode(category) {
  const map = {
    'Arts': 'ART',
    'Botany': 'BOT',
    'Chemistry': 'CHM',
    'Commerce': 'COM',
    'Competitive Exam': 'CMP',
    'Computer Science': 'CSC',
    'Mathematics': 'MAT',
    'Physics': 'PHY',
    'Zoology': 'ZOO',
    'Nursing': 'NUR',
  };
  return map[category] || 'GEN';
}

function parseEditionFromTitle(title) {
  // Try to extract edition like "2/ED", "2nd ED", "3/ED", "2nd Edition" etc
  const match = title.match(/(\d+)\s*\/?\s*(?:ED|Edition)/i);
  if (match) return `${match[1]}th Edition`;
  
  const match2 = title.match(/(\d+)(?:st|nd|rd|th)\s*(?:ED|Edition)/i);
  if (match2) return `${match2[1]}th Edition`;
  
  return '1st Edition';
}

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s+/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function cleanAuthor(author) {
  if (!author) return '';
  return author
    .replace(/\s+/g, ' ')
    .replace(/\r?\n/g, ', ')
    .trim();
}

function formatIsbn(isbn) {
  if (!isbn) return '';
  return String(isbn).replace(/[^0-9X-]/gi, '').trim();
}

function generateDescription(title, author, category) {
  return `A comprehensive textbook on ${title} by ${author}. Published under the ${category} category by ${PUBLISHER}. Ideal for undergraduate and postgraduate students.`;
}

// Process each source file and overwrite it in the target format
for (const file of files) {
  const filePath = path.join(sourceDir, file);
  const category = categoryMap[file] || path.basename(file, '.xlsx');
  const catCode = getCatCode(category);
  
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  // Find the header row (the one that contains "ISBN" and "Author" and "Book Name")
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    const rowStr = row.map(c => String(c).trim().toUpperCase()).join('|');
    if (rowStr.includes('ISBN') && (rowStr.includes('AUTHOR') || rowStr.includes('BOOK NAME') || rowStr.includes('BOOK'))) {
      headerRowIdx = i;
      break;
    }
  }
  
  if (headerRowIdx === -1) {
    console.log(`WARNING: Could not find header row in ${file}, skipping.`);
    continue;
  }
  
  // Map source columns to indices
  const srcHeaders = rawData[headerRowIdx].map(h => String(h).trim().toUpperCase());
  const colIdx = {
    isbn: srcHeaders.findIndex(h => h.includes('ISBN')),
    author: srcHeaders.findIndex(h => h.includes('AUTHOR')),
    title: srcHeaders.findIndex(h => h.includes('BOOK') || h.includes('NAME')),
    price: srcHeaders.findIndex(h => h.includes('PRICE')),
    year: srcHeaders.findIndex(h => h.includes('YEAR')),
  };
  
  console.log(`Processing ${file}: headerRow=${headerRowIdx}, columns=${JSON.stringify(colIdx)}`);
  
  // Process data rows
  const outputRows = [];
  
  for (let i = headerRowIdx + 1; i < rawData.length; i++) {
    const row = rawData[i];
    
    // Skip empty rows, sub-header rows, and section dividers
    const titleVal = row[colIdx.title];
    const priceVal = row[colIdx.price];
    
    if (!titleVal || String(titleVal).trim() === '') continue;
    
    // Skip rows that look like section headers (all caps, no price, etc)
    const titleStr = String(titleVal).trim();
    if (titleStr.length < 3) continue;
    
    const isbn = formatIsbn(row[colIdx.isbn]);
    const author = cleanAuthor(row[colIdx.author]);
    const title = cleanTitle(titleStr);
    const price = parseFloat(priceVal) || 0;
    const year = row[colIdx.year] ? String(row[colIdx.year]).trim() : '';
    
    // Skip if price is 0 and no ISBN - likely a section header
    if (price === 0 && !isbn && !author) continue;
    
    const edition = parseEditionFromTitle(title);
    const sku = generateSku(catCode);
    const bookCode = generateBookCode(catCode);
    const mrp = price > 0 ? Math.round(price * 1.15) : 0; // MRP ~15% more than price
    const publicationDate = year ? `${year}-01-01` : '';
    const description = generateDescription(title, author, category);
    
    outputRows.push({
      title,
      subtitle: '',
      isbn,
      sku,
      bookCode,
      edition,
      language: 'English',
      description,
      price,
      mrp,
      stock: Math.floor(Math.random() * 50) + 10, // Random stock 10-60
      pages: '',
      publicationDate,
      category,
      author,
      publisher: PUBLISHER,
    });
  }
  
  console.log(`  Found ${outputRows.length} books in ${file}`);
  
  // Create new workbook with clean format (no merges, individual rows)
  const newWb = XLSX.utils.book_new();
  const wsData = [HEADERS, ...outputRows.map(r => HEADERS.map(h => r[h]))];
  const newWs = XLSX.utils.aoa_to_sheet(wsData);
  
  // Set column widths for readability
  newWs['!cols'] = [
    { wch: 50 }, // title
    { wch: 20 }, // subtitle
    { wch: 18 }, // isbn
    { wch: 12 }, // sku
    { wch: 12 }, // bookCode
    { wch: 14 }, // edition
    { wch: 10 }, // language
    { wch: 60 }, // description
    { wch: 10 }, // price
    { wch: 10 }, // mrp
    { wch: 8 },  // stock
    { wch: 8 },  // pages
    { wch: 14 }, // publicationDate
    { wch: 18 }, // category
    { wch: 35 }, // author
    { wch: 30 }, // publisher
  ];
  
  XLSX.utils.book_append_sheet(newWb, newWs, 'Books');
  
  // Overwrite the source file with the new formatted data
  XLSX.writeFile(newWb, filePath);
  console.log(`  ✅ Updated: ${filePath} (${outputRows.length} books)`);
}

console.log('\n✅ All files updated successfully!');
