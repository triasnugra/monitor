import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { runScrape } from '../src/scrapers/base.js';
import { makeProvider, series, T0 } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { collect, evaluateAll, build } = await import('../src/index.js');
const store = await import('../src/storage/store.js');
const { parseCard } = await import('../src/parsers/crypto.js');

const settings = { cancelPatterns: ['batal'], rawRetentionPerEngine: 3, entryTtlHours: 72, maxHoldDays: 30, sanityMaxDeviation: 0.5,
  minSamplePerEngine: 30, bootstrapIterations: 200, pairWindowMinutes: 120, cluster: { windowHours: 24, entryTolerance: 0.01 } };
const sources = { crypto: { url: 'x' }, tn: { url: 'y' } };
const card = { text: 'Koin: SUI\nArah: SHORT\nEntry: 1.144 (limit)\nTP: 1.029\nSL: 1.201\nRR: 2\nRisiko %: 1\nAlasan: retest' };
const ok = (cards) => ({ status: cards.length ? 'OK' : 'OK_NO_SETUPS', cards, snapshot: null, diagnostics: { errors: [], warnings: [], jsErrors: [], httpStatus: 200, durationMs: 1 } });
const NOW = T0 + 10 * 3600e3;

function fakePage({ goto = async () => ({ status: () => 200 }), click = async () => {}, cards = [], text = '' , stable = true } = {}) {
  return { on() {}, goto, getByText: () => ({ first: () => ({ click }) }),
    evaluate: async (fn) => (fn.name === 'waitForDomQuiet' ? { stable, waitedMs: 1 } : { text, html: '<html/>' }),
    $$eval: async () => cards };
}
const cfg = { url: 'u', scanButtonText: 'Pindai ulang', cardSelector: '.c', gotoTimeoutMs: 1, scanTimeoutMs: 1, quietMs: 1 };

test('scraper: membedakan OK, tanpa setup, gagal, timeout, dan selector belum diverifikasi', async () => {
  assert.equal((await runScrape(fakePage({ cards: [{ text: 'a', html: '' }] }), cfg)).status, 'OK');
  assert.equal((await runScrape(fakePage({ text: 'Tidak ada setup' }), { ...cfg, noSetupMarkerText: 'Tidak ada setup' })).status, 'OK_NO_SETUPS');
  assert.equal((await runScrape(fakePage(), cfg)).status, 'ZERO_CARDS_UNCONFIRMED');
  assert.equal((await runScrape(fakePage({ goto: async () => ({ status: () => 503 }) }), cfg)).status, 'FAILED');
  const t = await runScrape(fakePage({ goto: async () => { throw new Error('Timeout 1ms exceeded'); } }), cfg);
  assert.equal(t.status, 'FAILED'); assert.match(t.diagnostics.errors[0], /GOTO_TIMEOUT/);
  assert.equal((await runScrape(fakePage({ click: async () => { throw new Error('x'); }, stable: false }), cfg)).status, 'FAILED');
  const nv = await runScrape(fakePage(), { ...cfg, cardSelector: null });
  assert.equal(nv.status, 'NEEDS_SELECTOR_VERIFICATION'); assert.ok(nv.snapshot);
});

test('pipeline: collect idempoten, histori tidak dihapus, evaluasi + dashboard', async () => {
  const run = (cards) => collect({ engines: ['crypto'], sources, settings, now: NOW, parsers: { crypto: parseCard }, scrapeEngine: async () => ok(cards) });
  let r = await run([card]); assert.equal(r.crypto.added, 1);
  r = await run([card]); assert.equal(r.crypto.added, 0);                 // idempoten
  assert.equal(store.loadSetups().length, 1); assert.equal(store.loadSetups()[0].seenCount, 2);
  r = await run([]); assert.equal(r.crypto.emptyKind, 'NO_SETUPS');       // hasil kosong tidak menghapus histori
  assert.equal(store.loadSetups().length, 1);
  const f = await collect({ engines: ['crypto'], sources, settings, now: NOW, parsers: { crypto: parseCard },
    scrapeEngine: async () => ({ status: 'FAILED', cards: [], snapshot: null, diagnostics: { errors: ['HTTP_503'], warnings: [], jsErrors: [], httpStatus: 503, durationMs: 1 } }) });
  assert.equal(f.crypto.emptyKind, 'FETCH_FAILED'); assert.equal(store.loadSetups().length, 1);
  assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, 'raw', 'crypto')).length <= 3);   // retensi raw

  // setup dicatat dengan analisis = waktu scan (T0+10h); buat harga yang membuat TP tersentuh
  const setups = store.loadSetups(); setups[0].analysisTimeUtc = '2026-10-08T01:47:00.000Z'; store.saveSetups(setups);
  const provider = makeProvider(series(T0, 2000, [[0, 1.10], [60, 1.15], [300, 1.12], [975, 1.035], [976, 1.0289], [977, 1.02], [3000, 1.0]], 0));
  const rep = await evaluateAll({ provider, settings, now: T0 + 40 * 3600e3 });
  assert.equal(rep.changed, 1);
  assert.equal(store.loadSetups()[0].evaluation.result, 'TP');
  const audit = fs.readFileSync(path.join(process.env.DATA_DIR, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual([audit[0].from, audit[0].to], ['PENDING', 'TP']);
  assert.equal((await evaluateAll({ provider, settings, now: T0 + 41 * 3600e3 })).checked, 0);   // final tidak diubah

  const dash = build({ settings, now: NOW, siteDataDir: path.join(tmp, 'site') });
  const j = JSON.parse(fs.readFileSync(path.join(tmp, 'site', 'dashboard.json'), 'utf8'));
  assert.equal(j.setups[0].resultWib, '2026-10-09 01:00'); assert.equal(j.engines.all.crypto.summary.counts.TP, 1);
  assert.equal(j.comparison.all.verdict, 'INSUFFICIENT_SAMPLE'); assert.equal(dash.counts.setups, 1);
});

test('error harga tidak mengubah status & tercatat sebagai belum terverifikasi', async () => {
  const bad = { getCandles: async () => { throw new Error('HTTP 451'); } };
  const setups = store.loadSetups(); setups[0].evaluation = { result: 'PENDING', notes: [] }; store.saveSetups(setups);
  const rep = await evaluateAll({ provider: bad, settings, now: NOW });
  assert.equal(rep.errors.length, 1); assert.equal(store.loadSetups()[0].evaluation.result, 'PENDING');
  assert.match(store.loadSetups()[0].evaluation.priceDataError, /451/);
});
