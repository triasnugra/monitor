import test from 'node:test'; import assert from 'node:assert/strict';
import { parseCard as parseCrypto } from '../src/parsers/crypto.js';
import { parseCard as parseTn } from '../src/parsers/tn.js';
import { normalizeSetup, normalizeTicker, normalizeDirection } from '../src/normalize.js';

// Teks kartu SINTETIS (label diasumsikan; lihat docs/VERIFIED.md). Menguji logika parser, bukan format situs asli.
const cardA = { text: 'SUI/USDT\nArah: SHORT\nEntry: 1.144 (limit)\nTP: 1.029\nSL: 1.201\nRR: 2\nRisiko %: 1\nAlasan: retest gagal di range high\nStatus: aktif' };
const cardB = { text: 'Koin: ETH\nArah: Long\nTipe entry: Limit\nEntry: 2.400 - 2.420\nTP: 2.600, 2.700\nSL: 2.350\nRisk %: 0,5\nTF: 4H\nWaktu: 2026-10-08 09:10 WIB' };
const ctx = { scanTimeMs: Date.parse('2026-10-08T02:00:00Z'), sourceUrl: 'u' };

test('normalisasi ticker, arah, tipe', () => {
  assert.deepEqual(normalizeTicker('SUIUSDT'), { ticker: 'SUI', symbol: 'SUIUSDT' });
  assert.equal(normalizeDirection('Sell'), 'SHORT'); assert.equal(normalizeDirection('buy'), 'LONG'); assert.equal(normalizeDirection('??'), null);
});
test('kartu A: field hilang menjadi null dan dicatat', () => {
  const s = normalizeSetup({ ...parseCrypto(cardA), fields: { ...parseCrypto(cardA).fields, ticker: 'SUI/USDT' } }, ctx);
  assert.equal(s.direction, 'SHORT'); assert.equal(s.entryPrice, 1.144); assert.deepEqual(s.takeProfit, [1.029]); assert.equal(s.stopLoss, 1.201);
  assert.equal(s.timeframe, null); assert.ok(s.missingFields.includes('timeframe'));
  assert.equal(s.analysisTimeSource, 'scan'); assert.equal(s.analysisTimeWib, '2026-10-08 09:00');
});
test('kartu B: rentang entry, multi TP, waktu sumber WIB', () => {
  const s = normalizeSetup(parseTn(cardB), ctx);
  assert.equal(s.ticker, 'ETH'); assert.equal(s.symbol, 'ETHUSDT');
  assert.deepEqual(s.entryRange, [2.4, 2.42]); assert.deepEqual(s.takeProfit, [2.6, 2.7]);
  assert.equal(s.riskPercent, 0.5); assert.equal(s.timeframe, '4H'); assert.equal(s.entryType, 'limit');
  assert.equal(s.analysisTimeSource, 'source'); assert.equal(s.analysisTimeUtc, '2026-10-08T02:10:00.000Z');
});
test('kartu malformed tidak melempar error', () => {
  const s = normalizeSetup(parseTn({ text: 'rusak\n???' }), ctx);
  assert.equal(s.direction, null); assert.equal(s.takeProfit, null); assert.ok(s.missingFields.length >= 5);
});
test('ID stabil & idempoten untuk scan berbeda, tanpa waktu sumber', () => {
  const a = normalizeSetup(parseTn(cardA), ctx), b = normalizeSetup(parseTn(cardA), { ...ctx, scanTimeMs: ctx.scanTimeMs + 3600e3 });
  assert.equal(a.setupId, b.setupId);
});
