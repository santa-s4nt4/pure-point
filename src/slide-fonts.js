import { hasTextFrame } from './model.js';
import { pageNumberFont } from './page-numbers.js';
import { loadTypeface, native } from './platform.js';
import { japaneseSubstitute } from './text-runs.js';

export function loadSlideFonts(slide, fonts) {
  if (!native || !fonts.length) return;
  const names = new Map();
  function collect(o) {
    if (!o) return;
    for (const font of [
      o.font,
      o.eastAsianFont,
      japaneseSubstitute(o),
      japaneseSubstitute(o, true),
      o.fallbackFont,
      o.eastAsianFallback,
    ]) {
      if (font)
        names.set(JSON.stringify([font, o.bold, o.italic]), [
          font,
          o.bold,
          o.italic,
        ]);
    }
  }
  function paragraph(p) {
    collect(p.base);
    p.runs.forEach(collect);
  }
  function visit(o) {
    if (hasTextFrame(o)) {
      collect(o);
      o.paragraphs?.forEach(paragraph);
    }
    for (const row of o.table?.rows || [])
      for (const cell of row.cells) cell.paragraphs.forEach(paragraph);
    o.items?.forEach(visit);
  }
  slide.items.forEach(visit);
  slide.back.forEach(visit);
  if (slide.showPageNumber) collect({ font: pageNumberFont });
  for (const [font, bold, italic] of names.values())
    loadTypeface(font, fonts, bold, italic);
}
