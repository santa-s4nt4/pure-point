import { lineBox } from './text.js';
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
  FolderPlus,
  MessageSquare,
  LayoutGrid,
  Type,
  Square,
  Circle,
  Copy,
  ClipboardPaste,
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
import { tableNode } from './table.js';
import { gridLines } from './grid.js';
const icons = {
  copy: Copy,
  paste: ClipboardPaste,
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
export const fontCSS = (font) =>
  `"pp-${CSS.escape(font)}", "${CSS.escape(font)}", sans-serif`;
function typeStyle(n, o) {
  Object.assign(n.style, {
    fontFamily: fontCSS(o.font),
    fontSize: o.size + 'px',
    color: o.color,
    fontWeight: o.bold ? '700' : '400',
    fontStyle: o.italic ? 'italic' : 'normal',
    letterSpacing: (o.letterSpacing || 0) + 'px',
  });
}
export function itemNode(o, assets, interactive = false) {
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
    transform: `rotate(${o.rotation}deg) scale(${o.flipH ? -1 : 1},${o.flipV ? -1 : 1})`,
  });
  if (o.kind === 'video') {
    n.append(videoNode(o, assets, Boolean(interactive)));
  } else if (o.kind === 'image') {
    const clip = el('div', 'image-clip'),
      img = el('img');
    img.draggable = false;
    img.src = assets[o.asset] || '';
    const [l, t, r, b] = o.crop || [0, 0, 0, 0],
      w = 1 / Math.max(0.001, 1 - l - r),
      h = 1 / Math.max(0.001, 1 - t - b);
    Object.assign(img.style, {
      width: w * 100 + '%',
      height: h * 100 + '%',
      left: -l * w * 100 + '%',
      top: -t * h * 100 + '%',
    });
    clip.append(img);
    n.append(clip);
  } else if (o.kind === 'group') {
    const inner = el('div', 'group-content'),
      [x, y, w, h] = o.childBox;
    inner.style.transform = `scale(${o.w / w},${o.h / h}) translate(${-x}px,${-y}px)`;
    o.items.forEach((c) => inner.append(itemNode(c, assets, interactive)));
    n.append(inner);
  } else if (o.kind === 'table') {
    n.append(tableNode(o, typeStyle, el));
  } else if (o.kind === 'unsupported') {
    const ph = el('div', 'unsupported');
    ph.textContent = o.name;
    n.append(ph);
  } else if (o.kind !== 'text' || o.fill || o.stroke)
    n.append(vectorDrawing(o, interactive === true));
  if (o.text || o.kind === 'text') {
    const text = el('div', 'item-text');
    typeStyle(text, o);
    const [l, t, r, b] = o.inset;
    Object.assign(text.style, {
      padding: `${t}px ${r}px ${b}px ${l}px`,
      justifyContent:
        { middle: 'center', bottom: 'flex-end' }[o.valign] || 'flex-start',
      textAlign: o.align,
      lineHeight: lineBox(o.lineHeight),
    });
    if (interactive === true && o.placeholder && !o.text) {
      n.classList.add('empty-placeholder');
      text.dataset.prompt = ['title', 'ctrTitle'].includes(o.placeholder.type)
        ? 'Title'
        : 'Content';
    }
    if (o.autoWidth) text.classList.add('point-text');
    if (o.paragraphs) {
      for (const p of o.paragraphs) {
        const line = el('div');
        typeStyle(line, p.base);
        Object.assign(line.style, {
          textAlign: p.align,
          marginTop: (p.before || 0) + 'px',
          marginBottom: (p.after || 0) + 'px',
          paddingLeft: (p.margin || 0) + 'px',
          textIndent: (p.indent || 0) + 'px',
          lineHeight: lineBox(p.lineHeight),
        });
        if (p.bullet) line.dataset.bullet = p.bullet;
        for (const run of p.runs) {
          const chunks =
            run.eastAsianFont && run.eastAsianFont !== run.font
              ? run.text.split(
                  /([\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff01-\uffef]+)/u
                )
              : [run.text];
          chunks.forEach((t, i) => {
            if (!t) return;
            const span = el('span');
            span.textContent = t;
            typeStyle(span, i % 2 ? { ...run, font: run.eastAsianFont } : run);
            line.append(span);
          });
        }
        if (!line.childNodes.length) line.append(el('br'));
        text.append(line);
      }
    } else {
      const body = el('div');
      body.textContent = o.text;
      text.append(body);
    }
    n.append(text);
  }
  return n;
}
export function scene(slide, deck, assets, interactive = false) {
  const n = el('div', 'scene');
  Object.assign(n.style, {
    width: deck.w + 'px',
    height: deck.h + 'px',
    background: slide.bg,
  });
  for (const o of slide.back) n.append(itemNode(o, assets));
  for (const o of slide.items) n.append(itemNode(o, assets, interactive));
  return n;
}
export function gridOverlay(deck, g) {
  const grid = el('div', 'grid-overlay');
  const { x, y, xb, yb } = gridLines(deck.w, deck.h, g);
  for (const [pos, size] of xb) {
    const n = el('div', 'band vertical');
    Object.assign(n.style, { left: pos + 'px', width: size + 'px' });
    grid.append(n);
  }
  for (const [pos, size] of yb) {
    const n = el('div', 'band horizontal');
    Object.assign(n.style, { top: pos + 'px', height: size + 'px' });
    grid.append(n);
  }
  for (const [values, vertical] of [
    [x, true],
    [y, false],
  ])
    for (const p of values) {
      const n = el('i', vertical ? 'v' : 'h');
      n.style[vertical ? 'left' : 'top'] = p + 'px';
      grid.append(n);
    }
  return grid;
}
