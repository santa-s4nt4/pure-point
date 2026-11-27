import { cornerPercent } from './shape-presets.js';
import {
  contoursFor,
  curveSettings,
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
    refX: 9,
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

// Stop the shaft inside each head. The markers stay on the original path so
// their tips and tangents still coincide with the editable Bézier endpoints.
function addArrowStroke(root, defs, path, contours, o, size, start, end) {
  const id = 'shaft-' + crypto.randomUUID();
  const mask = svg('mask', { id, maskUnits: 'userSpaceOnUse' });
  let minX = 0,
    minY = 0,
    maxX = o.w,
    maxY = o.h;
  for (const c of contours) {
    for (const n of c.nodes) {
      for (const p of [n, n.in, n.out]) {
        if (!p) continue;
        const x = (p.x * o.w) / 1000,
          y = (p.y * o.h) / 1000;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const pad = Math.max(1, 4 * size);
  const bounds = {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
  };
  for (const [k, value] of Object.entries(bounds)) mask.setAttribute(k, value);
  mask.append(svg('rect', { ...bounds, fill: 'white' }));
  const last = contours.at(-1);
  for (const [type, p] of [
    [start && o.startArrow, contours[0].nodes[0]],
    [end && o.endArrow, last.closed ? last.nodes[0] : last.nodes.at(-1)],
  ]) {
    if (type)
      mask.append(
        svg('circle', {
          cx: (p.x * o.w) / 1000,
          cy: (p.y * o.h) / 1000,
          r: (type === 'arrow' ? 0.6 : 1.3) * size,
          fill: 'black',
        })
      );
  }
  defs.append(mask);
  if (path.getAttribute('fill') !== 'none')
    root.append(
      svg('path', {
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill'),
      })
    );
  path.setAttribute('fill', 'none');
  path.setAttribute('mask', 'url(#' + id + ')');
  const tips = svg('path', {
    d: path.getAttribute('d'),
    fill: 'none',
    'stroke-width': size,
    'pointer-events': 'none',
  });
  if (start) tips.setAttribute('marker-start', start);
  if (end) tips.setAttribute('marker-end', end);
  if (o.stroke?.length === 9) {
    // Apply transparency to the assembled stroke so the joint stays uniform.
    const ink = svg('g', { opacity: parseInt(o.stroke.slice(7), 16) / 255 });
    path.setAttribute('stroke', o.stroke.slice(0, 7));
    ink.append(path, tips);
    root.append(ink);
  } else root.append(path, tips);
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
    start = marker(o.startArrow, color.slice(0, 7), defs),
    end = marker(o.endArrow, color.slice(0, 7), defs);
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
    if ((start || end) && c.stroke !== false && size > 0)
      addArrowStroke(root, defs, p, contours, o, size, start, end);
    else root.append(p);
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
export function shapePanel(o, { section, field }) {
  if (o.kind === 'callout')
    return section(
      'Shape',
      optionField(
        'Callout shape',
        'calloutShape',
        o.calloutShape || 'ellipse',
        [
          ['ellipse', 'Oval'],
          ['rect', 'Rectangle'],
          ['roundRect', 'Rounded rectangle'],
        ]
      )
    );
  if (o.kind === 'rect' || o.kind === 'roundRect')
    return section(
      'Shape',
      field('Corner radius (%)', 'cornerRadius', cornerPercent(o), 0, 50)
    );
  return '';
}
export function strokePanel(o, { section, field, swatch }, selected) {
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
    const settings = curveSettings(o, selected);
    if (settings) {
      controls += optionField(
        selected ? 'Point type' : 'Line shape',
        'curveMode',
        settings.curved ? 'curve' : 'straight',
        [
          ['straight', 'Straight'],
          ['curve', 'Curve'],
        ]
      );
      controls += `<label class="field">Curvature (%)<input type="number" min="-200" max="200" step="any" aria-label="Curvature (%)" data-curve-percent value="${settings.percent ?? ''}" placeholder="Mixed"></label>`;
    }
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
