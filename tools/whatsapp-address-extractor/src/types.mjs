/**
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {string} timestampIso
 * @property {'in'|'out'} direction
 * @property {'text'|'image'|'system'} kind
 * @property {string=} text
 * @property {string=} caption
 * @property {string=} imageUrl
 * @property {string=} localImagePath
 * @property {string=} hash
 */

/**
 * @typedef {Object} AddressCandidate
 * @property {boolean} hasAddress
 * @property {string=} street
 * @property {string=} number
 * @property {string=} normalizedAddress
 * @property {number} confidence
 * @property {'caption'|'previous'|'next'|'ocr'|'vision'|'none'} source
 * @property {string=} note
 */
