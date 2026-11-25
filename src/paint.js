import { defaultThemeColors } from './template.js';

const clamp = (n, max) => Math.max(0, Math.min(max, n));
const byte = (n) =>
  Math.round(clamp(n, 255)).toString(16).padStart(2, '0').toUpperCase();
export function rgbFromHsv({ h, s, v }) {
  const chroma = v * s,
    section = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const rgb = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][Math.floor(section)];
  return rgb.map((c) => Math.round((c + v - chroma) * 255));
}
export function hsvFromRgb([r, g, b], hue = 0) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const sector =
    max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {
    h: d ? (60 * sector + 360) % 360 : hue,
    s: max ? d / max : 0,
    v: max / 255,
  };
}
export function rgbaHex(rgb, a = 1) {
  return (
    '#' +
    rgb.map(byte).join('') +
    (Math.round(a * 255) < 255 ? byte(a * 255) : '')
  );
}
export function parseHex(text) {
  let hex = text.trim().replace(/^#/, '');
  if (!/^(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(hex)) return null;
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  return {
    rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)),
    alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : null,
  };
}
export function hslFromHsv({ h, s, v }) {
  const l = v * (1 - s / 2);
  return [h, l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l];
}
export function hsvFromHsl(h, s, l) {
  const v = l + s * Math.min(l, 1 - l);
  return { h, s: v === 0 ? 0 : 2 * (1 - l / v), v };
}
export function documentColors(deck, activeSlide) {
  const colors = new Set();
  function add(color) {
    if (typeof color === 'string' && parseHex(color))
      colors.add(color.toUpperCase());
  }
  function visit(o) {
    ['fill', 'stroke', 'color'].forEach((k) => add(o[k]));
    for (const p of o.paragraphs || []) {
      add(p.base?.color);
      for (const r of p.runs || []) add(r.color);
    }
    for (const c of o.items || []) visit(c);
    for (const row of o.table?.rows || [])
      for (const cell of row.cells || []) {
        add(cell.fill);
        for (const p of cell.paragraphs || []) {
          add(p.base?.color);
          for (const r of p.runs || []) add(r.color);
        }
      }
  }
  for (const hex of activeSlide?.themeColors?.length
    ? activeSlide.themeColors
    : defaultThemeColors)
    add(hex);
  for (const slide of deck.slides) {
    add(slide.bg);
    for (const o of [...slide.items, ...(slide.back || [])]) visit(o);
  }
  return [...colors];
}
