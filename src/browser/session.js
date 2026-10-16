export async function withBrowser(fn) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'id-ID', timezoneId: 'UTC' });
    return await fn(ctx);
  } finally { await browser.close(); }
}

// Dijalankan DI DALAM browser (via page.evaluate). Menunggu DOM diam selama quietMs.
export function waitForDomQuiet({ quietMs, timeoutMs }) {
  return new Promise((resolve) => {
    let last = Date.now(); const start = last;
    const mo = new MutationObserver(() => { last = Date.now(); });
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const iv = setInterval(() => {
      const now = Date.now();
      if (now - last >= quietMs) { clearInterval(iv); mo.disconnect(); resolve({ stable: true, waitedMs: now - start }); }
      else if (now - start >= timeoutMs) { clearInterval(iv); mo.disconnect(); resolve({ stable: false, waitedMs: now - start }); }
    }, 250);
  });
}
export function readSnapshot() {
  return { text: document.body.innerText, html: document.documentElement.outerHTML };
}
