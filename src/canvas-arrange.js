import { snapAxis } from './grid.js';
import { layerBounds } from './layers.js';
import { designUnit } from './model.js';

const crossAxis = (axis) => (axis === 'x' ? 'y' : 'x');
const lengthKey = (axis) => (axis === 'x' ? 'w' : 'h');
const farEdge = (box, axis) => box[axis] + box[lengthKey(axis)];
const midpoint = (box, axis) => (box[axis] + farEdge(box, axis)) / 2;

function spacingAlong(selection, axis) {
  const across = crossAxis(axis);
  const ordered = [...selection].sort((a, b) => a.box[axis] - b.box[axis]);
  const bands = [];
  for (const { entry, box } of ordered) {
    const start = box[axis], end = farEdge(box, axis);
    const near = box[across], far = farEdge(box, across);
    const band = bands.at(-1);
    // An overlapping projection belongs in the same row or column. Touching
    // objects retain a zero-gap handle, including after dragging them together.
    if (band && (start < band.end - 1e-7 || start === band.start)) {
      band.end = Math.max(band.end, end);
      band.near = Math.min(band.near, near);
      band.far = Math.max(band.far, far);
      band.entries.push(entry);
    } else bands.push({ start, end, near, far, entries: [entry] });
  }
  const gaps = bands.slice(1).map((next, index) => {
    const previous = bands[index];
    const near = Math.max(previous.near, next.near);
    const far = Math.min(previous.far, next.far);
    return {
      start: previous.end,
      gap: Math.max(0, next.start - previous.end),
      center: (near + far) / 2,
      crossSize: Math.max(0, far - near),
    };
  });
  return { axis, bands, gaps };
}

export function objectSpacing(entries, axis) {
  const available = entries.filter((entry) => !entry.hidden && !entry.locked);
  if (available.length !== entries.length || available.length < 2) return [];
  const selection = available.map((entry) => ({ entry, box: layerBounds(entry) }));
  const layouts = (axis ? [axis] : ['x', 'y'])
    .map((direction) => spacingAlong(selection, direction))
    .filter((layout) => layout.gaps.length);
  if (layouts.length < 2) return layouts;
  // A grid has distinct gaps in both directions. Diagonally separated
  // objects get one set of handles so the two axes cannot obscure each other.
  const aligned = layouts.filter(({ gaps }) => gaps.some((gap) => gap.crossSize > 0));
  if (aligned.length) return aligned;
  const total = ({ gaps }) => gaps.reduce((sum, { gap }) => sum + gap, 0);
  return [layouts.sort((a, b) => total(b) - total(a))[0]];
}

export function appendSpacing(layer, axis, spacing, index, scale) {
  const { start, gap, center } = spacing;
  const crossSize = Math.max(spacing.crossSize, 16 / scale);
  const region = document.createElement('div');
  region.className = 'object-spacing';
  const horizontal = axis === 'x';
  Object.assign(region.style, {
    left: (horizontal ? start : center - crossSize / 2) + 'px',
    top: (horizontal ? center - crossSize / 2 : start) + 'px',
    width: (horizontal ? gap : crossSize) + 'px',
    height: (horizontal ? crossSize : gap) + 'px',
  });
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'spacing-handle';
  handle.dataset.spacingHandle = axis;
  handle.dataset.spacingGap = index;
  handle.title = `Adjust ${horizontal ? 'horizontal' : 'vertical'} spacing`;
  const amount = Math.round(gap * designUnit * 10) / 10 + ' px';
  const direction = document.createElement('span');
  direction.setAttribute('aria-hidden', 'true');
  direction.textContent = horizontal ? '↔' : '↕';
  handle.append(direction, amount);
  handle.setAttribute('aria-label', `${handle.title}, ${amount}`);
  region.append(handle);
  layer.append(region);
}

export function stationaryBounds(all, moving) {
  const ids = new Set(moving.map((entry) => entry.object.id));
  const ancestors = new Set();
  for (const entry of moving)
    for (let parent = entry.parent; parent; parent = parent.parent)
      ancestors.add(parent.object.id);
  return [...all.values()]
    .filter(({ object, parent, hidden }) =>
      !hidden && !ids.has(object.id) && !ancestors.has(object.id) &&
      (!parent || ancestors.has(parent.object.id))
    )
    .map(layerBounds);
}

const anchors = (box, axis) => [box[axis], midpoint(box, axis), farEdge(box, axis)];

function alignment(moving, stationary, axis, offset, acrossOffset, threshold) {
  const across = crossAxis(axis);
  let best;
  for (const source of moving) {
    const positions = anchors(source, axis).map((v) => v + offset);
    const start = source[across] + acrossOffset;
    const end = farEdge(source, across) + acrossOffset;
    for (const target of stationary) {
      const snap = snapAxis(positions, anchors(target, axis), threshold);
      if (snap.guide === null) continue;
      const distance = Math.max(0, target[across] - end, start - farEdge(target, across));
      const error = Math.abs(snap.delta);
      if (!best || error < best.error || (error === best.error && distance < best.distance))
        best = { ...snap, source, target, error, distance };
    }
  }
  return best;
}

export function snapMovement(moving, stationary, box, guides, dx, dy, scale) {
  const threshold = 5 / scale;
  const sx = alignment(moving, stationary, 'x', dx, dy, threshold) ||
    snapAxis(anchors(box, 'x').map((v) => v + dx), guides.x, threshold);
  const sy = alignment(moving, stationary, 'y', dy, dx, threshold) ||
    snapAxis(anchors(box, 'y').map((v) => v + dy), guides.y, threshold);
  const x = dx + sx.delta, y = dy + sy.delta;
  const guide = (snap, axis, acrossOffset) => {
    if (!snap.target) return snap.guide;
    return {
      position: snap.guide,
      start: Math.min(snap.source[axis] + acrossOffset, snap.target[axis]) - threshold,
      end: Math.max(farEdge(snap.source, axis) + acrossOffset, farEdge(snap.target, axis)) + threshold,
    };
  };
  return { x, y, guideX: guide(sx, 'y', y), guideY: guide(sy, 'x', x) };
}
