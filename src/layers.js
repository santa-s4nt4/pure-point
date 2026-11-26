import { shape } from './model.js';

const matrix = () => new DOMMatrix();
const signed = (value) => (value ? -1 : 1);

// Local shape coordinates -> parent DrawingML coordinates. Transforming the
// child coordinate box separately accounts for resized, rotated, nested groups.
export function shapeTransform(o) {
  return matrix()
    .translate(o.x + o.w / 2, o.y + o.h / 2)
    .rotate(o.rotation || 0)
    .scale(signed(o.flipH), signed(o.flipV))
    .translate(-o.w / 2, -o.h / 2);
}
function childTransform(group) {
  const [x, y, w, h] = group.childBox;
  return shapeTransform(group)
    .scale(group.w / (w || 1), group.h / (h || 1))
    .translate(-x, -y);
}

export function layerEntries(items) {
  const entries = new Map();
  function walk(siblings, parent, transform) {
    for (const object of siblings) {
      const entry = {
        object,
        siblings,
        parent,
        transform,
        hidden: !!object.hidden || !!parent?.hidden,
        locked: !!object.locked || !!parent?.locked,
      };
      entries.set(object.id, entry);
      if (object.kind === 'group')
        walk(object.items, entry, transform.multiply(childTransform(object)));
    }
  }
  walk(items, null, matrix());
  return entries;
}

export function layerBounds(entry) {
  const o = entry.object,
    m = entry.transform.multiply(shapeTransform(o));
  if (o.kind === 'group' && o.items.length)
    return contentBounds(o, entry.transform.multiply(childTransform(o)));
  const corners = [
    [0, 0],
    [o.w, 0],
    [0, o.h],
    [o.w, o.h],
  ].map(([x, y]) => m.transformPoint({ x, y }));
  return bounds(
    corners.map((p) => p.x),
    corners.map((p) => p.y)
  );
}
function bounds(xs, ys) {
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function selectionBounds(entries) {
  const boxes = entries.map(layerBounds);
  return bounds(
    boxes.flatMap((b) => [b.x, b.x + b.w]),
    boxes.flatMap((b) => [b.y, b.y + b.h])
  );
}

function contentBounds(group, transform) {
  const visible = group.items.filter((item) => !item.hidden);
  return selectionBounds(
    (visible.length ? visible : group.items).map((object) => ({
      object,
      transform,
    }))
  );
}

// Change the group frame and its child coordinate box together so the
// child-to-parent transform stays the same, even for rotated/flipped groups.
export function fitGroup(group) {
  if (!group.items.length) return;
  const box = contentBounds(group, matrix());
  const next = [box.x, box.y, Math.max(0.001, box.w), Math.max(0.001, box.h)];
  if (next.every((v, i) => Math.abs(v - group.childBox[i]) < 1e-7)) return;
  const center = childTransform(group).transformPoint({
    x: box.x + next[2] / 2,
    y: box.y + next[3] / 2,
  });
  const w = (next[2] * group.w) / group.childBox[2];
  const h = (next[3] * group.h) / group.childBox[3];
  Object.assign(group, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    childBox: next,
  });
}

export function fitGroups(items) {
  for (const group of items.filter((o) => o.kind === 'group')) {
    fitGroups(group.items);
    fitGroup(group);
  }
}

// A parent and its child must not both receive a drag, delete, or nudge.
export function independentEntries(entries) {
  const ids = new Set(entries.map((e) => e.object.id));
  return entries.filter((entry) => {
    for (let parent = entry.parent; parent; parent = parent.parent)
      if (ids.has(parent.object.id)) return false;
    return true;
  });
}
export function localDelta(transform, x, y) {
  const inverse = transform.inverse();
  return { x: inverse.a * x + inverse.c * y, y: inverse.b * x + inverse.d * y };
}

function scaleTextAndStroke(object, sx, sy) {
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return;
  if (object.strokeWidth) object.strokeWidth *= Math.sqrt(sx * sy);
  if (!object.text && object.kind !== 'text') return;
  object.size *= sy;
  object.inset = object.inset.map((v, i) => v * (i % 2 ? sy : sx));
  for (const p of object.paragraphs || []) {
    p.base.size *= sy;
    for (const run of p.runs) run.size *= sy;
    if (p.margin) p.margin *= sx;
    if (p.marginRight) p.marginRight *= sx;
    if (p.indent) p.indent *= sx;
    if (p.before) p.before *= sy;
    if (p.after) p.after *= sy;
    if (typeof p.lineHeight === 'string' && p.lineHeight.endsWith('px'))
      p.lineHeight = parseFloat(p.lineHeight) * sy + 'px';
  }
}
function changeParent(object, transform) {
  const m = transform.multiply(shapeTransform(object));
  const center = m.transformPoint({ x: object.w / 2, y: object.h / 2 });
  const sx = Math.hypot(m.a, m.b),
    sy = Math.hypot(m.c, m.d);
  const flip = m.a * m.d - m.b * m.c < 0;
  const w = object.w * sx,
    h = object.h * sy;
  if (Math.abs(m.a * m.c + m.b * m.d) > 1e-6 * sx * sy) {
    // DrawingML has no skew attribute. An individual group preserves a shape
    // under shear without rasterizing its text, linked media or custom paths.
    return null;
  }
  // Preserve an equivalent rotation/flip pair when the group was only moved.
  if (
    Math.abs(transform.a - 1) < 1e-9 &&
    Math.abs(transform.d - 1) < 1e-9 &&
    Math.abs(transform.b) + Math.abs(transform.c) < 1e-9
  ) {
    object.x += transform.e;
    object.y += transform.f;
    return object;
  }
  scaleTextAndStroke(object, sx, sy);
  Object.assign(object, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    flipH: false,
    flipV: flip,
  });
  return object;
}
function ancestry(entry) {
  const path = [];
  for (let item = entry; item; item = item.parent) path.unshift(item);
  return path;
}
function wrapTransform(group, child) {
  return shape('group', child.name, group.x, group.y, group.w, group.h, {
    rotation: group.rotation,
    flipH: group.flipH,
    flipV: group.flipV,
    hidden: group.hidden,
    childBox: [...group.childBox],
    items: [child],
  });
}

// Clipboard roots use slide coordinates so they can be pasted on any slide.
// Keep a group wrapper when nested transforms introduce shear.
export function copiesOnSlide(items, selectedIds, prepare) {
  const ids = new Set(selectedIds);
  const entries = independentEntries(
    [...layerEntries(items).values()].filter((entry) =>
      ids.has(entry.object.id)
    )
  );
  function detach(o) {
    prepare?.(o);
    delete o.source;
    delete o.copyOf;
    delete o.officeId;
    delete o.placeholder;
    delete o.layoutOriginal;
    o.items?.forEach(detach);
  }
  return entries.map((entry) => {
    let copy = structuredClone(entry.object);
    detach(copy);
    if (entry.parent && !changeParent(copy, entry.transform)) {
      for (let parent = entry.parent; parent; parent = parent.parent)
        copy = wrapTransform(parent.object, copy);
    }
    if (entry.hidden) copy.hidden = true;
    return copy;
  });
}

export function makeGroup(entries) {
  if (entries.length < 2 || entries.some((e) => e.locked)) return null;
  const paths = entries.map(ancestry);
  // Move layers into their nearest common ancestor; retain drawing order across branches.
  let depth = 0;
  while (paths.every((p) => p[depth] && p[depth] === paths[0][depth])) depth++;
  const parent = depth ? paths[0][depth - 1] : null;
  const siblings = parent ? parent.object.items : paths[0][0].siblings;
  const basis = parent
    ? parent.transform.multiply(childTransform(parent.object))
    : matrix();
  const inverse = basis.inverse();
  const rank = (path) =>
    path.slice(depth).map((e) => e.siblings.indexOf(e.object));
  const sorted = paths
    .map((path) => ({ path, rank: rank(path) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.rank.length, b.rank.length); i++)
        if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
      return a.rank.length - b.rank.length;
    });
  const highest = sorted[sorted.length - 1].rank[0];
  const previous = siblings.slice(0, highest + 1),
    itemBounds = entries.map((e) => ({
      ...e,
      transform: inverse.multiply(e.transform),
    }));
  const { x, y, w, h } = selectionBounds(itemBounds);
  const items = [];
  for (const { path } of sorted) {
    const entry = path[path.length - 1];
    const transform = inverse.multiply(entry.transform);
    const moved = changeParent(entry.object, transform);
    let object = moved || entry.object;
    // Preserve inherited invisibility and affine transforms of a removed ancestor.
    for (let i = path.length - 2; i >= depth; i--) {
      if (!moved) object = wrapTransform(path[i].object, object);
      if (path[i].object.hidden) object.hidden = true;
    }
    items.push(object);
    entry.siblings.splice(entry.siblings.indexOf(entry.object), 1);
  }
  for (const { path } of sorted) {
    for (let i = path.length - 2; i >= depth; i--) {
      const branch = path[i],
        idx = branch.siblings.indexOf(branch.object);
      if (!branch.object.items.length && idx >= 0)
        branch.siblings.splice(idx, 1);
    }
  }
  const group = shape(
    'group',
    'Group',
    x,
    y,
    Math.max(w, 0.001),
    Math.max(h, 0.001),
    {
      childBox: [x, y, Math.max(w, 0.001), Math.max(h, 0.001)],
      items,
    }
  );
  siblings.splice(
    previous.filter((o) => siblings.includes(o)).length,
    0,
    group
  );
  return group;
}
export function ungroup(entry) {
  const group = entry.object;
  if (group.kind !== 'group' || entry.locked) return [];
  const transform = childTransform(group);
  const result = group.items.map((o) => {
    const moved = changeParent(o, transform);
    if (moved) {
      if (group.hidden) moved.hidden = true;
      return moved;
    }
    return wrapTransform(group, o);
  });
  entry.siblings.splice(entry.siblings.indexOf(group), 1, ...result);
  return result;
}
