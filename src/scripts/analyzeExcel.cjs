const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 1. Read the target format file to understand its columns
const targetWb = XLSX.readFile('C:\\Users\\rodd\\Desktop\\demo_1000_books.xlsx');
const targetSheet = targetWb.Sheets[targetWb.SheetNames[0]];
const targetData = XLSX.utils.sheet_to_json(targetSheet, { header: 1 });
console.log('=== TARGET FORMAT ===');
console.log('Sheet names:', targetWb.SheetNames);
console.log('Headers:', targetData[0]);
console.log('Sample row 1:', targetData[1]);
console.log('Sample row 2:', targetData[2]);
console.log('Total rows:', targetData.length);
console.log('');

// 2. Read all source files
const sourceDir = 'F:\\Work for Washim Daa\\excel data';
const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.xlsx'));

for (const file of files) {
  const wb = XLSX.readFile(path.join(sourceDir, file));
  console.log(`=== SOURCE: ${file} ===`);
  console.log('Sheet names:', wb.SheetNames);
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`  Sheet "${sheetName}": ${data.length} rows`);
    if (data.length > 0) console.log('  Headers:', data[0]);
    if (data.length > 1) console.log('  Sample row:', data[1]);
    if (data.length > 2) console.log('  Sample row 2:', data[2]);
    
    // Check for merged cells
    const merges = sheet['!merges'];
    if (merges && merges.length > 0) {
      console.log(`  MERGED CELLS: ${merges.length} merges`);
      console.log('  First 5 merges:', merges.slice(0, 5).map(m => 
        `${XLSX.utils.encode_range(m)}`
      ));
    }
  }
  console.log('');
}
