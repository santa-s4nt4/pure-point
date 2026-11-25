export const defaults = {
  type: 'columns',
  columns: 12,
  rows: 6,
  step: 24,
  margin: 40,
  gutter: 12,
  visible: false,
  snap: true,
};
const bands = (length, count, margin, gutter) => {
  margin = Math.min(margin, length / 3);
  gutter = Math.min(gutter, (length - 2 * margin) / (count * 2));
  const size = (length - 2 * margin - (count - 1) * gutter) / count;
  return Array.from({ length: count }, (_, i) => [
    margin + i * (size + gutter),
    size,
  ]);
};
export function gridLines(w, h, g) {
  let x = [],
    y = [],
    xb = [],
    yb = [];
  if (g.type === 'columns') {
    xb = bands(w, g.columns, g.margin, g.gutter);
    x = xb.flatMap(([a, b]) => [a, a + b]);
  }
  if (g.type === 'rows') {
    yb = bands(h, g.rows, g.margin, g.gutter);
    y = yb.flatMap(([a, b]) => [a, a + b]);
  }
  if (g.type === 'thirds') {
    x = [w / 3, (2 * w) / 3];
    y = [h / 3, (2 * h) / 3];
  }
  if (g.type === 'square') {
    x = Array.from(
      { length: Math.floor(w / g.step) + 1 },
      (_, i) => i * g.step
    );
    y = Array.from(
      { length: Math.floor(h / g.step) + 1 },
      (_, i) => i * g.step
    );
  }
  return { x, y, xb, yb };
}
export function snapAxis(anchors, targets, threshold) {
  let delta = Infinity,
    guide = null;
  for (const t of targets)
    for (const a of anchors)
      if (Math.abs(t - a) < Math.abs(delta) && Math.abs(t - a) <= threshold) {
        delta = t - a;
        guide = t;
      }
  return { delta: guide === null ? 0 : delta, guide };
}
export function snapTargets(deck, slide, selected, g) {
  const { x, y } = gridLines(deck.w, deck.h, g);
  x.unshift(0, deck.w / 2, deck.w);
  y.unshift(0, deck.h / 2, deck.h);
  for (const o of slide.items)
    if (o.id !== selected) {
      x.push(o.x, o.x + o.w / 2, o.x + o.w);
      y.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
  return { x, y };
}
