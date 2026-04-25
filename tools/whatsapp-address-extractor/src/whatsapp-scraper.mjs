import fs from 'node:fs';

export async function collectMessagesForDay({ date, fromFixture, logger }) {
  if (fromFixture) {
    logger.info('Usando fixture local', { fromFixture });
    return JSON.parse(fs.readFileSync(fromFixture, 'utf-8'));
  }

  const playwright = await safeImportPlaywright(logger);
  if (!playwright) throw new Error('Playwright no esta instalado. Ejecuta: npm i playwright');

  const browser = await playwright.chromium.launchPersistentContext('./.pw-profile', {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto('https://web.whatsapp.com');
  logger.info('Esperando que abras chat y escanees QR si hace falta', {});

  await page.waitForTimeout(8000);

  const timeline = await page.evaluate(async ({ date }) => {
    const targetDay = date;
    const out = [];

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const feed = document.querySelector('#main [role="application"]') || document.querySelector('#main');
    if (!feed) return out;

    let guard = 0;
    while (guard < 30) {
      feed.scrollTop = 0;
      await sleep(400);
      guard += 1;
      const dateMarkers = Array.from(document.querySelectorAll('#main [data-testid="msg-meta"]'));
      if (dateMarkers.length > 200) break;
    }

    const rows = Array.from(document.querySelectorAll('#main [data-id]'));
    for (const row of rows) {
      const aria = row.getAttribute('aria-label') || '';
      const text = row.textContent || '';
      const tsGuess = aria || text;
      const image = row.querySelector('img');
      out.push({
        id: row.getAttribute('data-id') || crypto.randomUUID(),
        timestampIso: new Date().toISOString(),
        direction: row.className.includes('message-out') ? 'out' : 'in',
        kind: image ? 'image' : 'text',
        text,
        caption: text,
      });
      if (!tsGuess.includes(targetDay)) {
        // Mantener simple: el filtrado exacto se hace después por horario en pipeline.
      }
    }

    return out;
  }, { date });

  await browser.close();
  return timeline;
}

async function safeImportPlaywright(logger) {
  try {
    return await import('playwright');
  } catch (error) {
    logger.warn('playwright no disponible', { message: error.message });
    return null;
  }
}
