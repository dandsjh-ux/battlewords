// Offline English dictionary used by the "Dictionary check" setting.
// lib/dictionary.txt holds ~72k lower-case words (2–9 letters, US/UK/CA/AU spellings)
// built from SCOWL size 70 (see dictionary-LICENSE.txt). It works with no network,
// so the check can't be bypassed when the online dictionary is slow or unreachable.
const fs = require('fs');
const path = require('path');
const { WORDS: BANK } = require('./words');

let words = null;
function load() {
  if (words) return words;
  words = new Set();
  const text = fs.readFileSync(path.join(__dirname, 'dictionary.txt'), 'utf8');
  for (const line of text.split('\n')) {
    const w = line.trim();
    if (w) words.add(w.toUpperCase());
  }
  // The random-word bank is always valid.
  for (const list of Object.values(BANK)) for (const w of list) words.add(w);
  return words;
}

function isKnownWord(word) {
  return load().has(String(word || '').toUpperCase());
}

module.exports = { isKnownWord };
