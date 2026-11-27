export const uid = () => crypto.randomUUID();
const ink = '#222521';
export const blue = '#354AE8';
export function shape(kind, name, x, y, w, h, props = {}) {
  return {
    id: uid(),
    kind,
    name,
    x,
    y,
    w,
    h,
    rotation: 0,
    fill: null,
    stroke: null,
    strokeWidth: 1,
    text: '',
    font: 'Helvetica Neue',
    size: 24,
    color: ink,
    bold: false,
    italic: false,
    align: 'left',
    valign: 'top',
    inset: [0, 0, 0, 0],
    ...props,
  };
}
export const hasTextFrame = (o) =>
  o.kind === 'text' || o.kind === 'callout' || Boolean(o.text);
export const textItem = (text, x, y, w, h, size, props = {}) =>
  shape('text', text.slice(0, 40), x, y, w, h, { text, size, ...props });
export function slide(name = '', bg = '#FFFFFF', items = []) {
  return { id: uid(), name, bg, items, back: [], notes: '' };
}
export function blankDeck() {
  return { w: 960, h: 540, slides: [slide('')] };
}
