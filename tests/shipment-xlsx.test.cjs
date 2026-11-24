const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes, createRequire } = require('node:module');
const readExcelFile = require('read-excel-file/node').default;
const { zipSync, strToU8 } = createRequire(require.resolve('read-excel-file/node'))('fflate');
const source = stripTypeScriptTypes(fs.readFileSync('src/lib/xlsx-sheet-text.ts', 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
const { xlsxSheetText, verifiedWorkbookFreight, measuredPalletFreight } = vm.runInNewContext(source + '\n;({xlsxSheetText,verifiedWorkbookFreight,measuredPalletFreight})', { readExcelFile, Buffer, Date });
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
  const { text } = await xlsxSheetText(workbook());
  assert.match(text, /长\(cm\)/); assert.match(text, /总重量\(KG\)/);
  assert.match(text, /\[1,536\]/); assert.match(text, /\[2,100\]/);
  assert.equal((text.match(/\[2,109\]/g) || []).length, 2);
  assert.match(text, /Row 4:.*\[3,105\]/);
});
test('reconciles five handling units to 536 kg and produces groups of 1 and 4, not 5 and 4', () => {
  const rows = [
    ['单号', '托盘序号', '每个托盘件数', '总重量（KG）', '重量（KG）', '长(cm)', '宽(cm)', '高(cm)', '品名', '备注'],
    ['sample', '1/5', 1, 536, 100, 108, 65, 69, 'Screen', '5个木箱'],
    ...Array.from({ length: 4 }, (_, i) => [null, `${i + 2}/5`, 1, null, 109, 105, 59, 68]),
  ];
  const text = verifiedWorkbookFreight(rows);
  assert.match(text, /^quantity: 1, Crate, 1 pieces/);
  assert.match(text, /quantity: 4, Crate, 4 pieces/);
  assert.match(text, /108×65×69 cm, weight: 100 kg/);
  assert.match(text, /105×59×68 cm, weight: 109 kg/);
  rows[1][3] = 999;
  assert.equal(verifiedWorkbookFreight(rows), null, 'conflicting totals must not be silently overridden');
  rows[1][3] = 536; rows[0][5] = '长';
  assert.equal(verifiedWorkbookFreight(rows), null, 'unknown units require confirmation');
});
test('rejects corrupt and excessively expanded archives before parsing', async () => {
  await assert.rejects(xlsxSheetText(Buffer.from('broken')));
  const bytes = workbook();
  const countOffset = bytes.length - 22 + 10;
  bytes.writeUInt16LE(65535, countOffset);
  await assert.rejects(xlsxSheetText(bytes), /Workbook/);
});

function warehouseRows(block = '41*47*75, 474lbs\n42*42*85, 1574lbs\n46*46*89, 744lbs\n46*44*89, 750lbs') {
 return [['单号','托盘序号','长(cm)','宽(cm)','高(cm)','总重量（KG）','总件数','品名'], ['fixture','/',block,null,null,1637.55,97,'Lights']];
}
test('warehouse block yields four actual pallets in inches/lb without reusing template totals', () => {
 const result=measuredPalletFreight(warehouseRows());
 assert.equal(result.freight.split('\n').length,4);
 assert.match(result.freight,/41×47×75 in, weight: 474 lb/);
 assert.match(result.freight,/42×42×85 in, weight: 1574 lb/);
 assert.equal((result.freight.match(/quantity: 1, Pallet/g)||[]).length,4);
 assert.ok(!result.freight.includes('1637.55'));
 assert.ok(result.warnings.some(w=>w.includes('1606.62')&&w.includes('30.93')));
 assert.ok(result.warnings.some(w=>w.includes('英寸')));
 assert.ok(result.warnings.some(w=>w.includes('97')));
});
test('explicit measured size units override inference and malformed or multiple shipments never lose cargo silently', () => {
 const explicit=measuredPalletFreight(warehouseRows('100*80*90 cm, 474lb\n42*42*85 in, 1574lb'));
 assert.match(explicit.freight,/100×80×90 cm/);
 assert.match(explicit.freight,/42×42×85 in/);
 assert.ok(!explicit.warnings.some(w=>w.includes('未单独标单位')));
 assert.equal(measuredPalletFreight(warehouseRows('41*47*75, 474lbs\nunknown')),null);
 const multiple=warehouseRows();multiple.push(['another','/','42*42*85, 1574lbs']);assert.equal(measuredPalletFreight(multiple),null);
 const separate=warehouseRows();separate[1][3]=47;assert.equal(measuredPalletFreight(separate),null);
});
