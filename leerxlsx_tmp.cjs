const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2]);
wb.SheetNames.forEach(n => {
  const ws = wb.Sheets[n];
  console.log('=== HOJA: ' + n + ' ===');
  console.log(XLSX.utils.sheet_to_csv(ws));
});