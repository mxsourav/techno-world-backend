const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const sourceDir = 'F:\\Work for Washim Daa\\excel data';
const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.xlsx'));

for (const file of files) {
  const wb = XLSX.readFile(path.join(sourceDir, file));
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  console.log(`\n========== ${file} (${data.length} rows) ==========`);
  // Print ALL rows to understand the structure  
  const maxRows = Math.min(data.length, 25);
  for (let i = 0; i < maxRows; i++) {
    const row = data[i];
    if (row && row.some(c => c !== '' && c !== undefined && c !== null)) {
      console.log(`  Row ${i}: ${JSON.stringify(row)}`);
    }
  }
}
