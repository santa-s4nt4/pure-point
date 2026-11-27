import { designUnit, textItem } from './model.js';
import { parseHex } from './paint.js';
import { P, attr, child, children, desc } from './xml.js';

export const pageNumberFont = 'Yu Gothic';
const shapeName = 'pure-point page number';
const extensionUri = '{3E7DCCAF-5072-4F3B-A87F-160A82474C53}';

export function pageNumbers(deck) {
  const result = new Map();
  if (!deck.showPageNumbers) return result;
  for (const slide of deck.slides)
    if (!slide.hidden) result.set(slide.id, result.size + 1);
  return result;
}

export function pageNumberColor(background) {
  const { rgb, alpha } = parseHex(background || '') || { rgb: [255, 255, 255] };
  const opacity = alpha ?? 1;
  const linear = rgb.map((value) => {
    const channel = (value / 255) * opacity + 1 - opacity;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return (luminance + 0.05) ** 2 >= 1.05 * 0.05 ? '#000000' : '#FFFFFF';
}

export function pageNumberItem(deck, number, background) {
  const width = 60;
  return textItem(
    number ? String(number) : '',
    deck.w - 25 / designUnit - width,
    deck.h - 40 / designUnit,
    width,
    16,
    12,
    {
      name: shapeName,
      font: pageNumberFont,
      align: 'right',
      noWrap: true,
      color: pageNumberColor(background),
    }
  );
}

export function readPageNumberLabel(page) {
  const node = children(desc(page, 'spTree')).find(isPageNumberShape);
  if (!node) return;
  const body = child(node, 'txBody');
  const color = attr(desc(desc(body, 'rPr'), 'srgbClr'), 'val');
  return {
    text: desc(body, 't')?.textContent,
    color: color ? '#' + color.toUpperCase() : null,
  };
}

function pageNumberSetting(presentation) {
  return children(child(presentation.documentElement, 'extLst'), 'ext')
    .find((node) => attr(node, 'uri') === extensionUri);
}

export const hasPageNumberSetting = (presentation) =>
  Boolean(pageNumberSetting(presentation));

export function writePageNumberSetting(presentation, enabled) {
  const setting = pageNumberSetting(presentation);
  if (Boolean(setting) === Boolean(enabled)) return false;
  const root = presentation.documentElement;
  if (enabled) {
    let list = child(root, 'extLst');
    if (!list) {
      list = presentation.createElementNS(P, 'p:extLst');
      root.append(list);
    }
    const ext = presentation.createElementNS(P, 'p:ext');
    ext.setAttribute('uri', extensionUri);
    // Keep the setting even when the file has no visible numbered slides.
    ext.append(presentation.createElementNS(
      'urn:studio.puretools.pure-point', 'pp:pageNumbers'
    ));
    list.append(ext);
  } else {
    const list = setting.parentElement;
    setting.remove();
    if (!list.children.length) list.remove();
  }
  return true;
}

export function isPageNumberShape(node) {
  const props = child(node, 'nvSpPr');
  return (
    attr(child(props, 'cNvPr'), 'name') === shapeName &&
    ['1', 'true'].includes(attr(child(props, 'cNvSpPr'), 'txBox'))
  );
}
