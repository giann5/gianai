import fs from 'node:fs';
import path from 'node:path';

export async function saveImageRecord({ message, resolvedAddress, outDir, index, dryRun }) {
  const date = message.timestampIso.slice(0, 10);
  const hhmm = message.timestampIso.slice(11, 16).replace(':', '-');
  const confidence = Math.round((resolvedAddress.confidence || 0) * 100);
  const safeAddress = sanitize(resolvedAddress.normalizedAddress || 'REVISAR');

  const filename = resolvedAddress.status === 'OK'
    ? `${date}__${safeAddress}__${hhmm}__confianza_${confidence}.jpg`
    : `${date}__REVISAR__foto_${String(index).padStart(3, '0')}.jpg`;

  const folder = resolvedAddress.status === 'OK' ? path.join(outDir, 'OK') : path.join(outDir, 'REVISAR');
  fs.mkdirSync(folder, { recursive: true });

  const targetPath = path.join(folder, filename);
  if (!dryRun) {
    if (message.localImagePath && fs.existsSync(message.localImagePath)) {
      fs.copyFileSync(message.localImagePath, targetPath);
    } else {
      fs.writeFileSync(targetPath, 'PLACEHOLDER_IMAGE_BYTES');
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
