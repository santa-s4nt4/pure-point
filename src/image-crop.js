import { shapeTransform } from './layers.js';
import { setImageSource } from './media-format.js';
import { paintPicture } from './picture-effects.js';

const full = [0, 0, 0, 0];
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Keep the original image scale and the slide position of every retained pixel.
export function cropFrame(image, crop) {
  const [l, t, r, b] = image.crop || full;
  const sourceW = image.w / (1 - l - r);
  const sourceH = image.h / (1 - t - b);
  const w = sourceW * (1 - crop[0] - crop[2]);
  const h = sourceH * (1 - crop[1] - crop[3]);
  const center = shapeTransform(image).transformPoint({
    x: (crop[0] - l) * sourceW + w / 2,
    y: (crop[1] - t) * sourceH + h / 2,
  });
  return { x: center.x - w / 2, y: center.y - h / 2, w, h, crop };
}

export function chooseCrop(image, asset, fallbackAsset) {
  const initial = image.crop || full;
  const [l, t, r, b] = initial;
  if (!asset || image.w <= 0 || image.h <= 0 || l + r >= 1 || t + b >= 1)
    return null;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal crop-dialog';
  dialog.setAttribute('aria-labelledby', 'crop-heading');
  dialog.innerHTML = `<form method="dialog">
    <h3 id="crop-heading">Crop image</h3>
    <div class="crop-stage"><div class="crop-source"><img draggable="false" alt="">
      <div class="crop-frame" data-edge="move" tabindex="0" role="group" aria-label="Move crop area"></div>
    </div></div>
    <div class="buttons"><button class="top-action crop-reset" type="button">Reset crop</button>
    <button class="top-action" value="cancel">Cancel</button><button class="top-action primary" value="apply">Apply crop</button></div>
  </form>`;
  const source = dialog.querySelector('.crop-source');
  const stage = dialog.querySelector('.crop-stage');
  const frame = dialog.querySelector('.crop-frame');
  const img = source.querySelector('img');
  setImageSource(img, asset, false, fallbackAsset);
  paintPicture(source, img, image);
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
  const ratio =
    ((image.w / (1 - l - r)) * spanX) / ((image.h / (1 - t - b)) * spanY);
  function place(node, [x, y, right, bottom]) {
    Object.assign(node.style, {
      left: (100 * (x - minX)) / spanX + '%',
      top: (100 * (y - minY)) / spanY + '%',
      width: (100 * (right - x)) / spanX + '%',
      height: (100 * (bottom - y)) / spanY + '%',
    });
  }
  let box = [l, t, 1 - r, 1 - b],
    drag;
  function fitPreview() {
    const width = Math.min(
      stage.clientWidth - 24,
      (stage.clientHeight - 24) * ratio
    );
    source.style.width = width + 'px';
    source.style.height = width / ratio + 'px';
  }
  const resize = new ResizeObserver(fitPreview);
  place(img, [0, 0, 1, 1]);
  place(frame, box);
  function adjust(edge, start, dx, dy) {
    const [x, y, right, bottom] = start;
    const size = source.getBoundingClientRect();
    const minW = Math.min(right - x, (12 * spanX) / size.width);
    const minH = Math.min(bottom - y, (12 * spanY) / size.height);
    if (edge === 'move') {
      dx = clamp(dx, minX - x, maxX - right);
      dy = clamp(dy, minY - y, maxY - bottom);
      box = [x + dx, y + dy, right + dx, bottom + dy];
    } else {
      box = [
        edge.includes('w') ? clamp(x + dx, minX, right - minW) : x,
        edge.includes('n') ? clamp(y + dy, minY, bottom - minH) : y,
        edge.includes('e') ? clamp(right + dx, x + minW, maxX) : right,
        edge.includes('s') ? clamp(bottom + dy, y + minH, maxY) : bottom,
      ];
    }
    place(frame, box);
  }
  frame.onpointerdown = (e) => {
    if (e.button !== 0 || drag) return;
    drag = {
      id: e.pointerId,
      edge: e.target.dataset.edge,
      x: e.clientX,
      y: e.clientY,
      box,
    };
    e.target.setPointerCapture(e.pointerId);
  };
  frame.onpointermove = (e) => {
    if (drag?.id !== e.pointerId) return;
    const size = source.getBoundingClientRect();
    adjust(
      drag.edge,
      drag.box,
      ((e.clientX - drag.x) * spanX) / size.width,
      ((e.clientY - drag.y) * spanY) / size.height
    );
  };
  frame.onpointercancel = (e) => {
    if (drag?.id !== e.pointerId) return;
    box = drag.box;
    place(frame, box);
    drag = null;
  };
  frame.onlostpointercapture = (e) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  frame.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dialog.close('apply');
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
      return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.01;
    adjust(
      e.target.dataset.edge,
      box,
      (Number(e.key === 'ArrowRight') - Number(e.key === 'ArrowLeft')) * step,
      (Number(e.key === 'ArrowDown') - Number(e.key === 'ArrowUp')) * step
    );
  };
  dialog.querySelector('.crop-reset').onclick = () => {
    box = [0, 0, 1, 1];
    place(frame, box);
  };
  return new Promise((resolve) => {
    dialog.onclose = () => {
      resize.disconnect();
      dialog.remove();
      const crop = [box[0], box[1], 1 - box[2], 1 - box[3]];
      resolve(
        dialog.returnValue === 'apply' &&
          crop.some((v, i) => Math.abs(v - initial[i]) > 1e-9)
          ? crop
          : null
      );
    };
    document.body.append(dialog);
    dialog.showModal();
    fitPreview();
    resize.observe(stage);
    frame.focus();
  });
}
