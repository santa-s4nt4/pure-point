import { snapAxis } from './grid.js';
import { layerBounds } from './layers.js';
import { designUnit } from './model.js';

const crossAxis = (axis) => (axis === 'x' ? 'y' : 'x');
const lengthKey = (axis) => (axis === 'x' ? 'w' : 'h');
const farEdge = (box, axis) => box[axis] + box[lengthKey(axis)];
const midpoint = (box, axis) => (box[axis] + farEdge(box, axis)) / 2;

export function objectSpacing(entries, axis) {
  if (entries.length !== 2) return;
  const pair = entries.map((entry) => ({ entry, box: layerBounds(entry) }));
  const measure = (axis) => {
    const [first, second] = [...pair].sort(
      (a, b) => midpoint(a.box, axis) - midpoint(b.box, axis)
    );
    const across = crossAxis(axis);
    const start = farEdge(first.box, axis), end = second.box[axis];
    const near = Math.max(first.box[across], second.box[across]);
    const far = Math.min(farEdge(first.box, across), farEdge(second.box, across));
    return {
      axis,
      entry: second.entry,
      start,
      gap: end - start,
      center: (near + far) / 2,
      crossSize: Math.max(0, far - near),
    };
  };
  const spacing = axis ? measure(axis) : [measure('x'), measure('y')]
    .sort((a, b) => b.gap - a.gap)[0];
  // The handle belongs between the objects. A pair overlapping on both axes
  // can first be separated with a regular move.
  if (spacing.gap >= -1e-7) return { ...spacing, gap: Math.max(0, spacing.gap) };
}

export function appendSpacing(layer, spacing, scale) {
  const { axis, start, gap, center } = spacing;
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
