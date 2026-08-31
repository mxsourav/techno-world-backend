const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const sourceDir = 'F:\\Work for Washim Daa\\excel data';
const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.xlsx'));

let totalBooks = 0;

for (const file of files) {
  const wb = XLSX.readFile(path.join(sourceDir, file));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const merges = sheet['!merges'];
  
  console.log(`${file}:`);
  console.log(`  Sheet: "${wb.SheetNames[0]}", Rows: ${data.length - 1} books`);
  console.log(`  Headers: ${JSON.stringify(data[0])}`);
  console.log(`  Sample: ${JSON.stringify(data[1])}`);
  console.log(`  Merged cells: ${merges ? merges.length : 0}`);
  console.log('');
  totalBooks += data.length - 1;
}

console.log(`Total books across all files: ${totalBooks}`);
