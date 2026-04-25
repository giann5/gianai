import path from 'node:path';
import { collectMessagesForDay, waitForUserEnter } from './whatsapp-scraper.mjs';
import { detectAddressWithLocalOCR } from './ocr.mjs';
import { detectAddressWithVision } from './vision-provider.mjs';
import { resolveAddressForPhoto } from './resolver.mjs';
import { saveImageRecord } from './downloader.mjs';
import { writeReports } from './reporter.mjs';

export async function runPipeline(config, logger) {
  const seenHashes = new Set();
  let runtime = null;

  try {
    const useFixture = config.mode === 'simulate' || Boolean(config.fromFixture);
    const collected = await collectMessagesForDay({
      date: config.date,
      fromFixture: useFixture ? config.fromFixture : undefined,
      logger,
      mode: config.mode,
      debugDir: config.debugDir,
      profileDir: config.profileDir,
      waitForEnter: config.waitForEnter,
    });

    const messages = collected.messages;
    runtime = collected.runtime;

    const imageUnits = [];
    for (const msg of messages) {
      if (msg.kind !== 'image') continue;
      const images = Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : [{ imageIndex: 0, src: msg.imageUrl, currentSrc: msg.imageUrl }];
      for (const imageMeta of images) {
        imageUnits.push({ msg, imageMeta });
      }
    }

    logger.info('Fotos detectadas', { totalMessages: messages.filter((m) => m.kind === 'image').length, totalImages: imageUnits.length, mode: config.mode });

    if (imageUnits.length === 0) {
      logger.warn('No se detectaron fotos. Se generó reporte debug en output/debug.', {});
      if (config.mode === 'download') {
        await waitForUserEnter('No se detectaron fotos. Presioná ENTER para cerrar...');
      }
      const reports = writeReports({ outputDir: path.join(config.outputDir, config.date), rows: [] });
      return { rows: [], reports };
    }

    const rows = [];
    for (let i = 0; i < imageUnits.length; i += 1) {
      const { msg, imageMeta } = imageUnits[i];
      const absoluteIndex = messages.findIndex((m) => m.id === msg.id);

      const ocr = config.enableOcr
        ? await detectAddressWithLocalOCR(msg.localImagePath || '', logger)
        : { hasAddress: false, confidence: 0, source: 'ocr', note: 'ocr off' };

      const needsVision = config.enableVision && (!ocr.hasAddress || ocr.confidence < config.minConfidenceForNoVision);
      const vision = needsVision
        ? await detectAddressWithVision({
            imagePath: msg.localImagePath || '',
            enabled: config.enableVision,
            apiKey: process.env.OPENAI_API_KEY,
            logger,
          })
        : { hasAddress: false, confidence: 0, source: 'vision', note: 'vision skip' };

      const resolved = resolveAddressForPhoto({
        messages,
        index: absoluteIndex,
        ocrCandidate: ocr,
        visionCandidate: vision,
      });

      const saved = await saveImageRecord({
        message: msg,
        imageMeta,
        resolvedAddress: resolved,
        outDir: path.join(config.outputDir, config.date),
        index: i + 1,
        dryRun: config.mode !== 'download',
        logger,
        runtime,
        seenHashes,
      });

      rows.push({
        fecha: msg.timestampIso.slice(0, 10),
        hora: msg.timestampIso.slice(11, 19),
        archivo: saved.filename,
        direccion_detectada: resolved.normalizedAddress || '',
        calle: resolved.street || '',
        altura: resolved.number || '',
        fuente: resolved.source,
        confianza: Number((resolved.confidence || 0).toFixed(2)),
        mensaje_relacionado: (msg.caption || msg.text || '').slice(0, 160),
        estado: saved.success ? resolved.status : 'ERROR',
        motivo: saved.success ? resolved.reason : saved.reason || 'fallo descarga real',
      });
    }

    const reports = writeReports({
      outputDir: path.join(config.outputDir, config.date),
      rows,
    });

    logger.info('Pipeline finalizado', { reports, total: rows.length, mode: config.mode });
    return { rows, reports };
  } finally {
    if (runtime?.close) {
      await runtime.close().catch(() => null);
    }
  }
}
