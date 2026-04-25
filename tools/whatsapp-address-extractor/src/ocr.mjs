import { parseAddress } from './address-parser.mjs';

export async function detectAddressWithLocalOCR(imagePath, logger) {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('spa');
    const { data } = await worker.recognize(imagePath);
    await worker.terminate();

    const parsed = parseAddress(data.text || '');
    if (!parsed.hasAddress) return parsed;

    return {
      ...parsed,
      source: 'ocr',
      note: 'direccion detectada por OCR local',
    };
  } catch (error) {
    logger.warn('OCR local deshabilitado o fallido', { message: error.message });
    return { hasAddress: false, confidence: 0, source: 'ocr', note: 'ocr no disponible' };
  }
}
