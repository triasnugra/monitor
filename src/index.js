import fs from 'node:fs';
import { buildRecord } from './normalize.js';
import { parseCryptoCard } from './parsers/crypto.js';
import { parseJournalEntry } from './parsers/tn.js';
import { evaluateSetup, FINAL } from './evaluator/evaluate.js';
import { createBinanceProvider } from './price-data/binance.js';
import { buildDashboard } from './aggregate.js';
import * as store from './storage/store.js';
import { toIso } from './util/time.js';

export const TO_RECORD = {
  crypto: (item, ctx) => buildRecord(parseCryptoCard(item), ctx),
  tn: (item, ctx) => buildRecord(parseJournalEntry(item), ctx),
};

const readCfg = (f) => JSON.parse(fs.readFileSync(new URL(`../config/${f}`, import.meta.url), 'utf8'));

/**
 * Koleksi satu putaran. scrapeEngine(engine, cfg) -> { status, items, diagnostics }.
 * Semua dependensi diinjeksi agar bisa diuji tanpa jaringan.
 */
export async function collect({ engines = ['crypto', 'tn'], sources, settings, now = Date.now(), scrapeEngine, toRecord = TO_RECORD, meta }) {
  const nowIso = toIso(now);
  const report = {};
  let setups = store.loadSetups();
  for (const engine of engines) {
    const r = { status: 'FAILED', cards: 0, parsed: 0, added: 0, errors: [], warnings: [], emptyKind: null, httpStatus: null, durationMs: null, forward: null, trackingStarted: false };
    try {
      const firstRun = !meta.trackingStartedUtc[engine];
      const res = await scrapeEngine(engine, sources[engine]);
      r.status = res.status;
      r.cards = res.items.length;
      r.errors = [...res.diagnostics.errors];
      r.warnings = [...res.diagnostics.warnings];
      r.httpStatus = res.diagnostics.httpStatus ?? null;
      r.durationMs = res.diagnostics.durationMs ?? null;
      r.forward = res.diagnostics.forward ?? null;

      const sc = res.diagnostics.meta?.summaryCount;
      if (sc != null && sc !== res.items.length) {
        r.warnings.push(`SUMMARY_COUNT_MISMATCH: halaman melaporkan ${sc}, terbaca ${res.items.length}`);
      }

      const records = [];
      for (const item of res.items) {
        try { records.push(toRecord[engine](item, { scanTimeMs: now, firstRun, sourceUrl: sources[engine].url })); }
        catch (e) { r.errors.push(`PARSE_ERROR: ${e.message}`.slice(0, 200)); }
      }
      r.parsed = records.length;

      const up = store.upsertSetups(setups, records, nowIso, settings.cancelPatterns);
      setups = up.setups;
      r.added = up.added;

      if ((r.status === 'OK' || r.status === 'OK_NO_SETUPS') && firstRun) {
        meta.trackingStartedUtc[engine] = nowIso;
        r.trackingStarted = true;
      }
      r.emptyKind = res.status === 'FAILED' ? 'FETCH_FAILED'
        : res.status === 'NEEDS_SELECTOR_VERIFICATION' ? 'NEEDS_SELECTOR_VERIFICATION'
        : res.items.length === 0 ? (res.status === 'OK_NO_SETUPS' ? 'NO_SETUPS' : 'ZERO_CARDS_UNCONFIRMED')
        : null;

      try {
        store.saveRaw(engine, nowIso, { status: res.status, diagnostics: res.diagnostics, items: res.items }, settings.rawRetentionPerEngine);
      } catch (e) {
        r.warnings.push(`RAW_SAVE_FAILED: ${e.message}`.slice(0, 200)); // tidak mengubah status koleksi
      }
    } catch (e) {
      r.errors.push(`UNEXPECTED: ${e.message}`.slice(0, 200));
      r.emptyKind = 'FETCH_FAILED';
    }
    report[engine] = r;
  }
  store.saveSetups(setups);
  store.saveMeta(meta);
  return report;
}

export async function evaluateAll({ provider, settings, now = Date.now(), reevalFinal = false }) {
  const nowIso = toIso(now);
  const setups = store.loadSetups();
  const rep = { checked: 0, changed: 0, errors: [] };
  const audit = [];
  for (const s of setups) {
    if (!reevalFinal && FINAL.has(s.evaluation?.result)) continue;
    rep.checked++;
    try {
      const ev = await evaluateSetup(s, provider, { now, cfg: settings });
      const a = store.applyEvaluation(s, ev, nowIso);
      if (a.length) rep.changed++;
      audit.push(...a);
    } catch (e) {
      s.evaluation = { ...(s.evaluation || { result: 'PENDING' }), priceDataError: `${e.code || 'ERROR'}: ${e.message}`.slice(0, 200) };
      if (e.code === 'INVALID_SYMBOL') {
        audit.push(...store.applyEvaluation(s, { result: 'INVALID', reasonCode: 'UNKNOWN_SYMBOL', notes: [e.message], priceDataError: null, evaluatedAtUtc: nowIso }, nowIso));
      }
      rep.errors.push(`${s.setupId}: ${e.message}`.slice(0, 200));
    }
  }
  store.saveSetups(setups);
  store.appendAudit(audit);
  return rep;
}

export function build({ settings, now = Date.now(), siteDataDir = 'site/data' }) {
  const dash = buildDashboard({ setups: store.loadSetups(), diagnostics: store.loadDiagnostics(), cfg: settings, nowIso: toIso(now) });
  store.writeJsonAtomic(`${siteDataDir}/dashboard.json`, dash);
  return dash;
}

async function main() {
  const [mode = 'all', ...flags] = process.argv.slice(2);
  const only = flags.find((f) => f.startsWith('--only='))?.split('=')[1];
  const settings = readCfg('settings.json');
  const sources = readCfg('sources.json');
  const engines = only ? [only] : ['crypto', 'tn'];
  const run = { runAtUtc: toIso(Date.now()), engines: {}, evaluation: null, fatal: null };
  const meta = store.loadMeta();

  if (mode === 'collect' || mode === 'all') {
    const needBrowser = engines.includes('crypto');
    const runCollect = (ctx) => collect({
      engines, sources, settings, meta,
      scrapeEngine: async (engine, cfg) => {
        if (engine === 'tn') {
          const { scrapeTn } = await import('./scrapers/tn.js');
          return scrapeTn(cfg);
        }
        const { scrape } = await import('./scrapers/crypto.js');
        const page = await ctx.newPage();
        try { return await scrape(page, cfg); } finally { await page.close(); }
      },
    });
    try {
      if (needBrowser) {
        const { withBrowser } = await import('./browser/session.js');
        run.engines = await withBrowser((ctx) => runCollect(ctx));
      } else {
        run.engines = await runCollect(null);
      }
    } catch (e) {
      run.fatal = `COLLECT_ERROR: ${e.message}`.slice(0, 300);
    }
  }
  if (mode === 'evaluate' || mode === 'all') {
    run.evaluation = await evaluateAll({
      provider: createBinanceProvider({ bases: settings.binanceBaseUrls }),
      settings,
      reevalFinal: flags.includes('--reeval-final'),
    });
  }
  const diag = store.loadDiagnostics();
  diag.runs.push(run);
  store.saveDiagnostics(diag);
  const dash = build({ settings });
  console.log(JSON.stringify({ run, setups: dash.counts.setups }, null, 2));
  process.exit(0); // kegagalan sudah tercatat di diagnostics; exit 0 agar langkah commit tetap jalan
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
