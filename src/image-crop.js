import { shapeTransform } from './layers.js';
import { setImageSource } from './media-format.js';
import { paintPicture } from './picture-effects.js';

const full = [0, 0, 0, 0];
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Keep the original image scale and the slide position of every retained pixel.
export function cropFrame(image, crop, offset = { x: 0, y: 0 }) {
  const [l, t, r, b] = image.crop || full;
  const sourceW = image.w / (1 - l - r);
  const sourceH = image.h / (1 - t - b);
  const w = sourceW * (1 - crop[0] - crop[2]);
  const h = sourceH * (1 - crop[1] - crop[3]);
  const center = shapeTransform(image).transformPoint({
    x: offset.x + (crop[0] - l) * sourceW + w / 2,
    y: offset.y + (crop[1] - t) * sourceH + h / 2,
  });
  return { x: center.x - w / 2, y: center.y - h / 2, w, h, crop };
}

export function editCrop({
  entry,
  item,
  assets,
  coordinates,
  finish,
  onDirty,
}) {
  const image = entry.object;
  const initial = image.crop || full;
  const [l, t, r, b] = initial;
  if (
    !assets[image.asset] ||
    image.w <= 0 ||
    image.h <= 0 ||
    l + r >= 1 ||
    t + b >= 1
  )
    return null;
  const width = image.w / (1 - l - r),
    height = image.h / (1 - t - b);
  const transform = entry.transform.multiply(shapeTransform(image));
  const inverse = transform.inverse();
  const scene = item.closest('.scene');
  const stage = item.closest('.stage');
  const source = document.createElement('div');
  source.className = 'crop-source';
  source.setAttribute('role', 'group');
  source.setAttribute('aria-label', 'Crop image');
  source.innerHTML =
    '<img draggable="false" alt=""><div class="crop-frame" data-edge="move" tabindex="0" role="group" aria-label="Reposition image"></div>';
  const img = source.querySelector('img'),
    frame = source.querySelector('.crop-frame');
  setImageSource(img, assets[image.asset], false, assets[image.fallbackAsset]);
  paintPicture(source, img, image);
  const actions = document.createElement('div');
  actions.className = 'crop-actions';
  actions.innerHTML =
    '<button class="top-action" data-crop="reset">Reset crop</button><button class="top-action" data-crop="cancel">Cancel</button><button class="top-action primary" data-crop="apply">Apply crop</button>';
  for (const [edge, label] of [
    ['nw', 'top left'],
    ['n', 'top'],
    ['ne', 'top right'],
    ['e', 'right'],
    ['se', 'bottom right'],
    ['s', 'bottom'],
    ['sw', 'bottom left'],
    ['w', 'left'],
  ]) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.dataset.edge = edge;
    handle.ariaLabel = 'Crop ' + label;
    handle.style.left = edge.includes('w')
      ? '0'
      : edge.includes('e')
        ? '100%'
        : '50%';
    handle.style.top = edge.includes('n')
      ? '0'
      : edge.includes('s')
        ? '100%'
        : '50%';
    frame.append(handle);
  }
  // Imported PowerPoint pictures may include padding beyond the source image.
  const minX = Math.min(0, l),
    maxX = Math.max(1, 1 - r);
  const minY = Math.min(0, t),
    maxY = Math.max(1, 1 - b);
  const spanX = maxX - minX,
    spanY = maxY - minY;
  let box = [l, t, 1 - r, 1 - b],
    offset = { x: 0, y: 0 },
    drag;
  Object.assign(source.style, {
    width: width * spanX + 'px',
    height: height * spanY + 'px',
  });
  Object.assign(img.style, {
    left: -minX * width + 'px',
    top: -minY * height + 'px',
    width: width + 'px',
    height: height + 'px',
  });
  const margins = () => [box[0], box[1], 1 - box[2], 1 - box[3]];
  const changed = () =>
    Boolean(
      offset.x ||
      offset.y ||
      margins().some((v, i) => Math.abs(v - initial[i]) > 1e-9)
    );
  let dirty = false;
  function paint() {
    if (dirty !== changed()) {
      dirty = !dirty;
      onDirty();
    }
    source.style.transform = transform
      .translate((minX - l) * width + offset.x, (minY - t) * height + offset.y)
      .toString();
    Object.assign(frame.style, {
      left: (box[0] - minX) * width + 'px',
      top: (box[1] - minY) * height + 'px',
      width: (box[2] - box[0]) * width + 'px',
      height: (box[3] - box[1]) * height + 'px',
    });
  }
  function adjust(edge, start, origin, dx, dy) {
    const [x, y, right, bottom] = start;
    const minW = Math.min(right - x, 1 / width);
    const minH = Math.min(bottom - y, 1 / height);
    if (edge === 'move') {
      dx = clamp(-dx, minX - x, maxX - right);
      dy = clamp(-dy, minY - y, maxY - bottom);
      offset = { x: origin.x - dx * width, y: origin.y - dy * height };
      box = [x + dx, y + dy, right + dx, bottom + dy];
    } else {
      box = [
        edge.includes('w') ? clamp(x + dx, minX, right - minW) : x,
        edge.includes('n') ? clamp(y + dy, minY, bottom - minH) : y,
        edge.includes('e') ? clamp(right + dx, x + minW, maxX) : right,
        edge.includes('s') ? clamp(bottom + dy, y + minH, maxY) : bottom,
      ];
    }
    paint();
  }
  frame.onpointerdown = (e) => {
    if (e.button !== 0 || drag) return;
    drag = {
      id: e.pointerId,
      edge: e.target.dataset.edge,
      point: inverse.transformPoint(coordinates(e)),
      offset,
      box,
    };
    e.target.setPointerCapture(e.pointerId);
  };
  frame.onpointermove = (e) => {
    if (drag?.id !== e.pointerId) return;
    const p = inverse.transformPoint(coordinates(e));
    adjust(
      drag.edge,
      drag.box,
      drag.offset,
      (p.x - drag.point.x) / width,
      (p.y - drag.point.y) / height
    );
  };
  frame.onpointercancel = (e) => {
    if (drag?.id !== e.pointerId) return;
    offset = drag.offset;
    box = drag.box;
    paint();
    drag = null;
  };
  frame.onlostpointercapture = (e) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  frame.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      finish(true);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
      return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.01;
    adjust(
      e.target.dataset.edge,
      box,
      offset,
      (Number(e.key === 'ArrowRight') - Number(e.key === 'ArrowLeft')) * step,
      (Number(e.key === 'ArrowDown') - Number(e.key === 'ArrowUp')) * step
    );
  };
  actions.onclick = (e) => {
    const action = e.target.closest('button')?.dataset.crop;
    if (action === 'reset') {
      box = [0, 0, 1, 1];
      offset = { x: 0, y: 0 };
      paint();
    } else if (action) finish(action === 'apply');
  };
  item.style.visibility = 'hidden';
  scene.append(source);
  stage.append(actions);
  paint();
  frame.focus({ preventScroll: true });
  return {
    object: image,
    changed,
    close(apply) {
      item.style.visibility = '';
      source.remove();
      actions.remove();
      if (apply && changed()) return cropFrame(image, margins(), offset);
    },
  };
}
