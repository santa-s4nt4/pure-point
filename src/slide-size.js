import { refreshCommentPositions } from './comment-anchors.js';
import { designUnit, slideSizes } from './model.js';

export const sameSlideSize = (a, b) => a.w === b.w && a.h === b.h;
export const slideSizeLabel = ({ w, h }) =>
  `${Math.round(w * designUnit)} × ${Math.round(h * designUnit)} px`;

export function slideFrameResize(from, to) {
  const reference = slideSizes[0];
  const fit = (size) => Math.min(size.w / reference.w, size.h / reference.h);
  const scale = fit(to) / fit(from);

  function axis(position, extent, before, after) {
    const length = extent * scale;
    // Preserve edge alignment for objects that fit, and use relative centers
    // for objects that already cross an edge or are larger than the new slide.
    const room = before - extent;
    const start =
      room > 0 && position >= 0 && position <= room && length <= after
        ? (position / room) * (after - length)
        : ((position + extent / 2) / before) * after - length / 2;
    return [start, length];
  }

  return (frame, placeholder = false) => {
    const { x, y, w, h } = frame;
    const fullSlide =
      !frame.rotation && x === 0 && y === 0 && sameSlideSize(frame, from);
    if (placeholder || fullSlide)
      return {
        x: (x * to.w) / from.w,
        y: (y * to.h) / from.h,
        w: (w * to.w) / from.w,
        h: (h * to.h) / from.h,
      };
    const [left, width] = axis(x, w, from.w, to.w);
    const [top, height] = axis(y, h, from.h, to.h);
    return { x: left, y: top, w: width, h: height };
  };
}

export function resizeDeck(deck, size) {
  const resize = slideFrameResize(deck, size);
  for (const slide of deck.slides) {
    // Keep group child coordinates intact. The group's frame scales its contents.
    for (const item of [...slide.back, ...slide.items]) {
      const placeholder = Boolean(item.placeholder);
      Object.assign(item, resize(item, placeholder));
      if (item.layoutOriginal)
        Object.assign(item.layoutOriginal, resize(item.layoutOriginal, placeholder));
    }
    for (const comment of slide.comments || []) {
      if (comment.objectId) continue;
      comment.x *= size.w / deck.w;
      comment.y *= size.h / deck.h;
    }
    refreshCommentPositions(slide);
  }
  Object.assign(deck, size);
}
