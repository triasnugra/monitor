import test from 'node:test'; import assert from 'node:assert/strict';
import { buildDashboard } from '../src/aggregate.js';

// Setup tn sintetis dengan evaluasi yang sudah diketahui, untuk menguji jembatan rekonsiliasi.
const base = { engine: 'tn', symbol: 'AAAUSDT', direction: 'LONG', entryPrice: 1, takeProfit: [1.2], stopLoss: 0.9, analysisTimeSource: 'source', warnings: [] };
let n = 0;
const mk = (o) => { n++; return { ...base, setupId: `tn-${n}`, ticker: `C${n}`, symbol: `C${n}USDT`, analysisTimeUtc: `2026-10-1${n % 9}T00:00:00.000Z`, analysisTimeWib: 'x', ...o }; };
const ev = (result, extra = {}) => ({ result, rMultiple: result === 'TP' ? 2 : result === 'SL' ? -1 : null, resultTimeUtc: '2026-10-20T00:00:00.000Z', entryTimeUtc: '2026-10-19T00:00:00.000Z', ...extra });
const cfg = { cluster: { windowHours: 24, entryTolerance: 0.01 }, minSamplePerEngine: 30, bootstrapIterations: 50, pairWindowMinutes: 120, mesin2Rules: { dueDays: 7 } };

const setups = [
  mk({ sourceResult: 'TP', sourceR: 2, evaluation: ev('TP'), evaluationM2: ev('TP', { rule: 'mesin2', hasilMesin2: 'TP' }) }),
  mk({ sourceResult: 'SL', sourceR: -1, evaluation: ev('SL'), evaluationM2: ev('SL', { rule: 'mesin2', hasilMesin2: 'SL' }) }),
  // beda aturan: Mesin 2 = SL, monitor = EXPIRED (TP sebelum entry)
  mk({ sourceResult: 'SL', sourceR: -1, evaluation: ev('EXPIRED', { reasonCode: 'TP_REACHED_BEFORE_ENTRY', entryTimeUtc: null, rMultiple: null }), evaluationM2: ev('SL', { rule: 'mesin2', hasilMesin2: 'SL' }) }),
  mk({ sourceResult: 'TP', sourceR: 2, evaluation: ev('EXPIRED', { reasonCode: 'TP_REACHED_BEFORE_ENTRY', entryTimeUtc: null, rMultiple: null }), evaluationM2: ev('TP', { rule: 'mesin2', hasilMesin2: 'TP' }) }),
  // sumber vs port tidak cocok
  mk({ sourceResult: 'kedaluwarsa', sourceR: 0.3, evaluation: ev('PENDING'), evaluationM2: ev('SL', { rule: 'mesin2', hasilMesin2: 'SL' }) }),
  // belum dinilai Aturan Mesin 2
  mk({ sourceResult: 'menunggu', evaluation: ev('PENDING', { entryTimeUtc: null }) }),
];

test('jembatan rekonsiliasi: sumber -> Aturan Mesin 2 -> aturan monitor, dengan delta', () => {
  const d = buildDashboard({ setups, diagnostics: { runs: [] }, cfg, nowIso: '2026-10-27T00:00:00.000Z' });
  const b = Object.fromEntries(d.rulesComparison.bridge.tn.map((x) => [x.key, x]));
  assert.deepEqual([b.source.TP, b.source.SL], [2, 2]);          // sumber: 2 TP, 2 SL
  assert.deepEqual([b.mesin2_all.TP, b.mesin2_all.SL], [2, 3]);  // port: 2 TP, 3 SL (baris ke-5 dinilai SL)
  assert.deepEqual([b.monitor_all.TP, b.monitor_all.SL], [1, 1]);
  assert.equal(b.monitor_all.dTP, -1); assert.equal(b.monitor_all.dSL, -2);
});

test('transisi Aturan Mesin 2 -> monitor menunjukkan TP_REACHED_BEFORE_ENTRY', () => {
  const d = buildDashboard({ setups, diagnostics: { runs: [] }, cfg, nowIso: '2026-10-27T00:00:00.000Z' });
  const t = d.rulesComparison.transitions.tn;
  assert.equal(t.find((x) => x.mesin2 === 'SL' && x.monitor === 'EXPIRED/TP_REACHED_BEFORE_ENTRY').n, 1);
  assert.equal(t.find((x) => x.mesin2 === 'TP' && x.monitor === 'EXPIRED/TP_REACHED_BEFORE_ENTRY').n, 1);
});

test('validasi port vs sumber: selisih terdaftar; setup belum dinilai dilaporkan terpisah', () => {
  const d = buildDashboard({ setups, diagnostics: { runs: [] }, cfg, nowIso: '2026-10-27T00:00:00.000Z' });
  const c = d.rulesComparison.sourceCheck.tn;
  assert.equal(c.mismatch, 1); assert.equal(c.agree, 4); assert.equal(c.notEvaluatedYet, 1);
  assert.equal(c.mismatches[0].sourceResult, 'kedaluwarsa');
  assert.equal(d.rulesComparison.notEvaluatedMesin2, 1);
  assert.equal(d.quality.sourceVsMesin2.length, 1);
});

test('per baris dashboard memuat hasil Aturan Mesin 2 berdampingan dengan hasil monitor', () => {
  const d = buildDashboard({ setups, diagnostics: { runs: [] }, cfg, nowIso: '2026-10-27T00:00:00.000Z' });
  const r = d.setups.find((x) => x.id === 'tn-3');
  assert.equal(r.result, 'EXPIRED'); assert.equal(r.m2Result, 'SL'); assert.equal(r.m2R, -1);
});
