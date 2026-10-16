
/*
 * Mengamati halaman sumber sebelum selector ditetapkan.
 * Output disimpan di data/discovery/<engine>/:
 * rendered.html, text.txt, network.json, storage.json,
 * globals.json, dan candidates.json.
 *
 * Jalankan workflow "Discover" di GitHub Actions
 * atau gunakan: npm run discover
 */

import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, waitForDomQuiet } from '../browser/session.js';

const sources = JSON.parse(
  fs.readFileSync(
    new URL('../../config/sources.json', import.meta.url),
    'utf8'
  )
);

function inspectPage() {
  const sig = (el) =>
    el.tagName.toLowerCase() +
    (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : '');

  const elementPath = (el) => {
    const parts = [];

    for (
      let e = el;
      e && e !== document.body && parts.length < 5;
      e = e.parentElement
    ) {
      parts.unshift(sig(e));
    }

    return parts.join(' > ');
  };

  // Cari elemen yang memuat TP, TP1, TP2, dan seterusnya,
  // serta SL sebagai kata utuh.
  const hit = [...document.querySelectorAll('body *')]
    .filter((e) => {
      const t = e.innerText || '';

      return (
        t.length > 20 &&
        t.length < 1200 &&
        /\bTP\d?\b/i.test(t) &&
        /\bSL\b/i.test(t)
      );
    })
    // Hindari memilih elemen induk jika elemen anaknya
    // sudah memuat informasi TP dan SL yang sama.
    .filter((e) => {
      return ![...e.children].some((c) => {
        const t = c.innerText || '';

        return /\bTP\d?\b/i.test(t) && /\bSL\b/i.test(t);
      });
    });

  const groups = {};

  for (const e of hit) {
    const k = elementPath(e);

    if (!groups[k]) {
      groups[k] = [];
    }

    groups[k].push((e.innerText || '').slice(0, 400));
  }

  const baseline = new Set([
    'location',
    'document',
    'window',
    'self',
    'top',
    'parent',
    'frames',
    'history',
    'navigator',
    'screen',
    'console',
  ]);

  const globals = Object.keys(window)
    .filter((k) => !baseline.has(k) && !/^(on|webkit|chrome)/.test(k))
    .slice(-80);

  const dump = (storage) => {
    const result = {};

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      result[key] = (storage.getItem(key) || '').slice(0, 3000);
    }

    return result;
  };

  return {
    candidates: Object.entries(groups).map(
      ([selectorPath, samples]) => ({
        selectorPath,
        count: samples.length,
        samples: samples.slice(0, 3),
      })
    ),
    globals,
    storage: {
      local: dump(localStorage),
      session: dump(sessionStorage),
    },
    text: document.body.innerText,
    html: document.documentElement.outerHTML,
  };
}

await withBrowser(async (ctx) => {
  for (const engine of ['crypto', 'tn']) {
    const cfg = sources[engine];
    const dir = path.join('data', 'discovery', engine);

    fs.mkdirSync(dir, { recursive: true });

    const page = await ctx.newPage();
    const net = [];

    page.on('response', async (r) => {
      const u = r.url();
      const ct = r.headers()['content-type'] || '';

      const entry = {
        url: u.slice(0, 300),
        status: r.status(),
        type: r.request().resourceType(),
        contentType: ct,
      };

      if (/json/.test(ct) && !/klines/.test(u)) {
        try {
          entry.bodySample = (await r.text()).slice(0, 2000);
        } catch {
          // Respons mungkin sudah tidak tersedia.
        }
      }

      net.push(entry);
    });

    page.on('pageerror', (e) => {
      net.push({ pageerror: String(e).slice(0, 300) });
    });

    try {
      await page.goto(cfg.url, {
        waitUntil: 'domcontentloaded',
        timeout: cfg.gotoTimeoutMs,
      });

      await page.evaluate(waitForDomQuiet, {
        quietMs: 3000,
        timeoutMs: 40000,
      });

      try {
        await page
          .getByText(cfg.scanButtonText, { exact: true })
          .first()
          .click({ timeout: 8000 });
      } catch {
        net.push({ note: 'tombol scan tidak ditemukan' });
      }

      await page.evaluate(waitForDomQuiet, {
        quietMs: cfg.quietMs,
        timeoutMs: cfg.scanTimeoutMs,
      });

      const result = await page.evaluate(inspectPage);

      fs.writeFileSync(
        path.join(dir, 'rendered.html'),
        result.html
      );

      fs.writeFileSync(
        path.join(dir, 'text.txt'),
        result.text
      );

      fs.writeFileSync(
        path.join(dir, 'candidates.json'),
        JSON.stringify(result.candidates, null, 2)
      );

      fs.writeFileSync(
        path.join(dir, 'globals.json'),
        JSON.stringify(result.globals, null, 2)
      );

      fs.writeFileSync(
        path.join(dir, 'storage.json'),
        JSON.stringify(result.storage, null, 2)
      );
    } catch (e) {
      net.push({ fatal: String(e.message).slice(0, 300) });
    }

    fs.writeFileSync(
      path.join(dir, 'network.json'),
      JSON.stringify(net, null, 2)
    );

    await page.close();

    console.log(
      `discovery ${engine}: ${net.length} network entries`
    );
  }
});
