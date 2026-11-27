import { blue, shape } from './model.js';
import { shapeTransform } from './layers.js';
import { presetContour } from './shape-presets.js';

export const vectorKinds = new Set([
  'rect',
  'roundRect',
  'triangle',
  'callout',
  'ellipse',
  'line',
  'path',
]);
const K = (4 * (Math.sqrt(2) - 1)) / 3;
const node = (x, y) => ({ x, y });
const pairs = (values) => values.map(([x, y]) => node(x, y));
const lerp = (a, b, t) => node(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

export function contoursFor(o) {
  if (o.contours) return o.contours;
  if (o.kind === 'path') {
    return (o.paths || []).map((path) => {
      const nodes = pairs(path);
      const first = nodes[0],
        last = nodes.at(-1);
      const closed =
        nodes.length > 2 && first.x === last.x && first.y === last.y;
      if (closed) nodes.pop();
      return { nodes, closed };
    });
  }
  if (o.kind === 'ellipse') {
    const d = 500 * K;
    return [
      {
        closed: true,
        nodes: [
          { x: 500, y: 0, in: node(500 - d, 0), out: node(500 + d, 0) },
          {
            x: 1000,
            y: 500,
            in: node(1000, 500 - d),
            out: node(1000, 500 + d),
          },
          {
            x: 500,
            y: 1000,
            in: node(500 + d, 1000),
            out: node(500 - d, 1000),
          },
          { x: 0, y: 500, in: node(0, 500 + d), out: node(0, 500 - d) },
        ],
      },
    ];
  }
  if (['rect', 'roundRect', 'callout'].includes(o.kind))
    return [presetContour(o)];
  if (o.kind === 'line')
    return [
      {
        closed: false,
        nodes: pairs([
          [0, 0],
          [1000, 1000],
        ]),
      },
    ];
  return [
    {
      closed: true,
      nodes: pairs(
        o.kind === 'triangle'
          ? [
              [500, 0],
              [1000, 1000],
              [0, 1000],
            ]
          : [
              [0, 0],
              [1000, 0],
              [1000, 1000],
              [0, 1000],
            ]
      ),
    },
  ];
}

// Multiple contours in one DrawingML path share a fill. Keeping them together
// preserves cutouts when editing logos and other compound vector shapes.
export function paintPaths(o) {
  const paths = [];
  for (const c of contoursFor(o)) {
    if (!c.nodes.length) continue;
    const last = paths.at(-1);
    if (last && c.pathIndex !== undefined && c.pathIndex === last[0].pathIndex)
      last.push(c);
    else paths.push([c]);
  }
  return paths;
}

export function edges(contour) {
  return contour.nodes
    .slice(0, contour.closed ? undefined : -1)
    .map((a, i) => ({ a, b: contour.nodes[(i + 1) % contour.nodes.length] }));
}
export const curved = (a, b) => !!(a.out || b.in);
const svgPoint = (v, w, h) => (v.x * w) / 1000 + ' ' + (v.y * h) / 1000;
export function edgeData(a, b, w, h) {
  return curved(a, b)
    ? 'C' + [a.out || a, b.in || b, b].map((p) => svgPoint(p, w, h)).join(' ')
    : 'L' + svgPoint(b, w, h);
}
export function pathData(c, w, h) {
  if (!c.nodes.length) return '';
  return (
    'M' +
    svgPoint(c.nodes[0], w, h) +
    edges(c)
      .map(({ a, b }) => edgeData(a, b, w, h))
      .join('') +
    (c.closed ? 'Z' : '')
  );
}

export function createAt(kind, start) {
  return shape(
    kind,
    { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', callout: 'Callout' }[
      kind
    ],
    start.x,
    start.y,
    0,
    0,
    kind === 'line'
      ? { stroke: '#222521', strokeWidth: 1.5 }
      : kind === 'callout'
        ? {
            fill: blue,
            calloutShape: 'ellipse',
            color: '#FFFFFF',
            align: 'center',
            valign: 'middle',
            inset: [6, 3, 6, 3],
          }
        : { fill: blue }
  );
}
export function sizeDraft(o, start, end, constrain) {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  if (constrain) {
    if (o.kind === 'line') {
      const angle =
          (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
        length = Math.hypot(dx, dy);
      dx = length * Math.cos(angle);
      dy = length * Math.sin(angle);
    } else {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (Math.sign(dx) || 1) * side;
      dy = (Math.sign(dy) || 1) * side;
    }
  }
  if (Math.abs(dx) < 1e-8) dx = 0;
  if (Math.abs(dy) < 1e-8) dy = 0;
  Object.assign(o, {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  });
  if (o.kind === 'line') Object.assign(o, { flipH: dx < 0, flipV: dy < 0 });
}

function mapPoint(c, fn) {
  return {
    ...c,
    nodes: c.nodes.map((n) => {
      const p = fn(n);
      if (n.in) p.in = fn(n.in);
      if (n.out) p.out = fn(n.out);
      return p;
    }),
  };
}
export const localContours = (o) =>
  contoursFor(o).map((c) =>
    mapPoint(c, (v) => node((v.x * o.w) / 1000, (v.y * o.h) / 1000))
  );

// Keep each untouched anchor at its original slide coordinate while fitting the
// new bounding rectangle. The shape can be flipped, rotated or inside a group.
export function applyContours(o, original, local) {
  const transform = shapeTransform(original);
  if (
    o.kind === 'line' &&
    local.length === 1 &&
    local[0].nodes.length === 2 &&
    !curved(...local[0].nodes)
  ) {
    const ends = local[0].nodes.map((p) => transform.transformPoint(p));
    o.rotation = 0;
    sizeDraft(o, ends[0], ends[1], false);
    delete o.contours;
    return;
  }
  const all = local.flatMap((c) =>
    c.nodes.flatMap((v) => [v, v.in, v.out].filter(Boolean))
  );
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y);
  const left = Math.min(...xs),
    top = Math.min(...ys),
    w = Math.max(...xs) - left,
    h = Math.max(...ys) - top;
  const center = transform.transformPoint({ x: left + w / 2, y: top + h / 2 });
  Object.assign(o, {
    kind: o.kind === 'line' ? 'line' : 'path',
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    contours: local.map((c) =>
      mapPoint(c, (p) =>
        node(((p.x - left) / (w || 1)) * 1000, ((p.y - top) / (h || 1)) * 1000)
      )
    ),
  });
  delete o.paths;
}

// At an interior anchor the angle bisector of the adjacent segments gives
// both handles the same tangent. Endpoints bend toward the same side of a line.
function direction(a, b) {
  if (!a || !b) return;
  const x = b.x - a.x,
    y = b.y - a.y,
    length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length, length } : undefined;
}
function curveHandles(contours, selected) {
  const handles = [];
  contours.forEach((contour, path) => {
    if (contour.closed || (selected && selected.path !== path)) return;
    contour.nodes.forEach((anchor, i, nodes) => {
      if (selected && selected.vertex !== i) return;
      const incoming = direction(nodes[i - 1], anchor);
      const outgoing = direction(anchor, nodes[i + 1]);
      if (!incoming && !outgoing) return;
      let x = (incoming?.x || 0) + (outgoing?.x || 0);
      let y = (incoming?.y || 0) + (outgoing?.y || 0);
      if (Math.hypot(x, y) < 1e-8) ({ x, y } = outgoing);
      const tangent = Math.atan2(y, x);
      if (outgoing)
        handles.push({
          anchor,
          arm: 'out',
          reference: tangent,
          sign: 1,
          length: outgoing.length,
        });
      if (incoming)
        handles.push({
          anchor,
          arm: 'in',
          reference: tangent + Math.PI,
          sign: outgoing ? 1 : -1,
          length: incoming.length,
        });
    });
  });
  return handles;
}
export function curveSettings(o, selected) {
  const handles = curveHandles(localContours(o), selected);
  if (!handles.length) return;
  const values = handles.map(({ anchor, arm, reference, sign }) => {
    const p = direction(anchor, anchor[arm]);
    if (!p) return 0;
    const offset = Math.atan2(p.y, p.x) - reference;
    const radians = Math.atan2(Math.sin(offset), Math.cos(offset));
    return Math.round((radians * sign * 2000) / Math.PI) / 10;
  });
  return {
    curved: handles.some(({ anchor, arm }) => anchor[arm]),
    percent: values.every((n) => n === values[0]) ? values[0] : null,
  };
}
export function setCurvature(o, selected, percent) {
  if (percent !== null && !Number.isFinite(percent)) return;
  const radians = (Math.min(200, Math.max(-200, percent)) * Math.PI) / 200;
  const contours = localContours(o);
  for (const { anchor, arm, reference, sign, length } of curveHandles(
    contours,
    selected
  )) {
    if (percent === null) {
      delete anchor[arm];
      continue;
    }
    const angle = reference + sign * radians;
    const radius = direction(anchor, anchor[arm])?.length || length / 3;
    anchor[arm] = node(
      anchor.x + radius * Math.cos(angle),
      anchor.y + radius * Math.sin(angle)
    );
  }
  applyContours(o, o, contours);
}
export function moveVertex(o, initial, key, point, independent = false) {
  const local = localContours(initial),
    n = local[key.path].nodes[key.vertex];
  if (key.arm) {
    const other = key.arm === 'in' ? 'out' : 'in';
    const old = direction(n, n[key.arm]),
      opposite = direction(n, n[other]);
    const next = direction(n, point);
    // Opposed handles identify a smooth join, including imported paths.
    // Keep the other handle's length when rotating it with the pointer.
    if (
      !independent &&
      old &&
      opposite &&
      next &&
      Math.hypot(old.x + opposite.x, old.y + opposite.y) < 0.0001
    )
      n[other] = node(
        n.x - next.x * opposite.length,
        n.y - next.y * opposite.length
      );
    n[key.arm] = point;
  } else {
    for (const arm of ['in', 'out'])
      if (n[arm]) {
        n[arm].x += point.x - n.x;
        n[arm].y += point.y - n.y;
      }
    n.x = point.x;
    n.y = point.y;
  }
  applyContours(o, initial, local);
}
export function splitEdge(o, path, index, position) {
  const contours = localContours(o),
    c = contours[path],
    { a, b } = edges(c)[index];
  const c1 = a.out || a,
    c2 = b.in || b;
  function split(t) {
    const ab = lerp(a, c1, t),
      bc = lerp(c1, c2, t),
      cd = lerp(c2, b, t),
      abc = lerp(ab, bc, t),
      bcd = lerp(bc, cd, t);
    return { ab, abc, bcd, cd, p: lerp(abc, bcd, t) };
  }
  const distance = (t) => {
    const p = curved(a, b) ? split(t).p : lerp(a, b, t);
    return Math.hypot(p.x - position.x, p.y - position.y);
  };
  let best = 0;
  for (let i = 1; i <= 32; i++)
    if (distance(i / 32) < distance(best)) best = i / 32;
  let min = Math.max(0.001, best - 1 / 32),
    max = Math.min(0.999, best + 1 / 32);
  for (let i = 0; i < 14; i++) {
    const a = min + (max - min) / 3,
      b = max - (max - min) / 3;
    if (distance(a) < distance(b)) max = b;
    else min = a;
  }
  const t = (min + max) / 2;
  let v;
  if (curved(a, b)) {
    const s = split(t);
    v = { ...s.p, in: s.abc, out: s.bcd };
    a.out = s.ab;
    b.in = s.cd;
  } else v = lerp(a, b, t);
  c.nodes.splice(index + 1, 0, v);
  applyContours(o, o, contours);
  return index + 1;
}
export function deleteVertex(o, key) {
  const contours = localContours(o),
    c = contours[key.path];
  if (!c?.nodes[key.vertex] || c.nodes.length <= (c.closed ? 3 : 2))
    return false;
  c.nodes.splice(key.vertex, 1);
  applyContours(o, o, contours);
  return true;
}
export function resizeDimensions(o, from, deltaW, deltaH, shift, axis) {
  const min = o.kind === 'line' || o.kind === 'path' ? 0 : 1;
  let w = axis === 'y' ? from.w : Math.max(min, from.w + deltaW),
    h = axis === 'x' ? from.h : Math.max(min, from.h + deltaH);
  const media = o.kind === 'image' || o.kind === 'video';
  const proportionalCorner = !axis &&
    (shift || (o.kind !== 'text' && !vectorKinds.has(o.kind)));
  if ((media || proportionalCorner) && from.w > 0 && from.h > 0) {
    // Edges follow the pointer on their own axis. Corners project the
    // pointer motion onto the original diagonal.
    const change =
      axis === 'x' ? deltaW / from.w :
      axis === 'y' ? deltaH / from.h :
      (deltaW * from.w + deltaH * from.h) / (from.w ** 2 + from.h ** 2);
    const ratio = Math.max(1 / Math.min(from.w, from.h), 1 + change);
    w = from.w * ratio;
    h = from.h * ratio;
  }
  return { w, h };
}
