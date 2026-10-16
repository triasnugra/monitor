/*
 * Mengamati halaman sumber untuk memverifikasi selector. Output: data/discovery/<engine>/
 *   rendered.html, text.txt, network.json, storage.json, globals.json, candidates.json, status.json
 *
 * Penguat anti-menggantung:
 *  - setiap langkah punya batas waktu keras (page.evaluate Playwright tidak punya timeout bawaan)
 *  - hasil parsial ditulis walau ada langkah gagal; status.json mencatat langkah mana yang macet
 *  - watchdog + handler SIGTERM/SIGINT menulis hasil parsial sebelum keluar
 *
 * Mesin dipilih lewat env DISCOVER_ENGINES (default "crypto"), mis. "crypto,tn".
 */
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, waitForDomQuiet, withTimeout } from '../browser/session.js';

const sources = JSON.parse(fs.readFileSync(new URL('../../config/sources.json', import.meta.url), 'utf8'));
const wanted = (process.env.DISCOVER_ENGINES || 'crypto').split(',').map((s) => s.trim()).filter((e) => sources[e]?.url);
const WATCHDOG_MS = Number(process.env.DISCOVER_WATCHDOG_MS || 8 * 60_000);
const t0 = Date.now();
const log = (m) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const states = new Map(); // engine -> { dir, net, steps }
function flush(reason) {
  for (const [engine, st] of states) {
    try {
      fs.mkdirSync(st.dir, { recursive: true });
      fs.writeFileSync(path.join(st.dir, 'network.json'), JSON.stringify(st.net, null, 2));
      fs.writeFileSync(path.join(st.dir, 'status.json'), JSON.stringify({ engine, flushReason: reason, elapsedSec: (Date.now() - t0) / 1000, steps: st.steps }, null, 2));
    } catch (e) { console.error(`flush ${engine} gagal: ${e.message}`); }
  }
}
const watchdog = setTimeout(() => { log('WATCHDOG: batas waktu total tercapai'); flush('watchdog'); process.exit(3); }, WATCHDOG_MS);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log(`${sig} diterima`); flush(sig); process.exit(143); });

// Dijalankan di dalam halaman. Murah: prasaring dengan textContent (tanpa layout), innerText hanya untuk kandidat.
function inspectPage() {
  const sig = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const elementPath = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 5; e = e.parentElement) p.unshift(sig(e)); return p.join(' > '); };
  const matches = (t) => /\bTP\d?\b/i.test(t) && /\bSL\b/i.test(t);
  const pre = [...document.querySelectorAll('body *')].filter((e) => {
    const t = e.textContent || '';
    return t.length > 20 && t.length < 1500 && t.includes('TP') && t.includes('SL');
  }).slice(0, 400);
  const hit = pre.filter((e) => matches(e.innerText || '')).filter((e) => ![...e.children].some((c) => matches(c.innerText || '')));
  const groups = {};
  for (const e of hit) (groups[elementPath(e)] ||= []).push((e.innerText || '').slice(0, 400));
  const baseline = new Set(['location', 'document', 'window', 'self', 'top', 'parent', 'frames', 'history', 'navigator', 'screen', 'console']);
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) o[s.key(i)] = (s.getItem(s.key(i)) || '').slice(0, 3000); return o; };
  return {
    candidates: Object.entries(groups).map(([selectorPath, samples]) => ({ selectorPath, count: samples.length, samples: samples.slice(0, 3) })),
    globals: Object.keys(window).filter((k) => !baseline.has(k) && !/^(on|webkit|chrome)/.test(k)).slice(-80),
    storage: { local: dump(localStorage), session: dump(sessionStorage) },
    text: document.body.innerText,
    html: document.documentElement.outerHTML,
  };
}

async function discoverEngine(ctx, engine) {
  const cfg = sources[engine];
  const st = { dir: path.join('data', 'discovery', engine), net: [], steps: [] };
  states.set(engine, st);
  fs.mkdirSync(st.dir, { recursive: true });
  const page = await ctx.newPage();

  const step = async (name, ms, fn) => {
    const s0 = Date.now();
    log(`${engine}: ${name} mulai (batas ${ms}ms)`);
    try {
      const v = await withTimeout(fn(), ms, `${engine}:${name}`);
      st.steps.push({ name, ok: true, ms: Date.now() - s0 });
      log(`${engine}: ${name} selesai ${Date.now() - s0}ms`);
      return v;
    } catch (e) {
      st.steps.push({ name, ok: false, ms: Date.now() - s0, error: String(e.message).slice(0, 200) });
      log(`${engine}: ${name} GAGAL: ${String(e.message).slice(0, 120)}`);
      return null;
    }
  };

  page.on('response', async (r) => {
    try {
      const u = r.url(), ct = r.headers()['content-type'] || '';
      const e = { url: u.slice(0, 300), status: r.status(), type: r.request().resourceType(), contentType: ct };
      if (/json/.test(ct) && !/klines|ticker\/24hr|coingecko/.test(u)) {
        try { e.bodySample = (await withTimeout(r.text(), 5000, 'response.text')).slice(0, 2000); } catch { /* tidak tersedia */ }
      }
      st.net.push(e);
    } catch { /* abaikan */ }
  });
  page.on('pageerror', (e) => st.net.push({ pageerror: String(e).slice(0, 300) }));

  try {
    await step('goto', cfg.gotoTimeoutMs + 5000, () => page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: cfg.gotoTimeoutMs }));
    await step('wait-initial', 45_000, () => page.evaluate(waitForDomQuiet, { quietMs: 3000, timeoutMs: 40_000 }));
    await step('click-scan', 12_000, () => page.getByText(cfg.scanButtonText, { exact: true }).first().click({ timeout: 8000 }));
    await step('wait-scan', (cfg.scanTimeoutMs ?? 120_000) + 15_000, () => page.evaluate(waitForDomQuiet, { quietMs: cfg.quietMs ?? 4000, timeoutMs: cfg.scanTimeoutMs ?? 120_000 }));
    const r = await step('inspect', 60_000, () => page.evaluate(inspectPage));
    if (r) {
      fs.writeFileSync(path.join(st.dir, 'rendered.html'), r.html);
      fs.writeFileSync(path.join(st.dir, 'text.txt'), r.text);
      fs.writeFileSync(path.join(st.dir, 'candidates.json'), JSON.stringify(r.candidates, null, 2));
      fs.writeFileSync(path.join(st.dir, 'globals.json'), JSON.stringify(r.globals, null, 2));
      fs.writeFileSync(path.join(st.dir, 'storage.json'), JSON.stringify(r.storage, null, 2));
    } else {
      // inspect macet/gagal: ambil minimal HTML lewat content() yang tidak menjalankan JS halaman
      const html = await step('fallback-content', 20_000, () => page.content());
      if (html) fs.writeFileSync(path.join(st.dir, 'rendered.html'), html);
    }
  } finally {
    flush('engine-done');
    await withTimeout(page.close(), 10_000, `${engine}:page.close`).catch(() => {});
    log(`${engine}: selesai, ${st.net.length} entri jaringan`);
  }
}

try {
  log(`mesin: ${wanted.join(', ') || '(tidak ada)'}`);
  await withBrowser(async (ctx) => { for (const e of wanted) await discoverEngine(ctx, e); });
  clearTimeout(watchdog);
  const failed = [...states.values()].flatMap((s) => s.steps).filter((s) => !s.ok);
  log(`selesai. langkah gagal: ${failed.length}${failed.length ? ' -> ' + failed.map((f) => f.name).join(', ') : ''}`);
  process.exit(0); // data parsial tetap dikomit oleh workflow; langkah gagal terlihat di status.json
} catch (e) {
  log(`FATAL: ${e.message}`);
  flush('fatal');
  process.exit(1);
}
