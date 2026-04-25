const STREET_SUFFIX = '(?:av\\.?|avenida|calle|c\\.?|pasaje|pje\\.?|diag\\.?|boulevard|blvd\\.?|ruta)?';
const ADDRESS_RE = new RegExp(
  `(?:^|\\b)(${STREET_SUFFIX}\\s*[a-záéíóúñ0-9.\\-\\s]{2,}?)\\s+(\\d{1,5})(?:\\b|$)`,
  'i'
);

const CORNER_RE = /([a-záéíóúñ0-9.\-\s]{2,})\s*(?:y|esq\.?|esquina)\s*([a-záéíóúñ0-9.\-\s]{2,})/i;

const BAD_TOKENS = [
  'tail-in',
  'forward-refreshed',
  'reenviado',
  'abrir foto',
  'foto',
  'ver reacciones',
  'reaccion',
];

const KNOWN_SENDERS = ['daniel freire', 'jorge teira'];

export function parseAddress(text) {
  const clean = cleanWhatsAppTextForAddress(text);

  if (!clean) {
    return { hasAddress: false, confidence: 0, source: 'none', note: 'texto vacio' };
  }

  const match = clean.match(ADDRESS_RE);
  if (match) {
    const street = normalizeStreet(match[1]);
    const number = trimStreetNumber(match[2]);
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

  const swapped = clean.match(/^(\d{1,5})\s+([a-záéíóúñ][a-záéíóúñ\s.'-]{2,})$/i);
  if (swapped) {
    const street = normalizeStreet(swapped[2]);
    const number = trimStreetNumber(swapped[1]);
    return {
      hasAddress: true,
      street,
      number,
      normalizedAddress: `${street} ${number}`,
      confidence: 0.62,
      source: 'none',
      note: 'regex altura+calle',
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

export function cleanWhatsAppTextForAddress(input) {
  if (!input) return '';

  let text = normalizeText(input);

  for (const token of BAD_TOKENS) {
    const re = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
    text = text.replace(re, ' ');
  }

  text = text.replace(/\b\d{1,2}:\d{2}(?:\d{1,2}:\d{2})*\b/g, ' '); // 22:37 y 22:3722:37
  text = text.replace(/\b(\d{1,5})(\d{2}:\d{2})\b/g, '$1 '); // 85322:37
  text = text.replace(/\b(R\d{1,3})(\d{2}:\d{2})\b/gi, '$1 '); // R316:42

  text = text.replace(/([a-záéíóúñ])([0-9])/gi, '$1 $2');
  text = text.replace(/([0-9])([a-záéíóúñ])/gi, '$1 $2');

  for (const sender of KNOWN_SENDERS) {
    const prefixRe = new RegExp(`^\\s*${escapeRegex(sender)}\\s*`, 'i');
    text = text.replace(prefixRe, '');
  }

  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function normalizeText(input) {
  return String(input)
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

function trimStreetNumber(numberText) {
  return String(numberText).match(/^\d{1,5}/)?.[0] || numberText;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
