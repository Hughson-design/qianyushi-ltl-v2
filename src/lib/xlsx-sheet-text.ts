import readExcelFile from "read-excel-file/node";

type Cells = Array<Array<unknown>>;
// Some warehouses replace a template's length cell with one measured pallet per line.
// Keep that block intact; never allocate an old shipment total back across its pallets.
export function measuredPalletFreight(rows: Cells) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^托盘序号/.test(String(cell ?? ""))));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map((cell) => String(cell ?? "").replace(/\s/g, ""));
  const col = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const length = col(/^长(?:[（(].*[)）])?$/), width = col(/^宽(?:[（(].*[)）])?$/), height = col(/^高(?:[（(].*[)）])?$/);
  const order = col(/^单号$/), product = col(/^品名$/), total = col(/^总重量[（(]KG[)）]$/i), pieces = col(/^总件数$/);
  if ([length, width, height, order].some((value) => value < 0)) return null;
  const data = rows.slice(headerIndex + 1);
  const orders = new Set(data.map((row) => String(row[order] ?? "").trim()).filter(Boolean));
  const shipmentRows = data.filter((row) => String(row[order] ?? "").trim());
  if (orders.size !== 1 || shipmentRows.length !== 1) return null;
  const row = shipmentRows[0];
  const blank = (cell: unknown) => cell == null || /^\s*(?:\/|—|-)?\s*$/.test(String(cell));
  if (!blank(row[width]) || !blank(row[height])) return null;
  const lines = String(row[length] ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 100) return null;
  const cargo: string[] = [], notices: string[] = [];
  let lbs = 0, inferredInches = false;
  for (const line of lines) {
    const match = line.match(/^(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*(cm|厘米|in(?:ch(?:es)?)?|英寸|")?\s*[,，;；]\s*(\d+(?:\.\d+)?)\s*(lbs?|磅)\s*$/i);
    if (!match) return null; // Do not silently drop an unreadable pallet line.
    const sizes = match.slice(1, 4).map(Number), weight = Number(match[5]);
    if ([...sizes, weight].some((value) => !Number.isFinite(value) || value <= 0)) return null;
    const explicitUnit = match[4]?.toLowerCase();
    // US warehouse multiline pallet measurements paired with lb use inches when
    // no size unit is written. Surface the inference rather than silently using cm.
    const unit = explicitUnit === "cm" || explicitUnit === "厘米" ? "cm" : "in";
    if (!explicitUnit) inferredInches = true;
    const commodity = String(row[product] ?? "").replace(/[\r\n,，;；]/g, " ").trim();
    cargo.push(`quantity: 1, Pallet, dimensions: ${sizes.join("×")} ${unit}, weight: ${weight} lb${commodity ? `, commodity: ${commodity}` : ""}`);
    lbs += weight;
  }
  notices.push(`已按仓库同格实测明细识别 ${cargo.length} 托，每行1托，总重 ${Number(lbs.toFixed(3))} lb；未用旧汇总重量覆盖实测重量。 / Warehouse measurements: one pallet per line; measured weights take priority.`);
  if (inferredInches) notices.push("仓库实测行以 lb 标重、尺寸未单独标单位，已按英寸（in）识别，请核对。模板列头的 cm 未用于这些实测行；明写 cm 的行仍按厘米。 / Unlabelled dimensions in the warehouse lb block were interpreted as inches; review this unit.");
  const declaredKg = Number(row[total]);
  const measuredKg = lbs * 0.45359237;
  if (total >= 0 && Number.isFinite(declaredKg) && declaredKg > 0 && Math.abs(declaredKg - measuredKg) > 0.01) notices.push(`实测总重约 ${measuredKg.toFixed(2)} kg，表格汇总 ${declaredKg} kg，相差 ${Math.abs(declaredKg - measuredKg).toFixed(2)} kg。已采用实测重量；差异原因请核实。 / Measured and summary totals differ; measured cargo retained.`);
  const totalPieces = Number(row[pieces]);
  if (pieces >= 0 && Number.isInteger(totalPieces) && totalPieces > 0) notices.push(`原表总件数为 ${totalPieces}，不是托数。未提供每托件数，请在货物编辑区核对补充，不要将总件数作为每托件数。 / Total pieces are not pallets; confirm pieces per pallet.`);
  return { freight: cargo.join("\n"), warnings: notices };
}

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
  const measured = sheets.length === 1 ? measuredPalletFreight(sheets[0].data) : null;
  const freight = measured?.freight ?? (sheets.length === 1 ? verifiedWorkbookFreight(sheets[0].data) : null);
  if (measured) parts.push(`WAREHOUSE MEASURED PALLETS (use these cargo lines instead of template totals; retain the review notices):\n${measured.freight}\n${measured.warnings.join("\n")}`);
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
  return { text, freight, warnings: measured?.warnings ?? [], freightSource: measured ? "warehouse" : "verified" };
}
