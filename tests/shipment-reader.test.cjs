const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function load(path, names, globals = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  return vm.runInNewContext(source + '\n;({' + names.join(',') + '})', { console, Buffer, File, Request, Response, FormData, AbortSignal, URL, ...globals });
}
const parser = load('src/lib/smart-quote-parser.ts', ['parseSmartQuote']);
const reader = load('src/lib/shipment-reader.ts', ['readerResult', 'readerExtension', 'readerInstructions', 'readerSchema', 'READER_MAX_BYTES', 'READER_MAX_FILES', 'READER_MAX_TEXT', 'READER_MIME'], parser);
const text = '提货地址：91789\n收货地址：1251 E Walnut, Carson, CA 90746\n7 pallets, 7 pieces, 120*100*180 cm, 744 kg, commodity: Furniture';
test('private address means residential, preserving separately stated delivery services', () => {
  const base = '提货地址：91789\n收货地址：1251 E Walnut, Carson, CA 90746\n';
  const freight = '1 pallet, 48*40*48 in, 500 lb';
  const plain = parser.parseSmartQuote(base.replace('90746', '90746，私人地址') + freight);
  assert.deepEqual([...plain.services], ['Residential delivery']);
  assert.equal(plain.hasDeclaredDeliveryType, true);
  assert.equal(plain.destinationAddress.includes('私人地址'), false);
  const notes = parser.parseSmartQuote(base + '私人地址\n电话预约\n需尾板车\n' + freight);
  for (const service of ['Residential delivery', 'Appointment delivery', 'Liftgate at delivery']) assert.ok(notes.services.includes(service));
  assert.deepEqual([...notes.missing], []);
  assert.equal(notes.services.includes('Residential pickup'), false);
  const pickup = parser.parseSmartQuote(base.replace('91789', '91789，私人地址') + freight);
  assert.ok(pickup.services.includes('Residential pickup'));
  assert.equal(pickup.hasDeclaredDeliveryType, false);
  assert.match(reader.readerInstructions, /私人地址.*explicit residential/);
});
function harness({ signedIn = true, key = '', payload, status = 200 } = {}) {
  const requests = [];
  const route = load('src/app/api/shipment-reader/route.ts', ['GET', 'POST'], {
    ...reader,
    xlsxSheetText: async () => ({ text: 'Worksheet: Freight\nRow 1: [[1,"重量(KG)"],[2,"长(cm)"]]\nRow 2: [[1,100],[2,108]]', freight: 'quantity: 1, Crate, 1 pieces, 108×65×69 cm, 100 kg, commodity: Screen\nquantity: 4, Crate, 4 pieces, 105×59×68 cm, 109 kg, commodity: Screen' }),
    NextResponse: { json: (body, options) => Response.json(body, options) },
    requireAppSession: async () => signedIn ? { session: { userId: 'test-user', customerId: 'test-customer' } } : { response: Response.json({ error: 'Sign in' }, { status: 401 }) },
    process: { env: { OPENAI_API_KEY: key } },
    fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Response.json(payload ?? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ shipmentText: text, originalText: text, warnings: ['请核对托数和重量'] }) }] }] }, { status }); },
  });
  function request({ ai = false, files = [], value = text, headers = {} } = {}) {
    const body = new FormData(); body.set('text', value); body.set('useAi', String(ai));
    for (const file of files) body.append('files', file);
    return new Request('https://ltl.example/api/shipment-reader', { method: 'POST', body, headers });
  }
  return { ...route, requests, request };
}

test('requires authentication before reading uploads or revealing AI status', async () => {
  const app = harness({ signedIn: false });
  assert.equal((await app.GET()).status, 401);
  assert.equal((await app.POST(app.request())).status, 401);
  assert.equal(app.requests.length, 0);
});
test('basic text and TXT upload work without AI or carrier calls', async () => {
  const app = harness();
  const response = await app.POST(app.request({ value: '', files: [new File([text], 'shipment.txt')] }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.method, 'rules'); assert.equal(result.parsed.items[0].pallets, '7');
  assert.equal(result.parsed.originZip, '91789'); assert.equal(result.parsed.destinationZip, '90746');
  assert.equal(app.requests.length, 0); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects unknown format, missing AI consent, no key, wrong origin and oversized payloads', async () => {
  const app = harness();
  assert.equal((await app.POST(app.request({ files: [new File(['bad'], 'file.exe')] }))).status, 400);
  assert.equal((await app.POST(app.request({ files: [new File(['image'], 'file.png')] }))).status, 400);
  assert.equal((await app.POST(app.request({ ai: true }))).status, 503);
  assert.equal((await app.POST(app.request({ headers: { origin: 'https://other.example' } }))).status, 403);
  assert.equal((await app.POST(app.request({ value: 'a'.repeat(reader.READER_MAX_TEXT + 1) }))).status, 413);
  assert.equal((await app.POST(app.request({ files: [new File([new Uint8Array(reader.READER_MAX_BYTES + 1)], 'big.pdf')] }))).status, 413);
  assert.equal((await app.POST(app.request({ files: Array.from({ length: 6 }, (_, i) => new File(['x'], `${i}.pdf`)) }))).status, 413);
  assert.equal(app.requests.length, 0);
});
test('sends images and supported document types to Responses only with explicit AI consent', async () => {
  const app = harness({ key: 'test-only-not-a-real-key' });
  const files = ['png', 'pdf', 'docx', 'xlsx', 'xls'].map((extension) => new File(['fixture'], 'shipment.' + extension));
  const response = await app.POST(app.request({ ai: true, files }));
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.parsed.items[0].pieces, '7');
  assert.ok(result.warnings.some((warning) => warning.includes('1,000')));
  const sent = app.requests[0]; assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.body.model, 'gpt-5.4-mini');
  assert.equal(sent.body.store, false); assert.equal(sent.body.text.format.strict, true);
  assert.equal(sent.body.input[0].content.filter((part) => part.type === 'input_image').length, 1);
  assert.equal(sent.body.input[0].content.filter((part) => part.type === 'input_file').length, 3);
  assert.match(sent.body.input[0].content[0].text, /EXCEL CELL DATA/);
  assert.match(sent.body.input[0].content[0].text, /重量\(KG\)/);
  assert.equal(sent.body.tools, undefined);
});
test('rejects incomplete/refused AI responses and throttles repeated paid requests', async () => {
  const incomplete = harness({ key: 'test', payload: { status: 'incomplete' } });
  assert.equal((await incomplete.POST(incomplete.request({ ai: true }))).status, 502);
  const refused = harness({ key: 'test', payload: { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] } });
  assert.equal((await refused.POST(refused.request({ ai: true }))).status, 422);
  const app = harness({ key: 'test' });
  for (let i = 0; i < 6; i++) assert.equal((await app.POST(app.request({ ai: true }))).status, 200);
  assert.equal((await app.POST(app.request({ ai: true }))).status, 429);
  assert.equal(app.requests.length, 6);
});
test('uses verified workbook cargo instead of AI duplicating the shipment total as first group quantity', async () => {
  const app = harness({ key: 'test' });
  const response = await app.POST(app.request({ ai: true, value: '', files: [new File(['fixture'], 'shipment.xlsx')] }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.parsed.items.length, 2);
  assert.equal(result.parsed.items[0].pallets, '1');
  assert.equal(result.parsed.items[1].pallets, '4');
  assert.equal(result.parsed.items[0].packaging, 'Crate');
});
