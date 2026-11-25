import {
  contoursFor,
  edgeData,
  edges,
  paintPaths,
  pathData,
} from './vector.js';
import { esc } from './xml.js';
import { shapeTransform } from './layers.js';
const ns = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const dashSegments = {
  dot: [1, 3],
  sysDot: [1, 1],
  dash: [4, 3],
  sysDash: [3, 1],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

function marker(type, color, defs) {
  if (!type || type === 'none') return;
  const id = 'arrow-' + crypto.randomUUID();
  const outline = type === 'arrow';
  const marker = svg('marker', {
    id,
    viewBox: '0 0 10 10',
    markerWidth: 4,
    markerHeight: 4,
    refX: type === 'oval' || type === 'diamond' ? 5 : 9,
    refY: 5,
    orient: 'auto-start-reverse',
    markerUnits: 'strokeWidth',
    overflow: 'visible',
  });
  if (type === 'oval')
    marker.append(svg('ellipse', { cx: 5, cy: 5, rx: 4, ry: 4, fill: color }));
  else
    marker.append(
      svg('path', {
        d:
          {
            arrow: 'M1 1 L9 5 L1 9',
            diamond: 'M0 5 L4.5 1 L9 5 L4.5 9Z',
            stealth: 'M0 0 L9 5 L0 10 L2.5 5Z',
          }[type] || 'M0 0 L9 5 L0 10Z',
        fill: outline ? 'none' : color,
        stroke: outline ? color : 'none',
        'stroke-width': 1.6,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  defs.append(marker);
  return 'url(#' + id + ')';
}
export function vectorDrawing(o, interactive = false) {
  const root = svg('svg', {
    viewBox: `0 0 ${o.w || 1} ${o.h || 1}`,
    preserveAspectRatio: 'none',
  });
  root.classList.add('geometry');
  const color = o.stroke || 'none',
    size = o.strokeWidth ?? 1;
  const defs = svg('defs'),
    start = marker(o.startArrow, color, defs),
    end = marker(o.endArrow, color, defs);
  if (defs.childElementCount) root.append(defs);
  for (const contours of paintPaths(o)) {
    const c = contours[0],
      d = contours.map((c) => pathData(c, o.w, o.h)).join(' '),
      p = svg('path', {
        d,
        fill: c.fillMode === 'none' ? 'none' : o.fill || 'none',
        stroke: c.stroke === false ? 'none' : color,
        'stroke-width': size,
      });
    if (Object.hasOwn(dashSegments, o.dash))
      p.setAttribute(
        'stroke-dasharray',
        dashSegments[o.dash].map((v) => v * size).join(' ')
      );
    if (start) p.setAttribute('marker-start', start);
    if (end) p.setAttribute('marker-end', end);
    root.append(p);
    if (interactive && (o.kind === 'line' || (o.kind === 'path' && !o.fill))) {
      const hit = svg('path', {
        d,
        fill: 'none',
        stroke: 'transparent',
        'vector-effect': 'non-scaling-stroke',
        'stroke-width': 12,
        'pointer-events': 'stroke',
      });
      hit.classList.add('line-hit');
      root.append(hit);
    }
  }
  return root;
}
export function appendVertexOverlay(layer, entry, selected, scale) {
  const o = entry.object,
    m = entry.transform.multiply(shapeTransform(o));
  const outline = svg('svg', { width: '100%', height: '100%' });
  outline.classList.add('vertex-outline');
  layer.append(outline);
  const g = svg('g', {
    transform: `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
  });
  outline.append(g);
  const local = (v) => ({ x: (v.x * o.w) / 1000, y: (v.y * o.h) / 1000 });
  function handle(p, path, vertex, arm) {
    const pt = local(p),
      world = m.transformPoint(pt);
    const h = document.createElement('i');
    h.className =
      'vertex-handle' +
      (arm ? ' control' : '') +
      (selected?.path === path && selected.vertex === vertex ? ' chosen' : '');
    Object.assign(h.dataset, { path, vertex });
    if (arm) h.dataset.arm = arm;
    Object.assign(h.style, { left: world.x + 'px', top: world.y + 'px' });
    layer.append(h);
  }
  for (const [i, c] of contoursFor(o).entries()) {
    if (!c.nodes.length) continue;
    g.append(
      svg('path', {
        d: pathData(c, o.w, o.h),
        fill: 'none',
        stroke: '#4358ef',
        'stroke-width': 1 / scale,
        'pointer-events': 'none',
      })
    );
    edges(c).forEach(({ a, b }, index) => {
      const p = local(a),
        hit = svg('path', {
          d: `M${p.x} ${p.y}` + edgeData(a, b, o.w, o.h),
          fill: 'none',
          stroke: 'transparent',
          'stroke-width': 9 / scale,
          'pointer-events': 'stroke',
        });
      hit.dataset.segment = index;
      hit.dataset.path = i;
      g.append(hit);
    });
    c.nodes.forEach((n, j) => {
      if (selected?.path === i && selected.vertex === j) {
        for (const arm of ['in', 'out'])
          if (n[arm]) {
            const a = local(n),
              b = local(n[arm]);
            g.append(
              svg('line', {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                stroke: '#7085f0',
                'stroke-width': 1 / scale,
                'pointer-events': 'none',
              })
            );
            handle(n[arm], i, j, arm);
          }
      }
      handle(n, i, j);
    });
  }
}

const dashOptions = [
  ['solid', 'Solid'],
  ['dash', 'Dashed'],
  ['dot', 'Dotted'],
];
const arrowOptions = [
  ['none', 'None'],
  ['triangle', 'Triangle'],
  ['arrow', 'Open arrow'],
  ['stealth', 'Stealth'],
  ['oval', 'Circle'],
  ['diamond', 'Diamond'],
];
function optionField(label, key, current, options) {
  return `<label class="field">${label}<select aria-label="${label}" data-vector-field="${key}">${options.map(([value, title]) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
}
export function strokePanel(o, { section, field, swatch }) {
  const dash = o.dash || 'solid',
    styles = dashOptions.some(([key]) => key === dash)
      ? dashOptions
      : [...dashOptions, [dash, 'Imported pattern']];
  let controls =
    field('Weight (pt)', 'strokeWidth', o.strokeWidth, 0.1, 500) +
    optionField('Line style', 'dash', dash, styles);
  if (
    o.kind === 'line' ||
    (o.kind === 'path' && contoursFor(o).some((c) => !c.closed))
  ) {
    controls +=
      optionField(
        'Start arrow',
        'startArrow',
        o.startArrow || 'none',
        arrowOptions
      ) +
      optionField('End arrow', 'endArrow', o.endArrow || 'none', arrowOptions);
  }
  return section(
    'Stroke',
    swatch('Stroke color', o.stroke, 'stroke') +
      '<div class="form-grid">' +
      controls +
      '</div>'
  );
}
