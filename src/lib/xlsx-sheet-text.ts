import readExcelFile from "read-excel-file/node";

type Cells = Array<Array<unknown>>;
// Standard dispatch sheets have one ordinal (1/5, 2/5...) per handling unit.
// Derive their numeric cargo locally; AI still interprets the addresses and notes.
export function verifiedWorkbookFreight(rows: Cells) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^托盘序号/.test(String(cell ?? ""))));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map((cell) => String(cell ?? "").replace(/\s/g, ""));
  const column = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const ordinal = column(/^托盘序号/), weight = column(/^重量[（(]KG[)）]$/i);
  const length = column(/^长[（(]cm[)）]$/i), width = column(/^宽[（(]cm[)）]$/i), height = column(/^高[（(]cm[)）]$/i);
  const pieces = column(/^每个托盘件数/), total = column(/^总重量[（(]KG[)）]$/i), order = column(/^单号$/), commodity = column(/^品名$/), notes = column(/^备注$/);
  if ([ordinal, weight, length, width, height].some((index) => index < 0)) return null;
  const data = rows.slice(headerIndex + 1);
  const orders = new Set(data.map((row) => String(row[order] ?? "").trim()).filter(Boolean));
  if (orders.size !== 1) return null; // Multiple orders need explicit shipment selection.
  let product = "", packaging = "Pallet", declaredTotal: number | null = null, kg = 0, units = 0, expected = 0;
  const ordinals = new Set<number>();
  const groups = new Map<string, { sizes: number[]; weight: number; pieces: number; quantity: number; product: string; packaging: string }>();
  for (const row of data) {
    if (row[commodity]) product = String(row[commodity]).replace(/[\r\n,，;；]/g, " ");
    if (row[notes]) packaging = /木箱|crate/i.test(String(row[notes])) ? "Crate" : "Pallet";
    const id = String(row[ordinal] ?? "").match(/^(\d+)\/(\d+)$/);
    if (!id) continue;
    const number = Number(id[1]), count = Number(id[2]);
    if (!number || number > count || ordinals.has(number) || (expected && expected !== count)) return null;
    expected = count; ordinals.add(number);
    const values = [row[length], row[width], row[height], row[weight]].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
    const unitPieces = Number(row[pieces]);
    if (!Number.isInteger(unitPieces) || unitPieces <= 0) return null;
    if (total >= 0 && row[total] != null) {
      const value = Number(row[total]);
      if (!Number.isFinite(value) || value <= 0 || (declaredTotal !== null && declaredTotal !== value)) return null;
      declaredTotal = value;
    }
    const key = JSON.stringify([values, unitPieces, product, packaging]);
    const existing = groups.get(key);
    if (existing) { existing.quantity++; existing.pieces += unitPieces; }
    else groups.set(key, { sizes: values.slice(0, 3), weight: values[3], pieces: unitPieces, quantity: 1, product, packaging });
    kg += values[3]; units++;
  }
  if (!units || units !== expected || declaredTotal === null || Math.abs(kg - declaredTotal) > 0.01) return null;
  return [...groups.values()].map((group) => `quantity: ${group.quantity}, ${group.packaging}, ${group.pieces} pieces, dimensions: ${group.sizes.join("×")} cm, weight: ${group.weight} kg, commodity: ${group.product}`).join("\n");
}

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
  const freight = sheets.length === 1 ? verifiedWorkbookFreight(sheets[0].data) : null;
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
  return { text, freight };
}
