#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from './logger.mjs';
import { runPipeline } from './pipeline.mjs';
import { startReviewServer } from './review-server.mjs';

const argv = process.argv.slice(2);
const args = parseArgs(argv);

const mode = normalizeMode(args.mode || 'dry-run');
const date = args.date || new Date().toISOString().slice(0, 10);
const fromFixture = args['from-fixture'] || (mode === 'simulate' ? resolveDefaultFixture() : undefined);

const outputDir = resolveOutputDir(args['output-dir']);
fs.mkdirSync(outputDir, { recursive: true });

const config = {
  mode,
  date,
  fromFixture,
  outputDir,
  debugDir: path.join(outputDir, 'debug'),
  enableOcr: process.env.ENABLE_OCR === '1',
  enableVision: process.env.ENABLE_VISION === '1',
  minConfidenceForNoVision: Number(process.env.WA_MIN_CONF_NO_VISION || 0.78),
  profileDir: process.env.WA_PROFILE_DIR || path.resolve('.pw-profile'),
  waitForEnter: mode === 'download' || mode === 'dry-run',
};

const logger = createLogger(path.join(outputDir, 'logs'));
logger.info('Iniciando proceso', {
  argv,
  modeRequested: args.mode,
  modeFinal: mode,
  config,
});

if (mode === 'review') {
  startReviewServer({ baseDir: outputDir, port: Number(process.env.REVIEW_PORT || 4040) });
} else {
  runPipeline(config, logger).catch((error) => {
    logger.error('Fallo fatal', { message: error.message, stack: error.stack });
    process.exit(1);
  });
}

function parseArgs(rawArgs) {
  const out = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (!token.startsWith('--')) continue;

    const eqIndex = token.indexOf('=');
    if (eqIndex > -1) {
      const key = token.slice(2, eqIndex);
      out[key] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    i += 1;
  }
  return out;
}

function normalizeMode(input) {
  const value = String(input || '').toLowerCase();
  const valid = new Set(['dry-run', 'simulate', 'download', 'review']);
  if (!valid.has(value)) {
    throw new Error(`Modo invalido: ${input}. Usar dry-run | simulate | download | review`);
  }
  return value;
}

function resolveOutputDir(cliOutputDir) {
  if (cliOutputDir) return path.resolve(cliOutputDir);
  if (process.env.WA_OUTPUT_DIR) return path.resolve(process.env.WA_OUTPUT_DIR);
  if (process.env.WA_ROOT) return path.resolve(process.env.WA_ROOT, 'app', 'output');
  return path.resolve('output');
}

function resolveDefaultFixture() {
  const candidates = [
    path.resolve('examples', 'sample-day.json'),
    path.resolve('tools', 'whatsapp-address-extractor', 'examples', 'sample-day.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}
