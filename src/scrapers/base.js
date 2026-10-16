import { waitForDomQuiet, readSnapshot } from '../browser/session.js';

/**
 * Scraper generik berbasis konfigurasi (config/sources.json). Tidak menebak selector:
 * bila cardSelector null -> status NEEDS_SELECTOR_VERIFICATION + snapshot untuk diagnosis.
 *
 * Status:
 *  OK                           kartu berhasil diekstrak (>0)
 *  OK_NO_SETUPS                 scan selesai, penanda 'tanpa setup' terkonfirmasi, 0 kartu
 *  ZERO_CARDS_UNCONFIRMED       scan selesai, 0 kartu, tetapi tidak bisa dibuktikan memang kosong
 *  NEEDS_SELECTOR_VERIFICATION  selector kartu belum diverifikasi
 *  FAILED                       HTTP error / timeout / scan tidak terpicu / error lain
 */
export async function runScrape(page, cfg) {
  const t0 = Date.now();
  const diag = { httpStatus: null, jsErrors: [], failedRequests: [], errors: [], warnings: [], stable: null, cardCount: 0, durationMs: 0 };
  const out = (status, extra = {}) => { diag.durationMs = Date.now() - t0; return { status, cards: [], snapshot: null, diagnostics: diag, ...extra }; };

  page.on('pageerror', (e) => diag.jsErrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => diag.failedRequests.push(r.url().slice(0, 200)));

  try {
    const resp = await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: cfg.gotoTimeoutMs });
    diag.httpStatus = resp?.status?.() ?? null;
    if (diag.httpStatus >= 400) { diag.errors.push(`HTTP_${diag.httpStatus}`); return out('FAILED'); }
  } catch (e) { diag.errors.push(`GOTO_${/timeout/i.test(e.message) ? 'TIMEOUT' : 'ERROR'}: ${e.message.slice(0, 200)}`); return out('FAILED'); }

  let triggered = false;
  try {
    await page.getByText(cfg.scanButtonText, { exact: true }).first().click({ timeout: 10000 });
    triggered = true;
  } catch { diag.warnings.push(`Tombol '${cfg.scanButtonText}' tidak ditemukan/tidak bisa diklik; mengandalkan pemindaian otomatis saat load.`); }

  try {
    const q = await page.evaluate(waitForDomQuiet, { quietMs: cfg.quietMs, timeoutMs: cfg.scanTimeoutMs });
    diag.stable = q.stable;
    if (!q.stable) diag.warnings.push('DOM belum stabil sampai batas waktu scan.');
  } catch (e) { diag.errors.push(`WAIT_ERROR: ${e.message.slice(0, 200)}`); return out('FAILED'); }

  let snapshot;
  try { snapshot = await page.evaluate(readSnapshot); } catch (e) { diag.errors.push(`SNAPSHOT_ERROR: ${e.message.slice(0, 200)}`); return out('FAILED'); }

  if (!cfg.cardSelector) {
    diag.warnings.push('cardSelector belum diverifikasi; jalankan workflow Discover (docs/VERIFIED.md).');
    return out('NEEDS_SELECTOR_VERIFICATION', { snapshot });
  }
  let cards = [];
  try { cards = await page.$$eval(cfg.cardSelector, (els) => els.map((e) => ({ text: e.innerText, html: e.outerHTML }))); }
  catch (e) { diag.errors.push(`EXTRACT_ERROR: ${e.message.slice(0, 200)}`); return out('FAILED', { snapshot }); }
  diag.cardCount = cards.length;

  if (cards.length > 0) return out('OK', { cards });
  if (!triggered && diag.stable === false) { diag.errors.push('SCAN_NOT_CONFIRMED'); return out('FAILED', { snapshot }); }
  if (cfg.noSetupMarkerText && snapshot.text.includes(cfg.noSetupMarkerText)) return out('OK_NO_SETUPS', { snapshot });
  return out('ZERO_CARDS_UNCONFIRMED', { snapshot });
}
