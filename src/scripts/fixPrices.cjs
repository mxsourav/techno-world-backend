const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const sourceDir = 'F:\\Work for Washim Daa\\excel data';
const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.xlsx'));

const HEADERS = [
  'title', 'subtitle', 'isbn', 'sku', 'bookCode', 'edition',
  'language', 'description', 'price', 'mrp', 'stock',
  'pages', 'publicationDate', 'category', 'author', 'publisher'
];

for (const file of files) {
  const filePath = path.join(sourceDir, file);
  
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet);
  
  let needsUpdate = false;
  
  const outputRows = rawData.map(row => {
    const currentPrice = Number(row.price) || 0;
    const currentMrp = Number(row.mrp) || 0;
    
    // Check if it's already fixed. A fixed row has price == 90% of mrp
    const expectedFixedPrice = Math.round(currentMrp * 0.90);
    
    if (currentPrice > 0 && Math.abs(currentPrice - expectedFixedPrice) <= 1) {
      // Already fixed in the previous interrupted run, return as is
      return row;
    }
    
    needsUpdate = true;
    // Not fixed yet. The original MRP value is currently sitting in the 'price' column
    const actualMrp = currentPrice;
    const sellingPrice = actualMrp > 0 ? Math.round(actualMrp * 0.90) : 0;
    
    return {
      ...row,
      mrp: actualMrp,
      price: sellingPrice
    };
  });
  
  if (needsUpdate) {
    const newWb = XLSX.utils.book_new();
    const wsData = [HEADERS, ...outputRows.map(r => HEADERS.map(h => r[h] !== undefined ? r[h] : ''))];
    const newWs = XLSX.utils.aoa_to_sheet(wsData);
    
    newWs['!cols'] = [
      { wch: 50 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, 
      { wch: 14 }, { wch: 10 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, 
      { wch: 8 },  { wch: 8 },  { wch: 14 }, { wch: 18 }, { wch: 35 }, 
      { wch: 30 }
    ];
    
    XLSX.utils.book_append_sheet(newWb, newWs, 'Books');
    XLSX.writeFile(newWb, filePath);
    console.log(`✅ Fixed prices in: ${file} (${outputRows.length} books)`);
  } else {
    console.log(`⏩ Skipped ${file} (Prices already fixed)`);
  }
}

console.log('\n✅ All files price corrected successfully!');
