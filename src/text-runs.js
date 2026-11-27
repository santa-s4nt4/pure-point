// DrawingML has independent Latin and East Asian typeface slots. Keep a
// combining mark or ideographic variation selector with its base character.
const eastAsian =
  /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Bopomofo}\u3000-\u303f\uff01-\uffef]/u;
const chunks = new RegExp(`((?:${eastAsian.source}\\p{Mark}*)+)`, 'u');
const asianLanguage = /^(?:ja|ko|zh)(?:-|$)/i;

// PowerPoint for Mac uses the font declaration's Shift-JIS charset when
// the named face is missing. In Japanese text, ANSI/default declarations
// instead use separate Latin and Japanese fallback faces.
export function japaneseSubstitute(run, east = false) {
  const japanese = /^ja(?:-|$)/i;
  if (
    !japanese.test(run.lang) &&
    !(/^en(?:-|$)/i.test(run.lang) && japanese.test(run.altLang))
  )
    return;
  const charset = east ? run.eastAsianCharset : run.fontCharset;
  if (charset == null) return;
  const shiftJis = (value) => value === '-128' || value === '128';
  if (
    shiftJis(charset) ||
    (run.font === run.eastAsianFont &&
      [run.fontCharset, run.eastAsianCharset].some(shiftJis))
  )
    return 'Yu Gothic';
  if (charset === '' || charset === '0' || charset === '1')
    return east ? 'MS Gothic' : 'Calibri';
}

export function startsEastAsian(text, run) {
  const first = text?.codePointAt(0);
  return first == null
    ? asianLanguage.test(run.lang)
    : eastAsian.test(String.fromCodePoint(first));
}

export const runFontFor = (text, run) =>
  startsEastAsian(text, run) ? run.eastAsianFont || run.font : run.font;

export function isDecorated(style, key) {
  return key === 'underline'
    ? Boolean(style.underline && style.underline !== 'none')
    : Boolean(style.strike && style.strike !== 'noStrike');
}

export function objectDecoration(o, key) {
  const styles = o.paragraphs?.flatMap((p) =>
    p.runs.length ? p.runs : [p.base]
  );
  return styles?.length
    ? styles.every((style) => isDecorated(style, key))
    : isDecorated(o, key);
}

export function decorateRun(span, run) {
  if (run.highlight) span.style.backgroundColor = run.highlight;
  const lines = [];
  if (isDecorated(run, 'underline')) lines.push('underline');
  if (isDecorated(run, 'strike')) lines.push('line-through');
  if (lines.length) span.style.textDecorationLine = lines.join(' ');
  if (run.underline === 'dbl' || run.strike === 'dblStrike')
    span.style.textDecorationStyle = 'double';
}

export function appendTextRun(line, run, typeStyle, index) {
  const eastFont = run.eastAsianFont || run.font;
  const eastFallback = run.eastAsianFallback || run.fallbackFont;
  const eastSubstitute = japaneseSubstitute(run, true),
    latinSubstitute = japaneseSubstitute(run);
  const split =
    eastFont !== run.font ||
    eastFallback !== run.fallbackFont ||
    eastSubstitute !== latinSubstitute;
  const localize =
    run.altLang &&
    asianLanguage.test(run.altLang) !== asianLanguage.test(run.lang);
  const parts = split || localize ? run.text.split(chunks) : [run.text];
  parts.forEach((text, i) => {
    if (!text) return;
    const span = document.createElement('span');
    if (index !== undefined) span.dataset.runIndex = index;
    const east = i % 2 === 1;
    typeStyle(
      span,
      east && split
        ? { ...run, font: eastFont, fallbackFont: eastFallback }
        : run,
      east ? eastSubstitute : latinSubstitute
    );
    if (localize && east === asianLanguage.test(run.altLang))
      span.lang = run.altLang;
    decorateRun(span, run);
    span.textContent = text;
    line.append(span);
  });
}
