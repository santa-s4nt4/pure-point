import { hasTextFrame } from './model.js';
import { presetTextInset } from './shape-presets.js';
import { bulletList } from './bullets.js';
import {
  appendTextRun,
  decorateRun,
  isDecorated,
  japaneseSubstitute,
  startsEastAsian,
} from './text-runs.js';
import {
  leadingOffset,
  lineAdvance,
  lineBox,
  paragraphMetrics,
} from './text.js';
import { vectorDrawing } from './vector-view.js';
import {
  createElement,
  MousePointer2,
  Slash,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Video,
  Link,
  PanelRight,
  PanelBottom,
  FolderPlus,
  MessageSquare,
  LayoutGrid,
  Type,
  Square,
  Circle,
  Copy,
  ClipboardPaste,
  Crop,
  FlipHorizontal2,
  ImagePlus,
  Undo2,
  Redo2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Play,
  Download,
  FolderOpen,
  FilePlus2,
  Grid2X2,
  Check,
  Eye,
  EyeOff,
  Layers2,
  StretchHorizontal,
  Scan,
  Minus,
  Maximize,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  MessageCircle,
  PanelLeft,
  SlidersHorizontal,
  Box,
  Image,
  Triangle,
  GripVertical,
  ArrowUpRight,
  Magnet,
  Columns3,
  Rows3,
  Palette,
  X,
  Save,
  FileType2,
  Presentation,
  Group,
  LockKeyhole,
  LockKeyholeOpen,
  Ungroup,
} from 'lucide';
import { videoNode } from './media-player.js';
import { setImageSource } from './media-format.js';
import { paintPicture } from './picture-effects.js';
import { tableNode } from './table.js';
import { gridLines } from './grid.js';
const icons = {
  copy: Copy,
  paste: ClipboardPaste,
  crop: Crop,
  flipHorizontal: FlipHorizontal2,
  pointer: MousePointer2,
  line: Slash,
  objectleft: AlignStartVertical,
  objecthcenter: AlignCenterVertical,
  objectright: AlignEndVertical,
  objecttop: AlignStartHorizontal,
  objectvcenter: AlignCenterHorizontal,
  objectbottom: AlignEndHorizontal,
  video: Video,
  embed: Link,
  panel: PanelRight,
  script: PanelBottom,
  section: FolderPlus,
  comment: MessageSquare,
  overview: LayoutGrid,
  text: Type,
  rect: Square,
  ellipse: Circle,
  image: ImagePlus,
  undo: Undo2,
  redo: Redo2,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  plus: Plus,
  play: Play,
  export: Download,
  open: FolderOpen,
  new: FilePlus2,
  grid: Grid2X2,
  check: Check,
  eye: Eye,
  hidden: EyeOff,
  layers: Layers2,
  rows: Rows3,
  fit: Scan,
  minus: Minus,
  maximize: Maximize,
  delete: Trash2,
  alignleft: AlignLeft,
  aligncenter: AlignCenter,
  alignright: AlignRight,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  callout: MessageCircle,
  sidebar: PanelLeft,
  settings: SlidersHorizontal,
  path: Box,
  picture: Image,
  triangle: Triangle,
  grip: GripVertical,
  arrow: ArrowUpRight,
  magnet: Magnet,
  columns: Columns3,
  color: Palette,
  close: X,
  save: Save,
  file: FileType2,
  slide: Presentation,
  group: Group,
  ungroup: Ungroup,
  lock: LockKeyhole,
  unlock: LockKeyholeOpen,
  unsupported: StretchHorizontal,
};
const iconCache = new Map();
export function icon(key, size = 16) {
  const cacheKey = key + size;
  if (!iconCache.has(cacheKey))
    iconCache.set(
      cacheKey,
      createElement(icons[key] || Square, {
        width: size,
        height: size,
        'stroke-width': 1.65,
        'aria-hidden': 'true',
      }).outerHTML
    );
  return iconCache.get(cacheKey);
}
export const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
export function fontCSS(font, fallback, substitute) {
  const families = [...new Set([font, substitute, fallback].filter(Boolean))];
  return [
    ...families.flatMap((f) => [`"pp-${CSS.escape(f)}"`, `"${CSS.escape(f)}"`]),
    'sans-serif',
  ].join(', ');
}
function typeStyle(n, o, substitute) {
  if (o.lang) n.lang = o.lang;
  Object.assign(n.style, {
    fontFamily: fontCSS(o.font, o.fallbackFont, substitute),
    fontSize: o.size + 'px',
    color: o.color,
    fontWeight: o.bold ? '700' : '400',
    fontStyle: o.italic ? 'italic' : 'normal',
    fontKerning: o.kern == null ? 'auto' : o.size >= o.kern ? 'normal' : 'none',
    letterSpacing: (o.letterSpacing || 0) + 'px',
  });
}
export function itemNode(o, assets, interactive = false, deferImages = false) {
  const n = el('div', 'item');
  if (interactive) n.dataset.id = o.id;
  if (o.kind === 'line') n.classList.add('is-line');
  const pathShape = o.kind === 'line' || o.kind === 'path';
  if (o.hidden) n.hidden = true;
  if (o.locked) n.classList.add('locked-layer');
  Object.assign(n.style, {
    left: o.x + 'px',
    top: o.y + 'px',
    width: (pathShape ? o.w || 1 : o.w) + 'px',
    height: (pathShape ? o.h || 1 : o.h) + 'px',
    // A flat SVG needs a nonzero viewport, but its flip/rotation center is
    // still the center of the original DrawingML frame.
    transformOrigin: pathShape ? `${o.w / 2}px ${o.h / 2}px` : 'center',
    transform: `rotate(${o.rotation}deg) scale(${o.flipH ? -1 : 1},${o.flipV ? -1 : 1})`,
  });
  if (o.kind === 'video') {
    n.append(videoNode(o, assets, Boolean(interactive), deferImages));
  } else if (o.kind === 'image') {
    const clip = el('div', 'image-clip'),
      img = el('img');
    img.draggable = false;
    setImageSource(img, assets[o.asset], deferImages, assets[o.fallbackAsset]);
    const [l, t, r, b] = o.crop || [0, 0, 0, 0],
      w = 1 / Math.max(0.001, 1 - l - r),
      h = 1 / Math.max(0.001, 1 - t - b);
    Object.assign(img.style, {
      width: w * 100 + '%',
      height: h * 100 + '%',
      left: -l * w * 100 + '%',
      top: -t * h * 100 + '%',
    });
    paintPicture(clip, img, o);
    clip.append(img);
    n.append(clip);
  } else if (o.kind === 'group') {
    const inner = el('div', 'group-content'),
      [x, y, w, h] = o.childBox;
    inner.style.transform = `scale(${o.w / w},${o.h / h}) translate(${-x}px,${-y}px)`;
    o.items.forEach((c) =>
      inner.append(itemNode(c, assets, interactive, deferImages))
    );
    n.append(inner);
  } else if (o.kind === 'table') {
    n.append(tableNode(o, typeStyle, el));
  } else if (o.kind === 'unsupported') {
    const ph = el('div', 'unsupported');
    ph.textContent = o.name;
    n.append(ph);
  } else if (o.kind !== 'text' || o.fill || o.stroke)
    n.append(vectorDrawing(o, interactive === true));
  if (hasTextFrame(o)) {
    const text = el('div', 'item-text');
    typeStyle(text, o, japaneseSubstitute(o));
    text.style.setProperty(
      '--line-offset',
      leadingOffset(o.lineHeight, o.size) + 'px'
    );
    text.style.setProperty(
      '--minimum-line',
      lineAdvance(o.lineHeight, o.size) + 'px'
    );
    const [l, t, r, b] = o.inset;
    const [dx, dy] = presetTextInset(o);
    Object.assign(text.style, {
      padding: `${t + dy}px ${r + dx}px ${b + dy}px ${l + dx}px`,
      justifyContent:
        { middle: 'center', bottom: 'flex-end' }[o.valign] || 'flex-start',
      textAlign: o.align,
      lineHeight: lineBox(o.lineHeight),
    });
    if (o.placeholder && !o.text && interactive !== true) return n;
    if (interactive === true && o.placeholder && !o.text) {
      n.classList.add('empty-placeholder');
      text.dataset.prompt = ['title', 'ctrTitle'].includes(o.placeholder.type)
        ? 'Title'
        : 'Content';
    }
    if (o.autoWidth || o.noWrap) text.classList.add('point-text');
    if (o.paragraphs) {
      for (const [index, p] of o.paragraphs.entries()) {
        const line = el(p.bullet ? 'li' : 'div');
        line.dataset.paragraph = index;
        const { strut, offset, minHeight } = paragraphMetrics(p);
        const style = strut || p.base;
        const eastAsian = startsEastAsian(strut?.text, style);
        const family = eastAsian
          ? style.eastAsianFont || style.font
          : style.font;
        typeStyle(
          line,
          {
            ...style,
            font: family,
            fallbackFont: eastAsian
              ? style.eastAsianFallback || style.fallbackFont
              : style.fallbackFont,
          },
          japaneseSubstitute(style, eastAsian)
        );
        line.style.setProperty('--line-offset', offset + 'px');
        // WebKit rounds each intrinsic text line down to a whole logical
        // pixel. Preserve the fractional paragraph advance across a slide.
        // A minimum leaves additional soft-wrapped lines free to expand.
        line.style.setProperty('--minimum-line', minHeight + 'px');
        const last = index === o.paragraphs.length - 1;
        const before = index === 0 && !o.spaceAtEdges ? 0 : p.before || 0;
        const after = last && !o.spaceAtEdges ? 0 : p.after || 0;
        Object.assign(line.style, {
          textAlign: p.align,
          marginTop: before + 'px',
          marginBottom: after - (last ? offset : 0) + 'px',
          paddingRight: (p.marginRight || 0) + 'px',
          ...(!p.bullet && {
            paddingLeft: (p.margin || 0) + 'px',
            textIndent: (p.indent || 0) + 'px',
          }),
          lineHeight: lineBox(p.lineHeight),
        });
        p.runs.forEach((run, i) =>
          appendTextRun(
            line,
            run,
            typeStyle,
            interactive === true ? i : undefined
          )
        );
        if (!line.childNodes.length) {
          const stop = el('br');
          if (
            interactive === true &&
            (p.base.highlight ||
              isDecorated(p.base, 'underline') ||
              isDecorated(p.base, 'strike'))
          ) {
            // Keep the paragraph mark's insertion style on an inline box.
            // An empty box has no background area until the first glyph arrives.
            const span = el('span');
            decorateRun(span, p.base);
            span.append(stop);
            line.append(span);
          } else line.append(stop);
        }
        if (p.bullet) {
          const list = bulletList(p, o.size);
          list.append(line);
          text.append(list);
        } else text.append(line);
      }
    } else {
      const body = el('div');
      decorateRun(text, o);
      body.textContent = o.text;
      body.style.minHeight =
        o.text.split('\n').length * lineAdvance(o.lineHeight, o.size) + 'px';
      text.append(body);
    }
    if (text.dataset.prompt) {
      const label =
        text.querySelector('[data-paragraph]') || text.firstElementChild;
      if (label) label.dataset.prompt = text.dataset.prompt;
    }
    n.append(text);
  }
  return n;
}
export function scene(
  slide,
  deck,
  assets,
  interactive = false,
  deferImages = false
) {
  const n = el('div', 'scene');
  Object.assign(n.style, {
    width: deck.w + 'px',
    height: deck.h + 'px',
    background: slide.bg,
  });
  for (const o of slide.back) n.append(itemNode(o, assets, false, deferImages));
  for (const o of slide.items)
    n.append(itemNode(o, assets, interactive, deferImages));
  return n;
}
export function gridOverlay(deck, g) {
  const svg = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    return node;
  };
  const grid = svg('svg', {
    class: 'grid-overlay',
    viewBox: `0 0 ${deck.w} ${deck.h}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const { x, y, xb, yb } = gridLines(deck.w, deck.h, g);
  for (const [x, width] of xb)
    grid.append(svg('rect', { x, width, height: deck.h }));
  for (const [y, height] of yb)
    grid.append(svg('rect', { y, height, width: deck.w }));
  const lines = [
    ...x.map((p) => `M${p} 0V${deck.h}`),
    ...y.map((p) => `M0 ${p}H${deck.w}`),
  ];
  grid.append(
    svg('path', { d: lines.join(' '), 'vector-effect': 'non-scaling-stroke' })
  );
  return grid;
}
