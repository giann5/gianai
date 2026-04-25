#!/usr/bin/env node
import path from 'node:path';
import { createLogger } from './logger.mjs';
import { runPipeline } from './pipeline.mjs';

function getArg(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

const mode = getArg('--mode', 'dry-run');
const date = getArg('--date', new Date().toISOString().slice(0, 10));
const fromFixture = getArg('--from-fixture');

const config = {
  mode,
  date,
  fromFixture,
  outputDir: path.resolve('tools/whatsapp-address-extractor/output'),
  enableOcr: process.env.ENABLE_OCR === '1',
  enableVision: process.env.ENABLE_VISION === '1',
  minConfidenceForNoVision: 0.78,
};

const logger = createLogger(path.resolve('tools/whatsapp-address-extractor/output/logs'));
logger.info('Iniciando proceso', config);

runPipeline(config, logger).catch((error) => {
  logger.error('Fallo fatal', { message: error.message, stack: error.stack });
  process.exit(1);
});
