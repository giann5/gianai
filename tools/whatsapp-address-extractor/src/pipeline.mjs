import path from 'node:path';
import { collectMessagesForDay, waitForUserEnter } from './whatsapp-scraper.mjs';
import { detectAddressWithLocalOCR } from './ocr.mjs';
import { detectAddressWithVision } from './vision-provider.mjs';
import { resolveAddressForPhoto } from './resolver.mjs';
import { saveImageRecord } from './downloader.mjs';
import { writeReports } from './reporter.mjs';

export async function runPipeline(config, logger) {
  const useFixture = config.mode === 'simulate' || Boolean(config.fromFixture);
  const messages = await collectMessagesForDay({
    date: config.date,
    fromFixture: useFixture ? config.fromFixture : undefined,
    logger,
    mode: config.mode,
    debugDir: config.debugDir,
    profileDir: config.profileDir,
    waitForEnter: config.waitForEnter,
  });

  const imageMessages = messages.filter((m) => m.kind === 'image');
  logger.info('Fotos detectadas', { total: imageMessages.length, mode: config.mode });

  if (imageMessages.length === 0) {
    logger.warn('No se detectaron fotos. Se generó reporte debug en output/debug.', {});
    if (config.mode === 'download') {
      await waitForUserEnter('No se detectaron fotos. Presioná ENTER para cerrar...');
    }
    const reports = writeReports({
      outputDir: path.join(config.outputDir, config.date),
      rows: [],
    });
    return { rows: [], reports };
  }

  const rows = [];
  for (let i = 0; i < imageMessages.length; i += 1) {
    const msg = imageMessages[i];
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
      resolvedAddress: resolved,
      outDir: path.join(config.outputDir, config.date),
      index: i + 1,
      dryRun: config.mode !== 'download',
      logger,
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
      estado: resolved.status,
      motivo: resolved.reason,
    });
  }

  const reports = writeReports({
    outputDir: path.join(config.outputDir, config.date),
    rows,
  });

  logger.info('Pipeline finalizado', { reports, total: rows.length, mode: config.mode });
  return { rows, reports };
}
