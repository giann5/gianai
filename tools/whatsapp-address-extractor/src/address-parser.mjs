const STREET_SUFFIX = '(?:av\\.?|avenida|calle|c\\.?|pasaje|pje\\.?|diag\\.?|boulevard|blvd\\.?|ruta)?';
const ADDRESS_RE = new RegExp(
  `(?:^|\\b)(${STREET_SUFFIX}\\s*[a-záéíóúñ0-9.\\-\\s]{2,}?)\\s+(\\d{1,5})(?:\\b|$)`,
  'i'
);

const CORNER_RE = /([a-záéíóúñ0-9.\-\s]{2,})\s*(?:y|esq\.?|esquina)\s*([a-záéíóúñ0-9.\-\s]{2,})/i;

export function parseAddress(text) {
  if (!text) {
    return { hasAddress: false, confidence: 0, source: 'none', note: 'texto vacio' };
  }

  const clean = normalizeText(text);
  const match = clean.match(ADDRESS_RE);
  if (match) {
    const street = normalizeStreet(match[1]);
    const number = match[2];
    return {
      hasAddress: true,
      street,
      number,
      normalizedAddress: `${street} ${number}`,
      confidence: 0.6,
      source: 'none',
      note: 'regex calle+altura',
    };
  }

  const corner = clean.match(CORNER_RE);
  if (corner) {
    const street = `${normalizeStreet(corner[1])} y ${normalizeStreet(corner[2])}`;
    return {
      hasAddress: true,
      street,
      number: 'S/N',
      normalizedAddress: street,
      confidence: 0.45,
      source: 'none',
      note: 'esquina detectada',
    };
  }

  return { hasAddress: false, confidence: 0, source: 'none', note: 'sin patron direccion' };
}

export function normalizeText(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreet(street) {
  return street
    .trim()
    .replace(/\bav\b/i, 'Av.')
    .replace(/\bc\b/i, 'Calle')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
