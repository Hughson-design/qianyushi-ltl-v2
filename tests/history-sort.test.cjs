const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = stripTypeScriptTypes(fs.readFileSync('src/lib/history-sort.ts', 'utf8')).replace(/\bexport /g, '');
const { sortHistory, nextHistorySort } = vm.runInNewContext(source + ';({sortHistory,nextHistorySort})');
const row = (id, price, date = '2026-11-20') => ({ id, price, quote_number: `Q-${id}`, bol_number: `BOL-${id}`, reference: `PO-${id}`, origin_zip: '91710', destination_zip: '18031', receiver: { company: `Customer ${id}` }, carrier: 'ABF', ready_date: date, status: 'booked' });
const ids = rows => Array.from(rows, r => r.id);
test('prices sort numerically, preserve source rows and keep equal values stable', () => {
  const rows = [row(10, '1000'), row(2, '90.50'), row(3, 100), row(4, '100')];
  assert.deepEqual(ids(sortHistory(rows, { key: 'price', direction: 'asc' }, {})), [2, 3, 4, 10]);
  assert.deepEqual(ids(sortHistory(rows, { key: 'price', direction: 'desc' }, {})), [10, 3, 4, 2]);
  assert.deepEqual(ids(rows), [10, 2, 3, 4]);
  assert.equal(sortHistory(rows, null, {}), rows);
});
test('dates sort chronologically with missing dates last in either direction', () => {
  const rows = [row(1, 1, null), row(2, 1, '2026-12-01'), row(3, 1, '2025-12-30')];
  assert.deepEqual(ids(sortHistory(rows, { key: 'ready_date', direction: 'asc' }, {})), [3, 2, 1]);
  assert.deepEqual(ids(sortHistory(rows, { key: 'ready_date', direction: 'desc' }, {})), [2, 3, 1]);
});
test('identifiers use natural order; blank customers and BOLs stay last', () => {
  const rows = [row(10, 1), row(2, 1), { ...row(1, 1), bol_number: null, receiver: { company: '' } }];
  for (const key of ['quote_number', 'reference']) assert.deepEqual(ids(sortHistory(rows, { key, direction: 'asc' }, {})), [1, 2, 10]);
  for (const key of ['bol_number', 'customer']) {
    assert.deepEqual(ids(sortHistory(rows, { key, direction: 'asc' }, {})), [2, 10, 1]);
    assert.deepEqual(ids(sortHistory(rows, { key, direction: 'desc' }, {})), [10, 2, 1]);
  }
});
test('column toggle starts ascending, reverses direction and supports displayed status labels', () => {
  const first = nextHistorySort(null, 'price');
  assert.equal(first.direction, 'asc');
  const second = nextHistorySort(first, 'price');
  assert.equal(second.direction, 'desc');
  assert.equal(nextHistorySort(second, 'carrier').direction, 'asc');
  const rows = [{ ...row(1, 1), status: 'void' }, row(2, 1)];
  assert.deepEqual(ids(sortHistory(rows, { key: 'status', direction: 'asc' }, { void: 'A', booked: 'Z' })), [1, 2]);
});
