import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluateMesin2Rules, gradeTrade, m2Category } from '../src/evaluator/mesin2-rules.js';
import { evaluateSetup } from '../src/evaluator/evaluate.js';
import { series } from './helpers.js';

// FIXTURE SINTETIS (bukan data pasar). Candle 1m dibangkitkan dari waypoint; candle 1h = agregasi 60 candle 1m penuh.
const MIN = 60000, HR = 60 * MIN, DAY = 24 * HR;
const S0 = Date.UTC(2026, 9, 8, 0, 0);               // kelipatan 1 jam
const SIG = S0 + 2 * HR + 17 * MIN;                    // sinyal 02:17 UTC (di tengah candle 1h 02:00)
const provider = (oneMin) => {
  const h1 = [];
  for (let i = 0; i + 60 <= oneMin.length; i += 60) {
    const g = oneMin.slice(i, i + 60);
    if (g[0].t % HR === 0) h1.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g.at(-1).c, closeT: g[0].t + HR - 1 });
  }
  return { getCandles: async (_s, interval, a, b) => (interval === '1h' ? h1 : oneMin).filter((c) => c.t >= a && c.t < b) };
};
const setup = (o = {}) => ({ engine: 'crypto', symbol: 'SUIUSDT', direction: 'SHORT', entryPrice: 1.144, takeProfit: [1.029], stopLoss: 1.201,
  analysisTimeUtc: new Date(SIG).toISOString(), analysisTimeSource: 'first_seen', ...o });
const NOW = S0 + 10 * DAY;
const mk = (wp, minutes = 9 * 24 * 60) => provider(series(S0, minutes, wp, 0));
const m2 = (s, p, now = NOW) => evaluateMesin2Rules(s, p, { now, dueDays: 7 });

test('Mesin 2: entry tersentuh lalu TP -> TP, R = jarak TP / jarak SL', async () => {
  const r = await m2(setup(), mk([[0, 1.10], [300, 1.15], [600, 1.02], [20000, 1.0]]));
  assert.equal(r.result, 'TP'); assert.equal(r.hasilMesin2, 'TP');
  assert.ok(Math.abs(r.rMultiple - (1.144 - 1.029) / (1.201 - 1.144)) < 1e-9);
  assert.ok(r.entryTimeUtc && Date.parse(r.entryTimeUtc) <= Date.parse(r.resultTimeUtc));
});

test('KUNCI: TP tersentuh SEBELUM entry tidak mematikan setup di Aturan Mesin 2; lalu entry terisi dan kena SL -> SL', async () => {
  // turun ke 1.02 (TP) tanpa menyentuh entry 1.144, lalu naik menembus entry dan SL 1.201
  const wp = [[0, 1.10], [400, 1.02], [1500, 1.10], [2000, 1.25], [20000, 1.25]];
  const rm2 = await m2(setup(), mk(wp));
  assert.equal(rm2.result, 'SL'); assert.equal(rm2.rMultiple, -1);
  // aturan monitor pada data yang sama: setup sudah mati sejak TP tercapai sebelum entry
  const rmon = await evaluateSetup(setup(), mk(wp), { now: NOW });
  assert.equal(rmon.result, 'EXPIRED'); assert.equal(rmon.reasonCode, 'TP_REACHED_BEFORE_ENTRY');
});

test('Mesin 2: candle pengisi yang menyentuh SL dihitung SL', async () => {
  const oneMin = series(S0, 9 * 24 * 60, [[0, 1.10], [20000, 1.10]], 0);
  const i = oneMin.findIndex((c) => c.t === S0 + 5 * HR + 10 * MIN);
  oneMin[i] = { ...oneMin[i], o: 1.10, h: 1.21, l: 1.10, c: 1.205 };   // satu candle menyentuh entry 1.144 dan SL 1.201
  const r = await m2(setup(), provider(oneMin));
  assert.equal(r.result, 'SL');
});

test('Mesin 2: tidak terisi sampai due -> EXPIRED/NOT_FILLED ("tidak terisi"), 0R', async () => {
  const r = await m2(setup(), mk([[0, 1.10], [20000, 1.12]]));
  assert.equal(r.result, 'EXPIRED'); assert.equal(r.reasonCode, 'NOT_FILLED'); assert.equal(r.hasilMesin2, 'tidak terisi');
  assert.equal(r.rMultiple, null); assert.equal(m2Category(r), 'NOT_FILLED');
});

test('Mesin 2: terisi tetapi TP/SL tak tercapai sampai due -> EXPIRED/EXPIRED_FILLED ("kedaluwarsa") dengan markR', async () => {
  const r = await m2(setup(), mk([[0, 1.10], [300, 1.15], [600, 1.14], [20000, 1.14]]));
  assert.equal(r.result, 'EXPIRED'); assert.equal(r.reasonCode, 'EXPIRED_FILLED'); assert.equal(r.hasilMesin2, 'kedaluwarsa');
  assert.equal(r.rMultiple, null); assert.ok(r.markR > 0 && r.markR < 1);
});

test('Mesin 2: sebelum due dan belum selesai -> PENDING', async () => {
  const r = await m2(setup(), mk([[0, 1.10], [3000, 1.12]], 3000), S0 + 2 * DAY);
  assert.equal(r.result, 'PENDING'); assert.equal(r.reasonCode, 'WAITING_ENTRY');
});

test('Mesin 2: candle sebelum waktu sinyal tidak dipakai (spike 02:00-02:16 diabaikan)', async () => {
  const oneMin = series(S0, 9 * 24 * 60, [[0, 1.10], [20000, 1.10]], 0);
  const i = oneMin.findIndex((c) => c.t === S0 + 2 * HR + 5 * MIN);
  oneMin[i] = { ...oneMin[i], h: 1.30, l: 1.0 };      // sebelum sinyal 02:17
  const r = await m2(setup(), provider(oneMin));
  assert.notEqual(r.result, 'SL'); assert.notEqual(r.result, 'TP');
});

test('Mesin 2: SL dan TP dalam satu candle 1H diurutkan lewat data 1 menit (SL lebih dulu)', async () => {
  const oneMin = series(S0, 9 * 24 * 60, [[0, 1.10], [300, 1.15], [20000, 1.15]], 0);
  const base = S0 + 6 * HR;
  const at = (m, o, h, l, c) => { const i = oneMin.findIndex((x) => x.t === base + m * MIN); oneMin[i] = { ...oneMin[i], o, h, l, c }; };
  at(10, 1.15, 1.205, 1.15, 1.20); at(40, 1.20, 1.20, 1.02, 1.03);
  const r = await m2(setup(), provider(oneMin));
  assert.equal(r.result, 'SL'); assert.equal(r.resultTimeUtc, new Date(base + 10 * MIN).toISOString());
});

test('Mesin 2: waktu analisis tidak diketahui / level tak konsisten -> INVALID, tidak menebak', async () => {
  const p = mk([[0, 1.10], [20000, 1.10]]);
  assert.equal((await m2(setup({ analysisTimeSource: 'unknown_before_tracking' }), p)).reasonCode, 'ANALYSIS_TIME_UNKNOWN');
  assert.equal((await m2(setup({ direction: 'LONG' }), p)).result, 'INVALID');
  assert.equal((await m2(setup({ stopLoss: null }), p)).result, 'INVALID');
});

test('Mesin 2 (tn): due diambil dari rawData.due milik sumber bila ada', async () => {
  const due = SIG + 1 * DAY;
  const r = await m2(setup({ engine: 'tn', rawData: { due } }), mk([[0, 1.10], [20000, 1.12]]));
  assert.equal(r.dueUtc, new Date(due).toISOString());
  assert.equal(r.resultTimeUtc, new Date(due).toISOString());
});

test('gradeTrade tanpa m1: SL didahulukan bila SL dan TP di candle yang sama (konservatif, sama dengan trade-sim.mjs)', async () => {
  const h1 = async () => [{ ot: S0 + 6 * HR, o: 1.15, h: 1.205, l: 1.02, c: 1.1, ct: S0 + 7 * HR - 1 }];
  const g = await gradeTrade({ arah: 'SHORT', entry: 1.144, sl: 1.201, tp: 1.029, t: S0, due: S0 + 7 * DAY }, { h1, now: S0 + 8 * DAY });
  assert.equal(g.hasil, 'SL');
});
