// Mengamati halaman sumber SEBELUM selector ditetapkan. Output ke data/discovery/<engine>/:
//  rendered.html, text.txt, network.json (permintaan jaringan), storage.json (localStorage/sessionStorage),
//  globals.json (properti window baru), candidates.json (elemen berulang yang memuat TP & SL).
// Jalankan: workflow "Discover" di GitHub Actions (atau `npm run discover`).
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, waitForDomQuiet } from '../browser/session.js';

const sources = JSON.parse(fs.readFileSync(new URL('../../config/sources.json', import.meta.url), 'utf8'));

function inspectPage() {
  const sig = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const path = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 5; e = e.parentElement) p.unshift(sig(e)); return p.join(' > '); };
 const hit = [...document.querySelectorAll('body *')].filter((e) => {
  const t = e.innerText || '';
  return t.length > 20 &&
    t.length < 1200 &&
    /\bTP\d?\b/i.test(t) &&
    /\bSL\b/i.test(t);
}).filter((e) => ![...e.children].some((c) =>
  /\bTP\d?\b/i.test(c.innerText || '') &&
  /\bSL\b/i.test(c.innerText || '')
));
  }).filter((e) => ![...e.children].some((c) => /\bTP\b/i.test(c.innerText || '') && /\bSL\b/i.test(c.innerText || '')));
  const groups = {};
  for (const e of hit) { const k = path(e); (groups[k] ||= []).push((e.innerText || '').slice(0, 400)); }
  const baseline = new Set(['location', 'document', 'window', 'self', 'top', 'parent', 'frames', 'history', 'navigator', 'screen', 'console']);
  const globals = Object.keys(window).filter((k) => !baseline.has(k) && !/^(on|webkit|chrome)/.test(k)).slice(-80);
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) o[s.key(i)] = (s.getItem(s.key(i)) || '').slice(0, 3000); return o; };
  return { candidates: Object.entries(groups).map(([selectorPath, samples]) => ({ selectorPath, count: samples.length, samples: samples.slice(0, 3) })),
    globals, storage: { local: dump(localStorage), session: dump(sessionStorage) }, text: document.body.innerText, html: document.documentElement.outerHTML };
}

await withBrowser(async (ctx) => {
  for (const engine of ['crypto', 'tn']) {
    const cfg = sources[engine], dir = path.join('data', 'discovery', engine);
    fs.mkdirSync(dir, { recursive: true });
    const page = await ctx.newPage(), net = [];
    page.on('response', async (r) => {
      const u = r.url(), ct = r.headers()['content-type'] || '';
      const e = { url: u.slice(0, 300), status: r.status(), type: r.request().resourceType(), contentType: ct };
      if (/json/.test(ct) && !/klines/.test(u)) { try { e.bodySample = (await r.text()).slice(0, 2000); } catch {} }
      net.push(e);
    });
    page.on('pageerror', (e) => net.push({ pageerror: String(e).slice(0, 300) }));
    try {
      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: cfg.gotoTimeoutMs });
      await page.evaluate(waitForDomQuiet, { quietMs: 3000, timeoutMs: 40000 });
      try { await page.getByText(cfg.scanButtonText, { exact: true }).first().click({ timeout: 8000 }); }
      catch { net.push({ note: 'tombol scan tidak ditemukan' }); }
      await page.evaluate(waitForDomQuiet, { quietMs: cfg.quietMs, timeoutMs: cfg.scanTimeoutMs });
      const r = await page.evaluate(inspectPage);
      fs.writeFileSync(path.join(dir, 'rendered.html'), r.html);
      fs.writeFileSync(path.join(dir, 'text.txt'), r.text);
      fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify(r.candidates, null, 2));
      fs.writeFileSync(path.join(dir, 'globals.json'), JSON.stringify(r.globals, null, 2));
      fs.writeFileSync(path.join(dir, 'storage.json'), JSON.stringify(r.storage, null, 2));
    } catch (e) { net.push({ fatal: String(e.message).slice(0, 300) }); }
    fs.writeFileSync(path.join(dir, 'network.json'), JSON.stringify(net, null, 2));
    await page.close();
    console.log(`discovery ${engine}: ${net.length} network entries`);
  }
});
