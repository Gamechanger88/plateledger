import * as XLSX from 'xlsx';

export function exportToExcel(data: any[], filename: string) {
  if (!data || data.length === 0) return;

  // Create a new workbook and add a worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Auto-size columns based on header length or content
  const colWidths = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(
      key.length,
      ...data.map(row => (row[key] ? row[key].toString().length : 0))
    ) + 2
  }));
  worksheet['!cols'] = colWidths;

  // Append worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  // Trigger download
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
