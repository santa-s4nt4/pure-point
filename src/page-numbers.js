import { designUnit, textItem } from './model.js';
import { attr, child } from './xml.js';

export const pageNumberFont = 'Yu Gothic';
const shapeName = 'pure-point page number';

export function pageNumbers(deck) {
  const result = new Map();
  for (const slide of deck.slides)
    if (slide.showPageNumber && !slide.hidden)
      result.set(slide.id, result.size + 1);
  return result;
}

export function pageNumberItem(deck, number) {
  const width = 60;
  return textItem(
    number ? String(number) : '',
    deck.w - 25 / designUnit - width,
    deck.h - 40 / designUnit,
    width,
    16,
    12,
    { name: shapeName, font: pageNumberFont, align: 'right', noWrap: true }
  );
}

export function isPageNumberShape(node) {
  const props = child(node, 'nvSpPr');
  return (
    attr(child(props, 'cNvPr'), 'name') === shapeName &&
    ['1', 'true'].includes(attr(child(props, 'cNvSpPr'), 'txBox'))
  );
}
