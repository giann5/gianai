import { cleanWhatsAppTextForAddress, parseAddress } from './address-parser.mjs';
import { classifyByScore, mergeCandidate } from './scoring.mjs';

export function resolveAddressForPhoto({ messages, index, ocrCandidate, visionCandidate, imageAlt = '' }) {
  const current = messages[index];
  const candidates = [];

  const cleanedAlt = cleanWhatsAppTextForAddress(imageAlt);
  const altCandidate = parseAddress(cleanedAlt);
  if (altCandidate.hasAddress) {
    candidates.push({
      ...altCandidate,
      source: 'image_alt',
      confidence: Math.max(0.86, altCandidate.confidence),
      note: 'direccion tomada del alt de la imagen',
    });
  }

  const captionCandidate = parseAddress(current.caption || current.text || '');
  if (captionCandidate.hasAddress) {
    candidates.push(mergeCandidate({ baseCandidate: captionCandidate, source: 'caption' }));
  }

  // Si alt/caption es claro, no mezclar contexto lejano
  const hasStrongLocal = candidates.some((c) => c.confidence >= 0.85 && ['image_alt', 'caption'].includes(c.source));

  if (!hasStrongLocal) {
    for (let dist = 1; dist <= 3; dist += 1) {
      const prev = messages[index - dist];
      if (prev) {
        const parsed = parseAddress(prev.text || prev.caption || '');
        if (parsed.hasAddress) {
          candidates.push(mergeCandidate({ baseCandidate: parsed, source: 'previous', distance: dist }));
        }
      }
      const next = messages[index + dist];
      if (next) {
        const parsed = parseAddress(next.text || next.caption || '');
        if (parsed.hasAddress) {
          candidates.push(mergeCandidate({ baseCandidate: parsed, source: 'next', distance: dist }));
        }
      }
    }
  }

  if (ocrCandidate?.hasAddress) candidates.push(mergeCandidate({ baseCandidate: ocrCandidate, source: 'ocr' }));
  if (visionCandidate?.hasAddress) candidates.push(mergeCandidate({ baseCandidate: visionCandidate, source: 'vision' }));

  if (candidates.length === 0) {
    return {
      status: 'REVISAR',
      confidence: 0,
      source: 'none',
      normalizedAddress: '',
      reason: 'no se detecto direccion en contexto ni OCR',
    };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const second = candidates[1];

  const conflict = second && second.normalizedAddress !== best.normalizedAddress && Math.abs(best.confidence - second.confidence) < 0.12;
  const classification = classifyByScore(conflict ? best.confidence - 0.2 : best.confidence);

  return {
    ...best,
    status: conflict ? 'REVISAR' : classification.status,
    reason: conflict ? 'conflicto entre candidatos cercanos' : classification.reason,
    candidates,
  };
}
