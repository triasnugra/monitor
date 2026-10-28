import { TN_TIMEFRAME } from './parsers/tn.js';
import { toWib } from './util/time.js';
import { summarize, groupBy, periodStats, markClusters, compareEngines, pairSetups } from './statistics/stats.js';
import { buildRulesComparison } from './statistics/rules-compare.js';
import { m2Category } from './evaluator/mesin2-rules.js';

const view = (s, cl) => ({
  id: s.setupId, engine: s.engine, analysisWib: s.analysisTimeWib, analysisUtc: s.analysisTimeUtc, ticker: s.ticker,
  direction: s.direction, entryType: s.entryType, entry: s.entryPrice, entryRange: s.entryRange, tp: s.takeProfit,
  sl: s.stopLoss, rr: s.riskReward, riskPct: s.riskPercent, reason: s.entryReason, timeframe: s.timeframe ?? (s.engine === 'tn' ? TN_TIMEFRAME : null),
  originalStatus: s.originalStatus, latestOriginalStatus: s.latestOriginalStatus,
  result: s.evaluation?.result ?? 'PENDING', resultWib: toWib(s.evaluation?.resultTimeUtc), resultTimeSource: s.evaluation?.resultTimeSource ?? null,
  entryWib: toWib(s.evaluation?.entryTimeUtc), r: s.evaluation?.rMultiple ?? null, notes: s.evaluation?.notes ?? [],
  reasonCode: s.evaluation?.reasonCode ?? null, warnings: s.warnings ?? [], clusterId: cl?.clusterId, isPrimary: cl?.isPrimary ?? true,
  analysisTimeSource: s.analysisTimeSource, sourceResult: s.sourceResult ?? null, sourceR: s.sourceR ?? null,
  priceDataError: s.evaluation?.priceDataError ?? null,
  // Penilaian paralel dengan Aturan Mesin 2 (evaluationM2); null bila belum dinilai.
  m2Result: s.evaluationM2 ? m2Category(s.evaluationM2) : null,
  m2Label: s.evaluationM2?.hasilMesin2 ?? null, m2R: s.evaluationM2?.rMultiple ?? null,
  m2EntryWib: toWib(s.evaluationM2?.entryTimeUtc), m2ResultWib: toWib(s.evaluationM2?.resultTimeUtc),
  m2Notes: s.evaluationM2?.notes ?? [], sourceExitWib: toWib(s.sourceExitUtc),
});

export function buildDashboard({ setups, diagnostics, cfg, nowIso }) {
  const clusters = markClusters(setups, cfg.cluster);
  const rows = setups.map((s) => view(s, clusters.get(s.setupId)))
    .sort((a, b) => (a.analysisUtc < b.analysisUtc ? 1 : -1));
  const by = (e, primaryOnly) => setups.filter((s) => s.engine === e && (!primaryOnly || clusters.get(s.setupId).isPrimary));
  const engines = {};
  for (const scope of ['independent', 'all']) {
    const po = scope === 'independent';
    engines[scope] = {};
    for (const e of ['crypto', 'tn']) {
      const l = by(e, po);
      engines[scope][e] = { summary: summarize(l), byTicker: groupBy(l, (s) => s.ticker), byDirection: groupBy(l, (s) => s.direction),
        byTimeframe: groupBy(l, (s) => s.timeframe ?? (s.engine === 'tn' ? TN_TIMEFRAME : null)), byReason: groupBy(l, (s) => s.entryReason),
        daily: periodStats(l, 'daily'), weekly: periodStats(l, 'weekly'), monthly: periodStats(l, 'monthly') };
    }
  }
  const copts = { minSample: cfg.minSamplePerEngine, iterations: cfg.bootstrapIterations };
  const pairs = pairSetups(by('crypto', false), by('tn', false), cfg.pairWindowMinutes);
  const rulesComparison = buildRulesComparison(setups, clusters, cfg);
  const lastRun = diagnostics.runs.at(-1) ?? null;
  const quality = {
    invalid: rows.filter((r) => r.result === 'INVALID'), ambiguous: rows.filter((r) => r.result === 'AMBIGUOUS'),
    unverified: rows.filter((r) => r.priceDataError),
    withWarnings: rows.filter((r) => r.warnings.length), nearDuplicates: rows.filter((r) => !r.isPrimary),
    conflicts: pairs.filter((p) => p.relation === 'CONFLICT'),
    sourceDisagreements: rows.filter((r) => ['TP', 'SL'].includes(r.sourceResult) && ['TP', 'SL'].includes(r.result) && r.sourceResult !== r.result),
    unknownAnalysisTime: rows.filter((r) => r.analysisTimeSource === 'unknown_before_tracking'),
    sourceVsMesin2: rulesComparison.sourceCheck.tn.mismatches,
  };
  return { generatedAtUtc: nowIso, generatedAtWib: toWib(nowIso), counts: { setups: rows.length },
    engines, rulesComparison, comparison: { independent: compareEngines(by('crypto', true), by('tn', true), copts),
      all: compareEngines(by('crypto', false), by('tn', false), copts) },
    pairs, setups: rows, quality, diagnostics: { lastRun, runs: diagnostics.runs.slice(-50) },
    methodology: { source: 'Binance Spot klines', note: 'Hasil teoretis berbasis candle (bukan trading nyata): tanpa fee/slippage, fill saat harga menyentuh level.',
      defaultRule: 'monitor', rules: rulesComparison.rules } };
}
