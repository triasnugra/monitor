import { summarize, groupBy, compareEngines } from './stats.js';
import { m2Category, SOURCE_CATEGORY } from '../evaluator/mesin2-rules.js';

const RES = ['TP', 'SL'];
const NOT_YET = { result: 'PENDING', notes: ['Belum dievaluasi.'] };

/** Pandangan setup dengan evaluasi diganti, agar summarize()/groupBy() bisa dipakai ulang apa adanya. */
export const monitorView = (s) => s;
export const m2View = (s) => ({ ...s, evaluation: s.evaluationM2 ?? NOT_YET });

/** Hasil jurnal /tn/ (sourceResult) dipetakan ke bentuk evaluasi. Waktu fill tidak diketahui -> triggered = null. */
export function sourceView(s) {
  const r = s.sourceResult;
  const map = { TP: 'TP', SL: 'SL', menunggu: 'PENDING', kedaluwarsa: 'EXPIRED', 'tidak terisi': 'EXPIRED', 'tidak valid': 'INVALID' };
  const result = map[r] ?? 'PENDING';
  return { ...s, evaluation: { result, rMultiple: RES.includes(result) ? s.sourceR : null,
    resultTimeUtc: s.sourceExitUtc ?? s.analysisTimeUtc, entryTimeUtc: null, reasonCode: SOURCE_CATEGORY[r] ?? null } };
}
// Waktu fill sumber tidak diketahui; waktu hasil hanya bermakna bila SEMUA hasil final punya waktu keluar (tx) dari sumber.
const srcSummary = (list) => {
  const v = list.map(sourceView);
  const sum = summarize(v);
  const fin = list.filter((s) => RES.includes(sourceView(s).evaluation.result));
  return { ...sum, triggered: null, avgMinutesToEntry: null, avgMinutesToResult: fin.every((s) => s.sourceExitUtc) ? sum.avgMinutesToResult : null };
};

const pack = (list, view) => {
  const v = list.map(view);
  return { summary: summarize(v), byDirection: groupBy(v, (s) => s.direction) };
};

/**
 * Perbandingan paralel dua aturan penilaian + rekonsiliasi dengan jurnal /tn/.
 * clusters: Map(setupId -> {isPrimary}) dari markClusters.
 */
export function buildRulesComparison(setups, clusters, cfg = {}) {
  const sel = (engine, primaryOnly) => setups.filter((s) => s.engine === engine && (!primaryOnly || clusters.get(s.setupId)?.isPrimary));
  const scopes = {};
  for (const scope of ['independent', 'all']) {
    const po = scope === 'independent';
    scopes[scope] = {};
    for (const e of ['crypto', 'tn']) {
      const l = sel(e, po);
      scopes[scope][e] = { monitor: pack(l, monitorView), mesin2: pack(l, m2View) };
      if (e === 'tn') {
        const v = l.map(sourceView);
        scopes[scope][e].source = { summary: srcSummary(l), byDirection: groupBy(v, (s) => s.direction) };
      }
    }
  }

  const copts = { minSample: cfg.minSamplePerEngine, iterations: cfg.bootstrapIterations };
  const comparison = {};
  for (const [name, view] of [['monitor', monitorView], ['mesin2', m2View]]) {
    comparison[name] = {};
    for (const scope of ['independent', 'all']) {
      const po = scope === 'independent';
      comparison[name][scope] = compareEngines(sel('crypto', po).map(view), sel('tn', po).map(view), copts);
    }
  }

  // Jembatan angka Mesin 2: dari jurnal /tn/ ke angka terminal, satu perubahan aturan per langkah.
  const tnAll = sel('tn', false), tnInd = sel('tn', true);
  const row = (key, label, note, s) => ({ key, label, note, TP: s.counts.TP, SL: s.counts.SL, resolved: s.resolved,
    published: s.published, winRate: s.winRate, expectancyR: s.expectancyR, totalR: s.totalR });
  const steps = [
    row('source', 'Jurnal /tn/ (hasil sumber, semua setup)', 'Angka yang tampil di halaman /tn/ dan jurnal manual.', srcSummary(tnAll)),
    row('mesin2_all', 'Aturan Mesin 2, dihitung ulang monitor (semua setup)', 'Harus ≈ sumber. Selisih = beda data candle/waktu run, bukan beda aturan.', summarize(tnAll.map(m2View))),
    row('monitor_all', 'Aturan monitor (semua setup)', 'TP sebelum entry → EXPIRED; TTL entry 72 jam; hold maks 30 hari.', summarize(tnAll.map(monitorView))),
    row('monitor_ind', 'Aturan monitor + sampel independen (angka terminal)', 'Satu setup per klaster near-duplicate.', summarize(tnInd.map(monitorView))),
  ];
  steps.forEach((x, i) => { if (i) { x.dTP = x.TP - steps[i - 1].TP; x.dSL = x.SL - steps[i - 1].SL; } });
  steps.push({ ...row('mesin2_ind', 'Aturan Mesin 2 + sampel independen', 'Pembanding: aturan Mesin 2 dengan filter yang sama dengan terminal.', summarize(tnInd.map(m2View))), side: true });

  // Transisi per setup: hasil Aturan Mesin 2 -> hasil aturan monitor.
  const trans = (list) => {
    const m = new Map();
    for (const s of list) {
      const a = m2Category(s.evaluationM2) ?? 'BELUM_DINILAI';
      const b = s.evaluation?.result ? s.evaluation.result + (s.evaluation.reasonCode ? '/' + s.evaluation.reasonCode : '') : 'PENDING';
      const k = `${a}\u0000${b}`; m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m].map(([k, n]) => { const [mesin2, monitor] = k.split('\u0000'); return { mesin2, monitor, n }; })
      .sort((x, y) => y.n - x.n);
  };

  // Validasi port: hasil Aturan Mesin 2 versi monitor vs hasil jurnal /tn/ per setup.
  const withSrc = tnAll.filter((s) => s.sourceResult != null);
  const mism = [];
  let agree = 0, notEvaluated = 0;
  for (const s of withSrc) {
    if (!s.evaluationM2) { notEvaluated++; continue; }
    const a = SOURCE_CATEGORY[s.sourceResult] ?? s.sourceResult, b = m2Category(s.evaluationM2);
    if (a === b) agree++;
    else mism.push({ id: s.setupId, ticker: s.ticker, direction: s.direction, analysisUtc: s.analysisTimeUtc,
      sourceResult: s.sourceResult, mesin2Result: s.evaluationM2.hasilMesin2, mesin2Category: b,
      sourceR: s.sourceR, mesin2R: s.evaluationM2.rMultiple ?? null });
  }
  const checked = tnAll.filter((s) => s.sourceCheckedUtc).map((s) => s.sourceCheckedUtc).sort();

  return {
    rules: {
      mesin2: { label: 'Aturan Mesin 2', points: [
        'Order limit tetap ditunggu sampai due (7 hari) walau harga sudah menyentuh TP sebelum entry.',
        'Candle pengisi yang menyentuh SL dihitung SL; TP di candle pengisi hanya bila terisi tepat di open.',
        'Habis waktu: tidak terisi → "tidak terisi" (0R); terisi → "kedaluwarsa" (tidak menang/kalah).',
      ] },
      monitor: { label: 'Aturan monitor', points: [
        'TP tersentuh sebelum entry → EXPIRED (TP_REACHED_BEFORE_ENTRY), bukan menang dan bukan kalah.',
        'Entry kedaluwarsa setelah 72 jam; posisi terisi dipantau maks 30 hari.',
        'TP dan SL dalam satu candle yang tidak bisa dipastikan → AMBIGUOUS.',
      ] },
    },
    dueDays: cfg.mesin2Rules?.dueDays ?? 7,
    scopes, comparison, bridge: { tn: steps },
    transitions: { tn: trans(tnAll), crypto: trans(sel('crypto', false)) },
    sourceCheck: {
      tn: { withSourceResult: withSrc.length, agree, mismatch: mism.length, notEvaluatedYet: notEvaluated,
        mismatches: mism.slice(0, 200),
        sourceChangedSinceFirstSeen: tnAll.filter((s) => s.sourceResultChangedUtc).length,
        lastSourceRefreshUtc: checked.at(-1) ?? null, neverRefreshed: tnAll.filter((s) => !s.sourceCheckedUtc).length },
    },
    notEvaluatedMesin2: setups.filter((s) => !s.evaluationM2).length,
  };
}
