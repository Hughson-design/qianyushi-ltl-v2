import readExcelFile from "read-excel-file/node";

// Bound decompression before the workbook library opens an uploaded archive.
function checkArchive(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Invalid XLSX archive");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), total = 0;
  if (count > 2000 || count === 0xffff) throw new Error("Workbook is too large");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XLSX directory");
    total += bytes.readUInt32LE(offset + 24);
    if (total > 20_000_000) throw new Error("Workbook expands beyond 20 MB");
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

export async function xlsxSheetText(bytes: Buffer) {
  checkArchive(bytes);
  const sheets = await readExcelFile(bytes);
  if (sheets.length > 20) throw new Error("Too many worksheets");
  const parts: string[] = [];
  for (const sheet of sheets) {
    parts.push(`Worksheet: ${sheet.sheet}`);
    if (sheet.data.length > 1000) throw new Error("Split worksheets with more than 1,000 rows");
    sheet.data.forEach((row, index) => {
      const cells = row.map((value, column) => value == null ? null : [column + 1, value instanceof Date ? value.toISOString() : value]);
      if (cells.some(Boolean)) parts.push(`Row ${index + 1}: ${JSON.stringify(cells.filter(Boolean))}`);
    });
  }
  const text = parts.join("\n");
  if (text.length > 25_000) throw new Error("Workbook text is too long");
  return text;
}
