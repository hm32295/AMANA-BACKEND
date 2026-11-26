function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArabicText(input) {
  if (!input) return '';
  return String(input)
    .trim()
    // Remove Arabic diacritics (Tashkeel) and Tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // Normalize Alef variations
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Teh Marbuta & Alef Maksura
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function charToArabicFlexiblePattern(ch) {
  if (ch === 'ا' || ch === 'أ' || ch === 'إ' || ch === 'آ') return '[اأإآٱ]';
  if (ch === 'ه' || ch === 'ة') return '[هة]';
  if (ch === 'ي' || ch === 'ى') return '[يئى]';
  if (ch === 'و' || ch === 'ؤ') return '[وؤ]';
  return escapeRegex(ch);
}

/**
 * Builds safe regexes for partial Arabic token matching.
 * Example: "محمد أحمد" -> matches names containing both "محمد" and "احمد/أحمد".
 */
function buildArabicTokenRegexes(queryText) {
  const normalized = normalizeArabicText(queryText);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean).slice(0, 6);
  return tokens.map((token) => {
    const diacriticsGap = '[\u064B-\u065F\u0640]*';
    const pattern = Array.from(token).map(charToArabicFlexiblePattern).join(diacriticsGap);
    return new RegExp(pattern, 'i');
  });
}

module.exports = {
  escapeRegex,
  normalizeArabicText,
  buildArabicTokenRegexes,
};
