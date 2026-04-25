export const SCORE_WEIGHTS = {
  caption: 0.92,
  image_alt: 0.9,
  previous_1: 0.9,
  previous_2_3: 0.75,
  next_1: 0.82,
  next_2_3: 0.67,
  grouped_photos: 0.72,
  ocr: 0.7,
  vision: 0.8,
  conflictPenalty: -0.35,
  ambiguityPenalty: -0.2,
};

export function mergeCandidate({ baseCandidate, source, distance = 0, hasConflict = false, ambiguous = false }) {
  const sourceWeight = resolveWeight(source, distance);
  const parserConfidence = baseCandidate.confidence ?? 0;
  let score = Math.min(0.99, sourceWeight * 0.7 + parserConfidence * 0.3);

  if (hasConflict) score += SCORE_WEIGHTS.conflictPenalty;
  if (ambiguous) score += SCORE_WEIGHTS.ambiguityPenalty;

  return {
    ...baseCandidate,
    source,
    confidence: clamp(score, 0, 0.99),
  };
}

export function classifyByScore(score) {
  if (score >= 0.85) return { status: 'OK', reason: 'confianza alta' };
  if (score >= 0.7) return { status: 'OK', reason: 'confianza media-alta' };
  if (score >= 0.5) return { status: 'REVISAR', reason: 'confianza media' };
  return { status: 'REVISAR', reason: 'confianza baja o ambigua' };
}

function resolveWeight(source, distance) {
  if (source === 'caption') return SCORE_WEIGHTS.caption;
  if (source === 'image_alt') return SCORE_WEIGHTS.image_alt;
  if (source === 'previous') {
    if (distance <= 1) return SCORE_WEIGHTS.previous_1;
    return SCORE_WEIGHTS.previous_2_3;
  }
  if (source === 'next') {
    if (distance <= 1) return SCORE_WEIGHTS.next_1;
    return SCORE_WEIGHTS.next_2_3;
  }
  if (source === 'ocr') return SCORE_WEIGHTS.ocr;
  if (source === 'vision') return SCORE_WEIGHTS.vision;
  return SCORE_WEIGHTS.grouped_photos;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
