import { createHash } from 'node:crypto';
import { parseNumberDetailed } from './util/num.js';
import { parseTime, toIso, toWib } from './util/time.js';
import { splitRange } from './parsers/shared.js';

const LONG_RE = /\b(long|buy|naik|bull)/i, SHORT_RE = /\b(short|sell|turun|bear)/i;

export function normalizeTicker(raw) {
  if (!raw) return { ticker: null, symbol: null };
  const t = String(raw).toUpperCase().trim().replace(/[-_ ]?PERP$/, '');
  const m = t.match(/^([A-Z0-9]{2,15}?)(?:[/\-_. ]?(USDT|USDC|BUSD|USD))?$/);
  if (!m) return { ticker: null, symbol: null };
  const [, base, quote] = m;
  // Simbol pasar hanya dibentuk untuk pasangan USDT (konsisten dengan sumber harga Binance).
  return { ticker: base, symbol: !quote || quote === 'USDT' ? `${base}USDT` : null };
}
export function normalizeDirection(raw) {
  if (!raw) return null;
  const long = LONG_RE.test(raw), short = SHORT_RE.test(raw);
  return long && !short ? 'LONG' : short && !long ? 'SHORT' : null;
}
export function normalizeEntryType(raw) {
  if (!raw) return null;
  if (/limit/i.test(raw)) return 'limit';
  if (/market|pasar/i.test(raw)) return 'market';
  return String(raw).toLowerCase();
}

const fp = (parts) => createHash('sha1').update(JSON.stringify(parts)).digest('hex');

/**
 * parsed = output parser ({engine, fields, rawText, rawHtml}); ctx = {scanTimeMs, sourceUrl}.
 * Field yang tidak ada -> null, dan dicatat di `missing`.
 */
export function normalizeSetup(parsed, ctx) {
  const f = parsed.fields, warnings = [], missing = [];
  const num = (key) => {
    const r = parseNumberDetailed(f[key]);
    if (r.ambiguous) warnings.push(`AMBIGUOUS_NUMBER_FORMAT:${key}=${f[key]}`);
    return r.value;
  };
  const { ticker, symbol } = normalizeTicker(f.ticker);
  const direction = normalizeDirection(f.direction);
  let entryPrice = null, entryRange = null;
  if (f.entry != null) {
    const parts = splitRange(f.entry).map((x) => parseNumberDetailed(x));
    parts.forEach((p) => p.ambiguous && warnings.push(`AMBIGUOUS_NUMBER_FORMAT:entry=${f.entry}`));
    const vals = parts.map((p) => p.value).filter((x) => x != null);
    if (vals.length === 1) entryPrice = vals[0];
    if (vals.length === 2) { entryRange = [Math.min(...vals), Math.max(...vals)]; entryPrice = (vals[0] + vals[1]) / 2; }
  }
  const tps = f.takeProfit != null
    ? String(f.takeProfit).split(/[,;/]|\s{2,}/).map((x) => parseNumberDetailed(x).value).filter((x) => x != null) : [];
  const stopLoss = num('stopLoss');
  const entryType = normalizeEntryType(f.entryType ?? f.entry?.match(/\((limit|market)[^)]*\)/i)?.[1]) ?? (entryPrice != null ? 'limit' : null);
  if (entryType === 'limit' && !f.entryType && !/limit/i.test(f.entry ?? '') && entryPrice != null) warnings.push('ENTRY_TYPE_ASSUMED_LIMIT');

  const srcTime = parseTime(f.time);
  const analysisMs = srcTime ?? ctx.scanTimeMs;
  const analysisTimeSource = srcTime != null ? 'source' : 'scan';

  const rec = {
    engine: parsed.engine,
    analysisTimeUtc: toIso(analysisMs), analysisTimeWib: toWib(analysisMs), analysisTimeSource,
    ticker, symbol, direction, entryType, entryPrice, entryRange,
    takeProfit: tps.length ? tps : null, stopLoss,
    riskReward: num('riskReward'), riskPercent: num('riskPercent'), riskAmountUsd: num('riskAmountUsd'),
    quantity: num('quantity'), timeframe: f.timeframe ?? null,
    entryReason: f.entryReason ?? null, originalStatus: f.originalStatus ?? null,
    sourceUrl: ctx.sourceUrl ?? null,
    rawData: { fields: f, text: parsed.rawText },
  };
  for (const k of ['ticker', 'direction', 'entryPrice', 'takeProfit', 'stopLoss', 'riskReward', 'riskPercent', 'entryReason', 'timeframe'])
    if (rec[k] == null) missing.push(k);
  rec.warnings = warnings;
  rec.missingFields = missing;
  // ID stabil: level + (waktu sumber jika ada). Waktu scan TIDAK ikut agar scan ulang idempoten.
  const hash = fp([rec.engine, rec.symbol, rec.direction, rec.entryType, rec.entryPrice, rec.entryRange,
    rec.takeProfit, rec.stopLoss, srcTime != null ? rec.analysisTimeUtc : null]);
  rec.setupId = `${rec.engine}-${hash.slice(0, 12)}`;
  return rec;
}
