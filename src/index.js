import fs from 'node:fs';
import { normalizeSetup } from './normalize.js';
import { evaluateSetup, FINAL } from './evaluator/evaluate.js';
import { createBinanceProvider } from './price-data/binance.js';
import { buildDashboard } from './aggregate.js';
import * as store from './storage/store.js';
import { toIso } from './util/time.js';

const readCfg = (f) => JSON.parse(fs.readFileSync(new URL(`../config/${f}`, import.meta.url), 'utf8'));

/** scrapeEngine(engine, srcCfg) -> {status, cards, snapshot, diagnostics}. Diinjeksi agar mudah diuji. */
export async function collect({ scrapeEngine, parsers, sources, settings, now = Date.now(), engines = ['crypto', 'tn'] }) {
  const nowIso = toIso(now), report = {};
  let setups = store.loadSetups();
  for (const engine of engines) {
    const r = { status: 'FAILED', cards: 0, parsed: 0, added: 0, errors: [], warnings: [], emptyKind: null };
    try {
      const res = await scrapeEngine(engine, sources[engine]);
      r.status = res.status; r.cards = res.cards.length;
      r.errors = res.diagnostics.errors; r.warnings = res.diagnostics.warnings;
      r.httpStatus = res.diagnostics.httpStatus; r.jsErrors = res.diagnostics.jsErrors.length; r.durationMs = res.diagnostics.durationMs;
      const parsedList = [];
      for (const card of res.cards) {
        try { parsedList.push(normalizeSetup(parsers[engine](card), { scanTimeMs: now, sourceUrl: sources[engine].url })); }
        catch (e) { r.errors.push(`PARSE_ERROR: ${e.message}`); }
      }
      r.parsed = parsedList.length;
      const up = store.upsertSetups(setups, parsedList, nowIso, settings.cancelPatterns);
      setups = up.setups; r.added = up.added;
      r.emptyKind = res.status === 'FAILED' ? 'FETCH_FAILED' : res.status === 'NEEDS_SELECTOR_VERIFICATION' ? 'NEEDS_SELECTOR_VERIFICATION'
        : res.cards.length === 0 ? (res.status === 'OK_NO_SETUPS' ? 'NO_SETUPS' : 'ZERO_CARDS_UNCONFIRMED') : null;
      store.saveRaw(engine, nowIso, { status: res.status, diagnostics: res.diagnostics, cards: res.cards,
        snapshot: res.status === 'OK' ? null : res.snapshot }, settings.rawRetentionPerEngine);
    } catch (e) { r.errors.push(`UNEXPECTED: ${e.message}`); r.emptyKind = 'FETCH_FAILED'; }
    report[engine] = r;
  }
  store.saveSetups(setups);
  return report;
}

export async function evaluateAll({ provider, settings, now = Date.now(), reevalFinal = false }) {
  const nowIso = toIso(now), setups = store.loadSetups();
  const rep = { checked: 0, changed: 0, errors: [] };
  const audit = [];
  for (const s of setups) {
    if (!reevalFinal && FINAL.has(s.evaluation?.result)) continue;
    rep.checked++;
    try {
      const ev = await evaluateSetup(s, provider, { now, cfg: settings });
      const a = store.applyEvaluation(s, ev, nowIso); if (a.length) rep.changed++;
      audit.push(...a);
    } catch (e) {
      s.evaluation = { ...(s.evaluation || { result: 'PENDING' }), priceDataError: `${e.code || 'ERROR'}: ${e.message}`.slice(0, 200) };
      if (e.code === 'INVALID_SYMBOL') { audit.push(...store.applyEvaluation(s, { result: 'INVALID', reasonCode: 'UNKNOWN_SYMBOL', notes: [e.message], priceDataError: null, evaluatedAtUtc: nowIso }, nowIso)); }
      rep.errors.push(`${s.setupId}: ${e.message}`.slice(0, 200));
    }
  }
  store.saveSetups(setups); store.appendAudit(audit);
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
  const settings = readCfg('settings.json'), sources = readCfg('sources.json');
  const engines = only ? [only] : ['crypto', 'tn'];
  const run = { runAtUtc: toIso(Date.now()), engines: {}, evaluation: null };
  if (mode === 'collect' || mode === 'all') {
    const { withBrowser } = await import('./browser/session.js');
    const scrapers = { crypto: await import('./scrapers/crypto.js'), tn: await import('./scrapers/tn.js') };
    try { await withBrowser(async (ctx) => {
      run.engines = await collect({ engines, sources, settings,
        parsers: { crypto: scrapers.crypto.parseCard, tn: scrapers.tn.parseCard },
        scrapeEngine: async (engine, cfg) => { const page = await ctx.newPage(); try { return await scrapers[engine].scrape(page, cfg); } finally { await page.close(); } } });
    }); } catch (e) { run.fatal = `BROWSER_ERROR: ${e.message}`.slice(0, 300); }
  }
  if (mode === 'evaluate' || mode === 'all') {
    run.evaluation = await evaluateAll({ provider: createBinanceProvider({ bases: settings.binanceBaseUrls }), settings, reevalFinal: flags.includes('--reeval-final') });
  }
  const diag = store.loadDiagnostics(); diag.runs.push(run); store.saveDiagnostics(diag);
  const dash = build({ settings });
  console.log(JSON.stringify({ run, setups: dash.counts.setups }, null, 2));
}
if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
