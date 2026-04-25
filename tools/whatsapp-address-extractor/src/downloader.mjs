import fs from 'node:fs';
import path from 'node:path';

export async function saveImageRecord({ message, resolvedAddress, outDir, index, dryRun, logger }) {
  const date = message.timestampIso.slice(0, 10);
  const hhmm = message.timestampIso.slice(11, 16).replace(':', '-');
  const confidence = Math.round((resolvedAddress.confidence || 0) * 100);
  const safeAddress = sanitize(resolvedAddress.normalizedAddress || 'REVISAR');

  const filename = resolvedAddress.status === 'OK'
    ? `${date}__${safeAddress}__${hhmm}__confianza_${confidence}.jpg`
    : `${date}__REVISAR__foto_${String(index).padStart(3, '0')}.jpg`;

  const statusFolder = resolvedAddress.status === 'OK' ? 'OK' : 'REVISAR';
  const folder = path.join(outDir, statusFolder);
  fs.mkdirSync(folder, { recursive: true });

  const targetPath = path.join(folder, filename);

  if (!dryRun) {
    try {
      if (message.localImagePath && fs.existsSync(message.localImagePath)) {
        fs.copyFileSync(message.localImagePath, targetPath);
      } else if (message.imageUrl?.startsWith('data:image/')) {
        const base64 = message.imageUrl.split(',')[1] || '';
        fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'));
      } else {
        fs.writeFileSync(targetPath, 'PLACEHOLDER_IMAGE_BYTES');
        logger?.warn('No se pudo descargar imagen real; se guardó placeholder', { id: message.id, targetPath });
      }
    } catch (error) {
      const errorDir = path.join(outDir, 'ERROR');
      fs.mkdirSync(errorDir, { recursive: true });
      const errorPath = path.join(errorDir, `${date}__ERROR__foto_${String(index).padStart(3, '0')}.txt`);
      fs.writeFileSync(errorPath, error.message, 'utf-8');
      logger?.error('Error guardando imagen', { message: error.message, id: message.id, errorPath });
    }
  }

  return { targetPath, filename };
}

function sanitize(raw) {
  return raw
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'REVISAR';
}
