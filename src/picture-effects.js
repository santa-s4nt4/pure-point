import { attr, children, percent } from './xml.js';

// Only the immediate blip children are live drawing effects. The Office
// imgLayer extension describes adjustments already baked into the bitmap.
export function readPictureEffects(blip, object) {
  const effects = [];
  for (const node of children(blip)) {
    if (node.localName === 'alphaModFix') {
      const alpha = percent(attr(node, 'amt', '100000'));
      if (Number.isFinite(alpha) && alpha >= 0 && alpha !== 1)
        effects.push({ alpha });
    } else if (node.localName === 'lum') {
      const bright = percent(attr(node, 'bright', '0'));
      const contrast = percent(attr(node, 'contrast', '0'));
      if (
        Number.isFinite(bright) && Number.isFinite(contrast) &&
        (bright || contrast)
      )
        effects.push({ bright, contrast });
    }
  }
  if (effects.length) object.pictureEffects = effects;
}

export function pictureEffectsXML(o) {
  const units = (value) => Math.round(value * 100000);
  return (o.pictureEffects || [])
    .map((effect) => effect.alpha != null
      ? `<a:alphaModFix amt="${units(effect.alpha)}"/>`
      : `<a:lum bright="${units(effect.bright)}" contrast="${units(effect.contrast)}"/>`)
    .join('');
}

export function paintPicture(clip, img, o) {
  if (o.fill) clip.style.backgroundColor = o.fill;
  const effects = o.pictureEffects;
  if (!effects?.length) return;
  if (effects.every((e) => e.alpha != null && e.alpha <= 1)) {
    img.style.opacity = effects.reduce((opacity, e) => opacity * e.alpha, 1);
    return;
  }
  const svg = (tag) =>
    document.createElementNS('http://www.w3.org/2000/svg', tag);
  const defs = svg('svg'),
    filter = svg('filter');
  filter.id = 'picture-effect-' + crypto.randomUUID();
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  for (const effect of effects) {
    let scale = 1,
      offset = 0;
    if (effect.alpha == null) {
      // Office changes brightness halfway before and halfway after contrast.
      // The contrast pivot is 128 in 8-bit sRGB (MS Office mode in Bitmap::Adjust).
      const c = Math.max(-1, Math.min(1, effect.contrast)) * 127 / 128;
      scale = c >= 0 ? 1 / (1 - c) : 1 + c;
      offset = (1 - scale) * 128 / 255 + (1 + scale) * effect.bright / 2;
    }
    const matrix = svg('feColorMatrix');
    matrix.setAttribute('values', [
      scale, 0, 0, 0, offset,
      0, scale, 0, 0, offset,
      0, 0, scale, 0, offset,
      0, 0, 0, effect.alpha ?? 1, 0,
    ].join(' '));
    filter.append(matrix);
  }
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.append(filter);
  clip.prepend(defs);
  img.style.filter = 'url(#' + filter.id + ')';
}
