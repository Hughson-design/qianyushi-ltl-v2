const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes, createRequire } = require('node:module');
const readExcelFile = require('read-excel-file/node').default;
const { zipSync, strToU8 } = createRequire(require.resolve('read-excel-file/node'))('fflate');
const source = stripTypeScriptTypes(fs.readFileSync('src/lib/xlsx-sheet-text.ts', 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
const { xlsxSheetText } = vm.runInNewContext(source + '\n;({xlsxSheetText})', { readExcelFile, Buffer, Date });
function workbook() {
  const xml = (text) => strToU8(text);
  return Buffer.from(zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Freight" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>总重量(KG)</t></is></c><c r="B1" t="inlineStr"><is><t>重量(KG)</t></is></c><c r="C1" t="inlineStr"><is><t>长(cm)</t></is></c></row><row r="2"><c r="A2"><v>536</v></c><c r="B2"><v>100</v></c><c r="C2"><v>108</v></c></row><row r="3"><c r="B3"><v>109</v></c><c r="C3"><v>105</v></c></row><row r="4"><c r="B4"><v>109</v></c><c r="C4"><v>105</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A2:A4"/></mergeCells></worksheet>'),
  }));
}
test('reads header units, sparse continuation rows and shared totals without dropping dimensions', async () => {
  const text = await xlsxSheetText(workbook());
  assert.match(text, /长\(cm\)/); assert.match(text, /总重量\(KG\)/);
  assert.match(text, /\[1,536\]/); assert.match(text, /\[2,100\]/);
  assert.equal((text.match(/\[2,109\]/g) || []).length, 2);
  assert.match(text, /Row 4:.*\[3,105\]/);
});
test('rejects corrupt and excessively expanded archives before parsing', async () => {
  await assert.rejects(xlsxSheetText(Buffer.from('broken')));
  const bytes = workbook();
  const countOffset = bytes.length - 22 + 10;
  bytes.writeUInt16LE(65535, countOffset);
  await assert.rejects(xlsxSheetText(bytes), /Workbook/);
});
