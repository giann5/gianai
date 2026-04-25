import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function collectMessagesForDay({ date, fromFixture, logger, mode, debugDir, profileDir, waitForEnter }) {
  if (fromFixture) {
    logger.info('Usando fixture local', { fromFixture, mode });
    const messages = JSON.parse(fs.readFileSync(fromFixture, 'utf-8'));
    return { messages, runtime: null, scrapeStats: {} };
  }

  const playwright = await safeImportPlaywright(logger);
  if (!playwright) throw new Error('Playwright no esta instalado. Ejecuta: npm i playwright');

  fs.mkdirSync(debugDir, { recursive: true });

  const browser = await playwright.chromium.launchPersistentContext(profileDir || './.pw-profile', {
    headless: false,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });

  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto('https://web.whatsapp.com');

  logger.info('WhatsApp Web abierto', { url: page.url(), mode, profileDir });

  if (waitForEnter) {
    await waitForUserEnter('Entrá al chat correcto y presioná ENTER para empezar');
  }

  await page.waitForTimeout(1500);

  const diagnostics = await collectDomDiagnostics(page, date);
  logger.info('Diagnóstico DOM inicial', diagnostics);

  await saveDomSnapshot(page, debugDir);

  const { messages, stats } = await scrapeTimeline(page, date, logger);
  const imageCount = messages.reduce((acc, m) => acc + (m.images?.length || 0), 0);

  if (messages.length === 0 || imageCount === 0) {
    await page.screenshot({ path: path.join(debugDir, 'screenshot-no-messages.png'), fullPage: true });
    logger.warn('No hubo mensajes/fotos detectadas', {
      timelineTotal: messages.length,
      imageCount,
      debugDir,
    });
    if (mode === 'download') {
      await waitForUserEnter('No se detectaron mensajes/fotos. Revisá output/debug y presioná ENTER para cerrar...');
    }
  }

  const runtime = {
    browser,
    context: browser,
    page,
    debugDir,
    async close() {
      await browser.close();
    },
  };

  return { messages, runtime, scrapeStats: stats };
}

export async function waitForUserEnter(promptText) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(`${promptText}\n`);
  } finally {
    rl.close();
  }
}

async function collectDomDiagnostics(page, date) {
  return page.evaluate((targetDate) => {
    const messageNodes = Array.from(document.querySelectorAll('[data-id], [role="row"], [role="listitem"]'));
    const imagesVisible = Array.from(document.querySelectorAll('img')).filter((img) => img.clientWidth > 30 && img.clientHeight > 30);
    const mediaButtons = Array.from(document.querySelectorAll('button, a')).filter((el) => {
      const text = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
      return /(foto|imagen|media|descargar|download|gallery|archivo)/.test(text);
    });

    const messageCandidates = messageNodes
      .slice(-10)
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(-10);

    return {
      targetDate,
      currentUrl: location.href,
      title: document.title,
      messageLikeCount: messageNodes.length,
      visibleImageCount: imagesVisible.length,
      mediaButtonCount: mediaButtons.length,
      lastVisibleMessages: messageCandidates,
    };
  }, date);
}

async function saveDomSnapshot(page, debugDir) {
  const html = await page.content();
  const clipped = html.slice(0, 2_000_000);
  fs.writeFileSync(path.join(debugDir, 'dom-snapshot.html'), clipped, 'utf-8');
}

async function scrapeTimeline(page, targetDate, logger) {
  const result = await page.evaluate(async ({ targetDate }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const stats = {
      rawImageNodes: 0,
      ignoredSmallDataImages: 0,
      ignoredEmojiImages: 0,
      candidateRealImages: 0,
    };

    function pickMessageNodes() {
      const sets = [
        Array.from(document.querySelectorAll('#main [data-id]')),
        Array.from(document.querySelectorAll('#main [role="row"]')),
        Array.from(document.querySelectorAll('#main [role="listitem"]')),
      ];
      const merged = [];
      const seen = new Set();
      for (const set of sets) {
        for (const node of set) {
          if (!seen.has(node)) {
            seen.add(node);
            merged.push(node);
          }
        }
      }
      return merged;
    }

    function estimateDataBytes(src) {
      if (!src?.startsWith('data:image/')) return null;
      const payload = src.split(',')[1] || '';
      return Math.floor((payload.length * 3) / 4);
    }

    function looksEmoji(text) {
      if (!text) return false;
      const t = text.trim();
      return /^[\p{Emoji}\p{Extended_Pictographic}\s]+$/u.test(t);
    }

    function srcType(src, currentSrc) {
      const u = currentSrc || src || '';
      if (u.startsWith('data:')) return 'data';
      if (u.startsWith('blob:')) return 'blob';
      if (u.startsWith('https:')) return 'https';
      return 'empty';
    }

    function shouldIgnoreImage(meta) {
      const isSmall = meta.naturalWidth <= 80 || meta.naturalHeight <= 80;
      const isTinyBytes = meta.estimatedBytes !== null && meta.estimatedBytes < 5 * 1024;
      const isDataPlaceholder = meta.srcType === 'data' && /x14tgpju/i.test(meta.className || '');
      const isGifPixel = /^data:image\/gif/i.test(meta.src || meta.currentSrc || '');
      const isReaction = /reaccion|reacción|ver reacciones/i.test(meta.nearestAriaLabel || '') || looksEmoji(meta.alt || '');
      const isAvatarOrIcon = /avatar|icon|sticker|emoji/i.test(meta.className || '');

      if (isReaction || isGifPixel) return 'emoji';
      if (isSmall || isTinyBytes || isDataPlaceholder || isAvatarOrIcon) return 'small';
      return '';
    }

    function normalizeAlt(alt) {
      return (alt || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function pickRealImages(images) {
      const groupedByAlt = new Map();
      for (const img of images) {
        const key = normalizeAlt(img.alt || `idx-${img.imageIndex}`);
        if (!groupedByAlt.has(key)) groupedByAlt.set(key, []);
        groupedByAlt.get(key).push(img);
      }

      const merged = [];
      for (const group of groupedByAlt.values()) {
        group.sort((a, b) => {
          const typeScore = (t) => (t === 'blob' ? 3 : t === 'https' ? 2 : t === 'data' ? 1 : 0);
          const areaA = a.naturalWidth * a.naturalHeight;
          const areaB = b.naturalWidth * b.naturalHeight;
          return typeScore(b.srcType) - typeScore(a.srcType) || areaB - areaA;
        });
        merged.push(group[0]);
      }

      merged.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);

      if (merged.length <= 1) return merged;

      const top = merged[0];
      const topArea = top.naturalWidth * top.naturalHeight;
      const realAlbum = merged.filter((img) => {
        const area = img.naturalWidth * img.naturalHeight;
        return img.srcType !== 'data' && area >= topArea * 0.8;
      });

      return realAlbum.length > 1 ? realAlbum : [top];
    }

    const main = document.querySelector('#main');
    const scroller = main?.querySelector('[tabindex="-1"]') || main?.querySelector('[role="application"]') || main;

    for (let i = 0; i < 18 && scroller; i += 1) {
      scroller.scrollTop = 0;
      await sleep(350);
    }

    const nodes = pickMessageNodes();
    const items = [];

    for (let idx = 0; idx < nodes.length; idx += 1) {
      const node = nodes[idx];
      const id = node.getAttribute('data-id') || `node-${idx}`;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();

      const imgs = Array.from(node.querySelectorAll('img'));
      stats.rawImageNodes += imgs.length;

      const mapped = imgs.map((img, imageIndex) => {
        const src = img.getAttribute('src') || '';
        const currentSrc = img.currentSrc || '';
        const nearestLabel =
          img.closest('[aria-label]')?.getAttribute('aria-label') ||
          node.getAttribute('aria-label') ||
          '';
        const estimatedBytes = estimateDataBytes(currentSrc || src);

        return {
          imageIndex,
          src,
          currentSrc,
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          clientWidth: img.clientWidth || 0,
          clientHeight: img.clientHeight || 0,
          alt: img.getAttribute('alt') || '',
          className: img.className || '',
          nearestAriaLabel: nearestLabel,
          srcType: srcType(src, currentSrc),
          estimatedBytes,
          outerHtmlSnippet: img.outerHTML?.slice(0, 300) || '',
        };
      });

      const filtered = [];
      for (const img of mapped) {
        const reason = shouldIgnoreImage(img);
        if (!reason) {
          filtered.push(img);
          continue;
        }
        if (reason === 'emoji') stats.ignoredEmojiImages += 1;
        else stats.ignoredSmallDataImages += 1;
      }

      const realImages = pickRealImages(filtered);
      stats.candidateRealImages += realImages.length;

      const hasMediaByAttr = /(image|foto|media|video)/i.test(node.getAttribute('aria-label') || '');
      const kind = realImages.length > 0 || hasMediaByAttr ? 'image' : 'text';

      const prePlain = node.getAttribute('data-pre-plain-text') || '';
      const timeMatch = prePlain.match(/\[(\d{1,2}:\d{2}),\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]/);

      let iso = new Date().toISOString();
      if (timeMatch) {
        const [hh, mm] = timeMatch[1].split(':');
        const [d, m, yRaw] = timeMatch[2].split('/');
        const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
        iso = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}:00`).toISOString();
      }

      const datePart = iso.slice(0, 10);
      if (targetDate && datePart !== targetDate) continue;

      items.push({
        id,
        domIndex: idx,
        timestampIso: iso,
        direction: /message-out|outgoing/i.test(node.className) ? 'out' : 'in',
        kind,
        text,
        caption: text,
        imageUrl: realImages[0]?.currentSrc || realImages[0]?.src || '',
        images: realImages,
      });
    }

    return { items, stats };
  }, { targetDate });

  logger.info('Scraping finalizado', {
    totalRows: result.items.length,
    imageRows: result.items.filter((r) => r.kind === 'image').length,
    totalImageNodes: result.stats.rawImageNodes,
    ...result.stats,
  });

  return { messages: result.items, stats: result.stats };
}

async function safeImportPlaywright(logger) {
  try {
    return await import('playwright');
  } catch (error) {
    logger.warn('playwright no disponible', { message: error.message });
    return null;
  }
}
