import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIN_VALID_IMAGE_BYTES = 5 * 1024;

export async function saveImageRecord({ message, imageMeta, resolvedAddress, outDir, index, dryRun, logger, runtime, seenHashes }) {
  const date = message.timestampIso.slice(0, 10);
  const hhmm = message.timestampIso.slice(11, 16).replace(':', '-');
  const confidence = Math.round((resolvedAddress.confidence || 0) * 100);
  const safeAddress = sanitize(resolvedAddress.normalizedAddress || 'REVISAR');

  const extension = inferExtension(imageMeta);
  const filename = resolvedAddress.status === 'OK'
    ? `${date}__${safeAddress}__${hhmm}__${String(index).padStart(3, '0')}__confianza_${confidence}.${extension}`
    : `${date}__REVISAR__foto_${String(index).padStart(3, '0')}.${extension}`;

  const statusFolder = resolvedAddress.status === 'OK' ? 'OK' : 'REVISAR';
  const folder = path.join(outDir, statusFolder);
  const errorDir = path.join(outDir, 'ERROR');
  const failDebugDir = path.join(outDir, '..', 'debug', 'download-failures');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(errorDir, { recursive: true });
  fs.mkdirSync(failDebugDir, { recursive: true });

  const targetPath = path.join(folder, filename);

  const debugMeta = {
    messageId: message.id,
    imageIndex: imageMeta?.imageIndex ?? 0,
    src: imageMeta?.src || '',
    currentSrc: imageMeta?.currentSrc || '',
    naturalWidth: imageMeta?.naturalWidth || 0,
    naturalHeight: imageMeta?.naturalHeight || 0,
    clientWidth: imageMeta?.clientWidth || 0,
    clientHeight: imageMeta?.clientHeight || 0,
    alt: imageMeta?.alt || '',
    nearestAriaLabel: imageMeta?.nearestAriaLabel || '',
    srcType: detectSrcType(imageMeta?.currentSrc || imageMeta?.src || ''),
    outerHtmlSnippet: imageMeta?.outerHtmlSnippet || '',
  };

  logger?.info('Intentando descargar imagen', debugMeta);

  if (dryRun) {
    return { targetPath, filename, success: false, dryRun: true, reason: 'dry-run' };
  }

  try {
    let buffer = null;

    buffer = decodeDataUrl(imageMeta?.currentSrc || imageMeta?.src || '');
    if (!buffer) {
      buffer = await downloadFromHttpUrl(imageMeta?.currentSrc || imageMeta?.src || '', runtime);
    }
    if (!buffer) {
      buffer = await downloadBlobViaBrowser({ messageId: message.id, imageIndex: imageMeta?.imageIndex || 0, runtime });
    }
    if (!buffer) {
      buffer = await downloadFromViewer({ messageId: message.id, imageIndex: imageMeta?.imageIndex || 0, runtime, logger });
    }

    if (!buffer || buffer.length < MIN_VALID_IMAGE_BYTES) {
      throw new Error(`imagen invalida o demasiado chica (${buffer?.length || 0} bytes)`);
    }

    const hash = sha256(buffer);
    if (seenHashes?.has(hash)) {
      return { targetPath, filename, success: true, duplicated: true, hash };
    }
    seenHashes?.add(hash);

    fs.writeFileSync(targetPath, buffer);
    return { targetPath, filename, success: true, hash };
  } catch (error) {
    const failureBase = `${date}__${String(index).padStart(3, '0')}__${sanitize(message.id || 'unknown')}`;
    const errorJsonPath = path.join(failDebugDir, `${failureBase}.json`);
    const errorTxtPath = path.join(errorDir, `${failureBase}.txt`);

    fs.writeFileSync(
      errorJsonPath,
      JSON.stringify(
        {
          ...debugMeta,
          reason: error.message,
          stack: error.stack,
        },
        null,
        2,
      ),
      'utf-8',
    );
    fs.writeFileSync(errorTxtPath, error.message, 'utf-8');

    if (runtime?.page) {
      const snapPath = path.join(failDebugDir, `${failureBase}.png`);
      try {
        await runtime.page.screenshot({ path: snapPath, fullPage: false });
      } catch {
        // ignore screenshot failure
      }
    }

    logger?.error('Fallo descarga real de imagen', {
      messageId: message.id,
      index,
      reason: error.message,
      errorJsonPath,
      errorTxtPath,
    });

    return { targetPath: errorTxtPath, filename: path.basename(errorTxtPath), success: false, reason: error.message };
  }
}

function decodeDataUrl(url) {
  if (!url || !url.startsWith('data:image/')) return null;
  const parts = url.split(',');
  if (parts.length < 2) return null;
  return Buffer.from(parts[1], 'base64');
}

async function downloadFromHttpUrl(url, runtime) {
  if (!url || !url.startsWith('https://')) return null;
  if (!runtime?.context?.request) return null;

  const response = await runtime.context.request.get(url, { timeout: 20_000 });
  if (!response.ok()) return null;

  const contentType = response.headers()['content-type'] || '';
  if (!contentType.startsWith('image/')) return null;

  const buffer = await response.body();
  return buffer;
}

async function downloadBlobViaBrowser({ messageId, imageIndex, runtime }) {
  if (!runtime?.page) return null;

  const result = await runtime.page.evaluate(async ({ messageId, imageIndex }) => {
    const node = document.querySelector(`#main [data-id="${CSS.escape(messageId)}"]`);
    const img = node?.querySelectorAll('img')?.[imageIndex] || null;
    if (!img) return { ok: false, reason: 'img_not_found' };

    const blobUrl = img.currentSrc || img.getAttribute('src') || '';
    if (!blobUrl.startsWith('blob:')) return { ok: false, reason: 'not_blob' };

    const res = await fetch(blobUrl);
    const arrayBuffer = await res.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    return {
      ok: true,
      mimeType: res.headers.get('content-type') || 'image/jpeg',
      base64: btoa(binary),
      size: bytes.length,
    };
  }, { messageId, imageIndex });

  if (!result?.ok || !result.base64) return null;
  return Buffer.from(result.base64, 'base64');
}

async function downloadFromViewer({ messageId, imageIndex, runtime, logger }) {
  if (!runtime?.page) return null;
  const { page } = runtime;

  const imageLocator = page.locator(`#main [data-id="${escapeForSelector(messageId)}"] img`).nth(imageIndex);
  if ((await imageLocator.count()) === 0) return null;

  await imageLocator.click({ timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(700);

  try {
    const downloadBtn = page.locator('button[aria-label*="Download" i], button[aria-label*="descarg" i], [data-testid*="download" i]').first();
    if ((await downloadBtn.count()) > 0) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 7000 }),
        downloadBtn.click(),
      ]);
      const tmpPath = path.join(runtime.debugDir, `tmp-download-${Date.now()}.bin`);
      await download.saveAs(tmpPath);
      const bytes = fs.readFileSync(tmpPath);
      fs.unlinkSync(tmpPath);
      await page.keyboard.press('Escape').catch(() => null);
      return bytes;
    }

    const viewerSrc = await page.evaluate(() => {
      const candidate = document.querySelector('[role="dialog"] img') || document.querySelector('img[src^="blob:"], img[src^="https:"]');
      return candidate?.currentSrc || candidate?.getAttribute('src') || '';
    });

    let fromViewer = decodeDataUrl(viewerSrc);
    if (!fromViewer && viewerSrc?.startsWith('https://')) {
      fromViewer = await downloadFromHttpUrl(viewerSrc, runtime);
    }

    if (!fromViewer && viewerSrc?.startsWith('blob:')) {
      const blobResult = await page.evaluate(async (blobUrl) => {
        const res = await fetch(blobUrl);
        const buf = await res.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.slice(i, i + chunk));
        }
        return btoa(binary);
      }, viewerSrc);
      fromViewer = Buffer.from(blobResult, 'base64');
    }

    await page.keyboard.press('Escape').catch(() => null);
    return fromViewer;
  } catch (error) {
    logger?.warn('Falló descarga por visor', { messageId, imageIndex, reason: error.message });
    await page.keyboard.press('Escape').catch(() => null);
    return null;
  }
}

function inferExtension(imageMeta) {
  const url = imageMeta?.currentSrc || imageMeta?.src || '';
  if (/\.png(\?|$)/i.test(url) || url.startsWith('data:image/png')) return 'png';
  if (/\.webp(\?|$)/i.test(url) || url.startsWith('data:image/webp')) return 'webp';
  if (/\.gif(\?|$)/i.test(url) || url.startsWith('data:image/gif')) return 'gif';
  return 'jpg';
}

function detectSrcType(url) {
  if (!url) return 'empty';
  if (url.startsWith('data:')) return 'data';
  if (url.startsWith('blob:')) return 'blob';
  if (url.startsWith('https:')) return 'https';
  return 'other';
}

function sanitize(raw) {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function escapeForSelector(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
