import './style.css';
import { createMediaEditor } from './media-editor.js';
import './workspace.css';
import {
  workspace,
  animateLogo,
  bindRailResize,
  bindPinch,
  zoomStops,
} from './workspace.js';
import { slideBrowser, addSection, moveIntoSection } from './slide-browser.js';
import { renderComments } from './comments.js';
import { openTemplate, exportPDF } from './document.js';
import './layers.css';
import {
  layerEntries,
  shapeTransform,
  layerBounds,
  selectionBounds,
  independentEntries,
  localDelta,
  makeGroup,
  ungroup,
} from './layers.js';
import { layerPanel, toggleExpanded } from './layer-panel.js';
import { updateText } from './text.js';
import { blankDeck, shape, slide, textItem, uid, blue } from './model.js';
import { importDeck } from './import.js';
import { exportDeck } from './export.js';
import { defaults, snapAxis, snapTargets } from './grid.js';
import { el, fontCSS, gridOverlay, icon, itemNode, scene } from './view.js';
import { esc } from './xml.js';
import * as platform from './platform.js';

const $ = (s) => document.querySelector(s);
const action = (id, label, glyph, cls = 'icon-btn', content = false) =>
  `<button type="button" class="${cls}" data-action="${id}" aria-label="${esc(label)}" title="${esc(label)}">${icon(glyph)}${content ? esc(label) : ''}</button>`;
const fileTitle = () => (path ? platform.fileName(path) : title);
const active = () => deck.slides[index],
  selected = () =>
    selection ? layerEntries(active().items).get(selection)?.object : undefined;
let deck = blankDeck(),
  index = 0,
  selection = null,
  additionalSelection = [],
  base = null,
  assets = {},
  title = 'untitled',
  path = null;
let tool = 'pointer',
  tab = 'design',
  zoom = 'fit',
  scale = 1,
  fonts = [],
  grid = { ...defaults },
  busy = false,
  present = false,
  editor = null;
let history = [],
  future = [],
  currentRevision = 0,
  savedRevision = 0,
  serial = 0,
  lastDirty = false,
  drag = null;
try {
  Object.assign(
    grid,
    JSON.parse(localStorage.getItem('pure-point.grid') || '{}')
  );
} catch {}
const root = $('#app');
document.body.classList.toggle('native', platform.native);
root.innerHTML = workspace(action);
const designUnit = 2;
const commentDrafts = new Map();
let overview = false,
  inspectorOpen = localStorage.getItem('pure-point.inspector') !== 'closed';
let tileWidth = 216,
  pickedSlides = new Set(),
  slideAnchor = 0,
  pinPosition = null,
  pinning = false,
  focusComment = null;
const railSlides = slideBrowser($('.thumbs')),
  overviewSlides = slideBrowser($('.sorter'), { sorter: true });
animateLogo($('#floating-p'));
bindRailResize($('.rail-resizer'));
function slideIds() {
  return pickedSlides.size && pickedSlides.has(active().id)
    ? pickedSlides
    : new Set([active().id]);
}
function dimension(key) {
  return ['x', 'y', 'w', 'h', 'step', 'gutter', 'margin'].includes(key)
    ? designUnit
    : 1;
}
function updateChrome() {
  root.classList.toggle('overview-mode', overview);
  root.classList.toggle('inspector-closed', !inspectorOpen || overview);
  $('.sorter').hidden = !overview;
  for (const b of document.querySelectorAll('[data-action="overview"]'))
    b.setAttribute('aria-pressed', overview);
  $('[data-action="canvasView"]').setAttribute('aria-pressed', !overview);
  $('[data-action="inspector"]').setAttribute(
    'aria-pressed',
    inspectorOpen && !overview
  );
}
function commentPins() {
  const sc = $('.artboard>.scene');
  sc?.querySelectorAll('.comment-pin').forEach((n) => n.remove());
  if (!sc || tab !== 'comments' || !inspectorOpen || overview) return;
  (active().comments || []).forEach((c, i) => {
    const b = el(
      'button',
      'comment-pin' + (focusComment === c.id ? ' focused' : '')
    );
    b.dataset.pin = c.id;
    b.textContent = i + 1;
    b.title = c.author + ' · ' + c.text;
    b.style.left = c.x + 'px';
    b.style.top = c.y + 'px';
    sc.append(b);
  });
  if (pinPosition) {
    const marker = el('i', 'pending-pin');
    marker.style.left = pinPosition.x + 'px';
    marker.style.top = pinPosition.y + 'px';
    sc.append(marker);
  }
}
let toastTimer;
function toast(message) {
  let n = $('.toast');
  if (!n) {
    n = el('div', 'toast');
    n.setAttribute('role', 'status');
    document.body.append(n);
  }
  n.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.remove(), 2600);
}
function dialog(title, message, options) {
  return new Promise((resolve) => {
    const d = el('dialog', 'modal');
    d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(message)}</p><div class="buttons">${options.map(([key, label], i) => `<button class="top-action ${i === options.length - 1 ? 'primary' : ''}" value="${key}">${esc(label)}</button>`).join('')}</div>`;
    document.body.append(d);
    d.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) d.close(b.value);
    };
    d.onclose = () => {
      const v = d.returnValue;
      d.remove();
      resolve(v);
    };
    d.showModal();
  });
}
const fail = (error) =>
  dialog('Unable to complete the operation', error?.message || String(error), [
    ['ok', 'Close'],
  ]);
function snapshot() {
  return {
    deck: JSON.stringify(deck),
    index,
    selection,
    additionalSelection: [...additionalSelection],
    rev: currentRevision,
  };
}
function record(before) {
  history.push(before);
  while (
    history.length > 50 ||
    (history.length > 1 &&
      history.reduce((s, h) => s + h.deck.length, 0) > 16_000_000)
  )
    history.shift();
  future = [];
  currentRevision = ++serial;
  status();
}
function change(fn) {
  const before = snapshot();
  fn();
  record(before);
  render();
}
function restore(from, to) {
  const snap = from.pop();
  if (!snap) return;
  to.push(snapshot());
  deck = JSON.parse(snap.deck);
  index = snap.index;
  setSelection(
    [...(snap.additionalSelection || []), snap.selection].filter(Boolean)
  );
  currentRevision = snap.rev;
  render();
}
function status() {
  const dirty =
    currentRevision !== savedRevision ||
    Boolean(editor && editor.input.value !== editor.o.text);
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    platform.dirtyFlag(dirty);
  }
  $('.doc-name').textContent = fileTitle() + '.pptx';
  $('.doc-name').title = $('.doc-name').textContent;
  $('#status').textContent = busy
    ? 'Working…'
    : dirty
      ? 'Unsaved changes'
      : path
        ? 'Saved'
        : 'Not saved yet';
  $('#slide-counter').textContent = overview
    ? deck.slides.length + ' slides'
    : `Slide ${index + 1} / ${deck.slides.length}`;
  document
    .querySelectorAll('[data-action="undo"]')
    .forEach((b) => (b.disabled = !history.length));
  document
    .querySelectorAll('[data-action="redo"]')
    .forEach((b) => (b.disabled = !future.length));
  platform.setTitle(fileTitle() + (dirty ? ' •' : '') + ' — pure-point');
}
function renderThumbs() {
  $('.head-count').textContent = deck.slides.length;
  railSlides.render(deck, assets, index, slideIds());
  if (overview) overviewSlides.render(deck, assets, index, slideIds());
}
function setOverview(on) {
  finishText();
  overview = on;
  pinning = false;
  pinPosition = null;
  tool = 'pointer';
  select(null);
  updateChrome();
  if (on) {
    overviewSlides.render(deck, assets, index, slideIds());
    $('.sorter [data-slide="' + index + '"]')?.scrollIntoView({
      block: 'nearest',
    });
  } else {
    overviewSlides.clear();
    railSlides.reveal(active());
    renderThumbs();
    renderBoard();
  }
  updateZoomLabel();
  status();
}
function updateZoomLabel() {
  const value = overview
    ? tileWidth / 216
    : zoom === 'fit'
      ? 'fit'
      : Number(zoom);
  const input = $('#zoom'),
    custom = input.querySelector('[value="custom"]');
  const exact = value === 'fit' || zoomStops.includes(value);
  custom.textContent =
    typeof value === 'number' ? Math.round(value * 100) + '%' : '';
  input.value = exact ? value : 'custom';
  input.querySelector('[value="fit"]').textContent =
    'Fit' +
    (overview ? '' : ' · ' + Math.round((scale / designUnit) * 100) + '%');
}
function zoomAt(factor, clientX, clientY) {
  if (present || !Number.isFinite(factor) || factor <= 0) return;
  if (overview) {
    const host = $('.sorter'),
      r = host.getBoundingClientRect();
    const x = clientX ?? r.left + r.width / 2,
      y = clientY ?? r.top + r.height / 2;
    const card = document
      .elementFromPoint(x, y)
      ?.closest('.sorter .select-slide');
    const before = card?.getBoundingClientRect(),
      offset = before ? (y - before.top) / before.height : 0;
    tileWidth = Math.max(76, Math.min(1100, tileWidth * factor));
    host.style.setProperty('--tile-width', tileWidth + 'px');
    if (card) {
      const after = card.getBoundingClientRect();
      host.scrollTop += after.top + offset * after.height - y;
    }
    updateZoomLabel();
    return;
  }
  const vp = $('.viewport'),
    r = vp.getBoundingClientRect(),
    old = $('.artboard').getBoundingClientRect();
  const x = clientX ?? r.left + r.width / 2,
    y = clientY ?? r.top + r.height / 2;
  const px = (x - old.left) / scale,
    py = (y - old.top) / scale;
  zoom = Math.max(0.025, Math.min(16, (scale * factor) / designUnit));
  sizing();
  const next = $('.artboard').getBoundingClientRect();
  vp.scrollLeft += next.left + px * scale - x;
  vp.scrollTop += next.top + py * scale - y;
  drawRulers();
}
function chooseZoom(value) {
  if (value === 'fit') {
    if (overview) {
      tileWidth = 216;
      $('.sorter').style.setProperty('--tile-width', '216px');
    } else {
      zoom = 'fit';
      sizing();
    }
    updateZoomLabel();
    return;
  }
  const current = overview ? tileWidth / 216 : scale / designUnit;
  zoomAt(Number(value) / current);
}
function zoomStep(up) {
  const z = overview ? tileWidth / 216 : scale / designUnit;
  const levels = overview
    ? [0.36, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]
    : zoomStops;
  chooseZoom(
    up
      ? (levels.find((v) => v > z + 0.001) ?? levels.at(-1))
      : (levels
          .slice()
          .reverse()
          .find((v) => v < z - 0.001) ?? levels[0])
  );
}
function drawRulers() {
  const stage = $('.stage').getBoundingClientRect(),
    art = $('.artboard').getBoundingClientRect();
  for (const horizontal of [true, false]) {
    const cv = $(horizontal ? '.ruler-top' : '.ruler-left'),
      len = (horizontal ? stage.width : stage.height) - 22;
    const w = horizontal ? len : 22,
      h = horizontal ? 22 : len,
      dpr = devicePixelRatio;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.strokeStyle = '#aeb0b7';
    c.fillStyle = '#80848c';
    c.font = '8px Menlo, monospace';
    const origin = horizontal
      ? art.left - stage.left - 22
      : art.top - stage.top - 22;
    const step =
        scale > 4
          ? 5
          : scale > 1.5
            ? 25
            : scale > 0.65
              ? 50
              : scale > 0.34
                ? 100
                : 200,
      interval = (step * scale) / 5;
    for (
      let i = Math.floor(-origin / interval);
      i <= (len - origin) / interval;
      i++
    ) {
      const v = origin + i * interval,
        major = i % 5 === 0;
      c.beginPath();
      if (horizontal) {
        c.moveTo(v + 0.5, 22);
        c.lineTo(v + 0.5, major ? 15 : 19);
        if (major)
          c.fillText(
            String(Math.round((i * step * designUnit) / 5)),
            v + 3,
            10
          );
      } else {
        c.moveTo(22, v + 0.5);
        c.lineTo(major ? 15 : 19, v + 0.5);
        if (major) {
          c.save();
          c.translate(10, v - 3);
          c.rotate(-Math.PI / 2);
          c.fillText(String(Math.round((i * step * designUnit) / 5)), 0, 0);
          c.restore();
        }
      }
      c.stroke();
    }
  }
}
function sizing() {
  const vp = $('.viewport'),
    world = $('.world'),
    css = getComputedStyle(world);
  const availableW =
      vp.clientWidth -
      parseFloat(css.paddingLeft) -
      parseFloat(css.paddingRight),
    availableH =
      vp.clientHeight -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
  scale =
    zoom === 'fit'
      ? Math.max(0.01, Math.min(availableW / deck.w, availableH / deck.h))
      : Number(zoom) * designUnit;
  const w = deck.w * scale,
    h = deck.h * scale;
  Object.assign($('.artboard').style, { width: w + 'px', height: h + 'px' });
  world.style.width =
    Math.max(
      vp.clientWidth,
      w + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight)
    ) + 'px';
  world.style.height =
    Math.max(
      vp.clientHeight,
      h + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)
    ) + 'px';
  const sc = $('.artboard .scene');
  if (sc) {
    sc.style.transform = `scale(${scale})`;
    sc.style.setProperty('--hair', 1 / scale + 'px');
  }
  updateZoomLabel();
  $('.page-label').textContent = 'Slide ' + (index + 1);
  drawRulers();
}
function setSelection(ids) {
  const unique = [...new Set(ids)];
  selection = unique.pop() || null;
  additionalSelection = unique;
}
function selectedIds() {
  return selection ? [...additionalSelection, selection] : [];
}
function selectedEntries(entries = layerEntries(active().items)) {
  return independentEntries(
    selectedIds()
      .map((id) => entries.get(id))
      .filter(Boolean)
  );
}
function canGroup(entries) {
  return entries.length > 1 && entries.every((e) => !e.locked);
}
function drawSelection() {
  const sc = $('.artboard>.scene');
  if (!sc) return;
  sc.querySelector('.selection')?.remove();
  const entries = selectedEntries().filter((e) => !e.hidden && !e.locked);
  if (!entries.length) return;
  const layer = el('div', 'selection');
  const frame = (entry) => {
    const box = el(
      'div',
      entries.length === 1 ? 'select-box' : 'selection-outline'
    );
    const o = entry.object;
    Object.assign(box.style, {
      width: o.w + 'px',
      height: o.h + 'px',
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      transform: entry.transform.multiply(shapeTransform(o)).toString(),
    });
    return box;
  };
  for (const entry of entries) layer.append(frame(entry));
  if (entries.length === 1) {
    const box = layer.firstElementChild;
    for (const [name, x, y] of [
      ['nw', 0, 0],
      ['ne', 100, 0],
      ['sw', 0, 100],
      ['se', 100, 100],
    ]) {
      const h = el('i', 'handle');
      h.dataset.handle = name;
      Object.assign(h.style, {
        left: x + '%',
        top: y + '%',
        cursor: ['nw', 'se'].includes(name) ? 'nwse-resize' : 'nesw-resize',
      });
      box.append(h);
    }
  } else {
    const b = selectionBounds(entries),
      box = el('div', 'select-box selection-union');
    Object.assign(box.style, {
      left: b.x + 'px',
      top: b.y + 'px',
      width: b.w + 'px',
      height: b.h + 'px',
    });
    layer.append(box);
  }
  sc.append(layer);
}
function renderBoard() {
  const sc = scene(active(), deck, assets, true);
  if (grid.visible) sc.append(gridOverlay(deck, grid));
  $('.artboard').replaceChildren(sc);
  $('.stage').classList.toggle('tool-mode', tool !== 'pointer');
  drawSelection();
  commentPins();
  sizing();
  for (const b of document.querySelectorAll('.tool'))
    b.classList.toggle(
      'active',
      b.dataset.action === 'tool-' + tool ||
        (b.dataset.action === 'gridVisible' && grid.visible)
    );
}
function select(id, additive = false) {
  const ids = selectedIds();
  setSelection(
    !id
      ? []
      : !additive
        ? [id]
        : ids.includes(id)
          ? ids.filter((key) => key !== id)
          : [...ids, id]
  );
  drawSelection();
  properties();
}
function layerAction(action, id) {
  const all = layerEntries(active().items),
    entries = selectedEntries(all);
  if (action === 'group') {
    if (!canGroup(entries)) return;
    change(() => setSelection([makeGroup(entries).id]));
    return;
  }
  if (action === 'ungroup') {
    const groups = entries.filter(
      (e) => e.object.kind === 'group' && !e.locked
    );
    if (groups.length)
      change(() =>
        setSelection(groups.flatMap((entry) => ungroup(entry).map((o) => o.id)))
      );
    return;
  }
  if (action === 'delete') {
    const editable = entries.filter((e) => !e.locked);
    if (editable.length)
      change(() => {
        for (const e of editable)
          e.siblings.splice(e.siblings.indexOf(e.object), 1);
        setSelection([]);
      });
    return;
  }
  const targets = (id ? [all.get(id)].filter(Boolean) : entries).filter((e) =>
    action === 'locked' ? !e.parent?.locked : !e.parent?.hidden
  );
  if (targets.length) {
    const value = !targets.every((e) => e.object[action]);
    change(() => {
      for (const entry of targets) entry.object[action] = value;
    });
  }
}
const field = (label, key, value, min, max, scope = 'object') =>
  `<label class="field">${label}<input aria-label="${label}" type="number" step="any" data-scope="${scope}" data-field="${key}" value="${Number((Number(value) * dimension(key)).toFixed(2))}" min="${min * dimension(key)}" max="${max * dimension(key)}"></label>`;
const swatch = (label, col, key) =>
  `<div class="property"><span>${label}</span><label class="swatch"><i style="background:${col || 'transparent'}"></i>${col ? esc(col.slice(1).toUpperCase()) : 'None'}<input type="color" aria-label="${label}" data-color="${key}" value="${col || '#ffffff'}"></label></div>`;
const toggle = (id, on, label) =>
  `<button class="toggle ${on ? 'on' : ''}" data-action="${id}" role="switch" aria-checked="${on}" aria-label="${label}" title="${label}"><i></i></button>`;
const section = (label, body, control = '') =>
  `<section class="section"><div class="section-heading"><h3>${label}</h3>${control}</div>${body}</section>`;
const types = {
  columns: 'Columns',
  rows: 'Rows',
  square: 'Square',
  thirds: 'Thirds',
};
function gridPanel() {
  const cards = Object.entries(types)
    .map(
      ([key, label]) =>
        `<button class="preset ${key === grid.type ? 'active' : ''}" data-preset="${key}" aria-pressed="${key === grid.type}"><span class="grid-sample ${key}"></span><span>${label}</span></button>`
    )
    .join('');
  const f = (label, k, min, max) => field(label, k, grid[k], min, max, 'grid');
  let inputs =
    grid.type === 'square'
      ? f('Spacing (px)', 'step', 2, 360)
      : grid.type === 'thirds'
        ? ''
        : f(grid.type === 'rows' ? 'Rows' : 'Columns', grid.type, 1, 64) +
          f('Gutter (px)', 'gutter', 0, 360) +
          f('Margin (px)', 'margin', 0, 360);
  return (
    section(
      'Layout grid',
      `<div class="presets">${cards}</div><div class="form-grid">${inputs}</div>`,
      toggle('gridVisible', grid.visible, 'Show layout grid')
    ) +
    section(
      'Alignment',
      `<div class="property"><span class="switch-label">${icon('magnet', 14)}Snap to guides</span>${toggle('snap', grid.snap, 'Snap to guides')}</div>`
    )
  );
}
function properties() {
  const o = selected(),
    container = $('#properties');
  document
    .querySelectorAll('.tab')
    .forEach((b) => b.classList.toggle('active', tab === b.dataset.action));
  const layers = selectedEntries();
  if (tab === 'comments') {
    renderComments(container, active(), {
      pinning,
      draft: commentDrafts.get(active().id) || '',
      onDraft: (value) => commentDrafts.set(active().id, value),
      setPinMode() {
        pinning = !pinning;
        properties();
        if (pinning) toast('Click the slide to place your comment.');
      },
      add(c) {
        commentDrafts.delete(active().id);
        change(() => {
          (active().comments ??= []).push({
            ...c,
            ...(pinPosition || { x: deck.w * 0.5, y: deck.h * 0.5 }),
          });
          pinPosition = null;
          pinning = false;
        });
      },
      remove(c) {
        change(() => {
          active().comments = active().comments.filter((x) => x.id !== c.id);
        });
      },
      focusPin(c) {
        focusComment = c.id;
        commentPins();
        $('.artboard .comment-pin.focused')?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        });
      },
    });
    return;
  }
  if (tab === 'layers') {
    container.innerHTML = layerPanel(
      active().items,
      new Set(selectedIds()),
      canGroup(layers),
      layers.some((e) => e.object.kind === 'group' && !e.locked)
    );
    return;
  }
  if (tab === 'design' && (layers.length > 1 || layers[0]?.locked)) {
    const locked = layers.length === 1;
    const options = locked
      ? '<button data-action="toggleLayerLock">Unlock</button>'
      : canGroup(layers)
        ? '<button data-action="group">Group selection</button>'
        : '';
    container.innerHTML =
      section(
        locked ? 'Locked layer' : layers.length + ' layers selected',
        '<div class="layer-set">' + options + '</div>'
      ) + gridPanel();
    return;
  }
  if (!o) {
    const ratio =
      Math.abs(deck.w / deck.h - 16 / 9) < 0.01
        ? '16:9'
        : Math.abs(deck.w / deck.h - 4 / 3) < 0.01
          ? '4:3'
          : '';
    container.innerHTML =
      section(
        'Slide',
        `<div class="property"><span>Size ${ratio ? '(' + ratio + ')' : ''}</span><strong>${Math.round(deck.w * designUnit)} × ${Math.round(deck.h * designUnit)} px</strong></div>${swatch('Background', active().bg, 'bg')}`
      ) + gridPanel();
  } else {
    const fields =
      field('X (px)', 'x', o.x, -100000, 100000) +
      field('Y (px)', 'y', o.y, -100000, 100000) +
      field('Width (px)', 'w', o.w, 0.1, 100000) +
      field('Height (px)', 'h', o.h, 0.1, 100000);
    let html = section(
      'Position',
      `<div class="form-grid">${fields}</div>`,
      action('delete', 'Delete object', 'delete')
    );
    if (o.kind === 'text' || o.text) {
      const families = [...new Set(fonts.map((f) => f.family))],
        face = fonts.find((f) => f.full === o.font || f.postscript === o.font),
        family = families.includes(o.font) ? o.font : face?.family || o.font;
      if (!families.includes(family)) families.unshift(family);
      const members = fonts.filter((f) => f.family === family),
        style =
          face?.family === family
            ? face.style
            : (
                members.find((f) =>
                  /^(regular|roman|normal|book|W3)$/i.test(f.style)
                ) || members[0]
              )?.style || 'Regular';
      html += section(
        'Text',
        `<div class="form-grid"><label class="field wide">Font family<select data-font="family" aria-label="Font family">${families.map((f) => `<option${f === family ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label><label class="field">Style<select data-font="face" aria-label="Style">${members.map((f) => `<option value="${esc(f.full)}"${f.style === style ? ' selected' : ''}>${esc(f.style)}</option>`).join('')}</select></label>${field('Size (pt)', 'size', o.size, 1, 4000)}</div><div class="segmented">${['bold', 'italic', 'alignleft', 'aligncenter', 'alignright'].map((k, i) => action(k, ['Bold', 'Italic', 'Align left', 'Align center', 'Align right'][i], k, 'icon-btn ' + (o[k] || 'align' + o.align === k ? 'on' : ''))).join('')}</div>${swatch('Text color', o.color, 'color')}`
      );
    }
    if (
      ['rect', 'ellipse', 'triangle', 'roundRect', 'path', 'text'].includes(
        o.kind
      )
    )
      html += section('Appearance', swatch('Fill', o.fill, 'fill'));
    if (o.kind === 'unsupported')
      html += section(
        'PowerPoint object',
        '<p class="hint">Simplified preview. The original object is preserved in PowerPoint.</p>'
      );
    container.innerHTML = html + gridPanel();
  }
}
function render() {
  updateChrome();
  renderThumbs();
  renderBoard();
  properties();
  status();
  loadFonts();
}
function loadFonts() {
  const names = new Map();
  function collect(o) {
    names.set(JSON.stringify([o.font, o.bold, o.italic]), o);
  }
  function visit(o) {
    if (o.text) {
      collect(o);
      for (const p of o.paragraphs || [])
        for (const r of p.runs) {
          collect(r);
          if (r.eastAsianFont) collect({ ...r, font: r.eastAsianFont });
        }
    }
    o.items?.forEach(visit);
  }
  for (const s of deck.slides) {
    s.items.forEach(visit);
    s.back.forEach(visit);
  }
  for (const f of names.values())
    platform.loadTypeface(f.font, fonts, f.bold, f.italic);
}
function setTool(value) {
  tool = value;
  renderBoard();
}
function updateGrid(key, value) {
  grid[key] = value;
  localStorage.setItem('pure-point.grid', JSON.stringify(grid));
  renderBoard();
  properties();
}
function updateObject(key, value) {
  const o = selected();
  if (!o || selectedEntries().some((e) => e.locked) || o[key] === value) return;
  change(() => {
    o[key] = value;
    if (o.paragraphs) {
      for (const p of o.paragraphs) {
        if (key === 'align') p.align = value;
        if (['font', 'size', 'color', 'bold', 'italic'].includes(key)) {
          p.base[key] = value;
          if (key === 'font') p.base.eastAsianFont = value;
          p.runs.forEach((r) => {
            r[key] = value;
            if (key === 'font') r.eastAsianFont = value;
          });
        }
      }
    }
  });
}
function switchSlide(i) {
  if (i < 0 || i >= deck.slides.length) return;
  finishText();
  index = i;
  pickedSlides.clear();
  slideAnchor = i;
  pinPosition = null;
  pinning = false;
  focusComment = null;
  railSlides.reveal(active());
  setSelection([]);
  tool = 'pointer';
  render();
  $('.select-slide.active')?.scrollIntoView({ block: 'nearest' });
  if (overview)
    $('.sorter [data-slide="' + i + '"]')?.scrollIntoView({ block: 'nearest' });
  if (present) drawPresentation();
}
function addObject(o) {
  change(() => {
    active().items.push(o);
    setSelection([o.id]);
    tab = 'design';
    tool = 'pointer';
  });
}
const mediaEditor = createMediaEditor({
  getDeck: () => deck,
  getSlide: active,
  getAssets: () => assets,
  addObject,
  change,
  fail,
  isBusy: () => busy,
});
mediaEditor.bind($('.stage'));
function insertText(point) {
  finishText();
  const w = Math.min(260, deck.w),
    h = Math.min(54, deck.h);
  const creation = { before: snapshot(), selected: selectedIds() };
  const o = textItem(
    '',
    Math.max(0, Math.min(point.x, deck.w - w)),
    Math.max(0, Math.min(point.y, deck.h - h)),
    w,
    h,
    28
  );
  active().items.push(o);
  setSelection([o.id]);
  tab = 'design';
  tool = 'pointer';
  render();
  startText();
  editor.creation = creation;
}
function startText(allowEmptyShape = false) {
  const o = selected();
  const entry = selectedEntries()[0];
  if (
    !o ||
    entry?.hidden ||
    entry?.locked ||
    !(allowEmptyShape || o.kind === 'text' || o.text) ||
    editor
  )
    return;
  const sc = $('.artboard>.scene'),
    input = el('textarea', 'text-edit');
  const [l, t, r, b] = o.inset;
  Object.assign(input.style, {
    left: o.x + 'px',
    top: o.y + 'px',
    width: o.w + 'px',
    height: Math.max(o.h, o.size * 1.5) + 'px',
    color: o.color,
    fontSize: o.size + 'px',
    fontFamily: fontCSS(o.font),
    fontWeight: o.bold ? 'bold' : 'normal',
    fontStyle: o.italic ? 'italic' : 'normal',
    textAlign: o.align,
    padding: `${t}px ${r}px ${b}px ${l}px`,
    background: o.fill || active().bg,
    transform: `rotate(${o.rotation}deg)`,
  });
  if (entry?.parent)
    Object.assign(input.style, {
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      transform: entry.transform.multiply(shapeTransform(o)).toString(),
    });
  input.value = o.text;
  input.setAttribute('aria-label', 'Slide text');
  sc.append(input);
  editor = { input, o };
  input.oninput = status;
  input.onblur = () => finishText();
  input.onkeydown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      finishText(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      finishText();
    }
  };
  input.focus();
  input.select();
}
function finishText(cancel = false) {
  if (!editor) return;
  const { input, o, creation } = editor;
  editor = null;
  input.onblur = null;
  const value = input.value;
  input.remove();
  if (creation) {
    if (cancel || !value.trim()) {
      active().items = active().items.filter((item) => item !== o);
      setSelection(creation.selected);
    } else {
      updateText(o, value);
      o.name = value.slice(0, 40);
      record(creation.before);
    }
    render();
    return;
  }
  status();
  if (!cancel && o.text !== value)
    change(() => {
      updateText(o, value);
      if (o.kind === 'text') o.name = value.slice(0, 40) || 'Text';
    });
}
function menu(anchor, rows) {
  $('.menu')?.remove();
  const m = el('div', 'menu');
  m.setAttribute('role', 'menu');
  m.innerHTML = rows
    .map(
      ([k, label, glyph, key]) =>
        `<button data-action="${k}" role="menuitem">${icon(glyph, 15)}${label}<kbd>${key || ''}</kbd></button>`
    )
    .join('');
  document.body.append(m);
  const b = anchor.getBoundingClientRect();
  m.style.left = Math.min(b.left, innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(b.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.onkeydown = (e) => {
    const buttons = [...m.querySelectorAll('button:not(:disabled)')],
      i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      m.remove();
      anchor.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      buttons[
        (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    }
  };
  m.firstElementChild?.focus();
}
async function save(as) {
  finishText();
  const changes = exportDeck(deck, base, assets);
  const output = await platform.savePackage(
    base,
    as ? null : path,
    fileTitle(),
    changes
  );
  if (!output) return false;
  path = output;
  savedRevision = currentRevision;
  status();
  toast('Presentation saved.');
  return true;
}
async function allowReplace() {
  finishText();
  if (currentRevision === savedRevision) return true;
  const result = await dialog(
    'Save your changes?',
    fileTitle() + ' has unsaved changes.',
    [
      ['cancel', 'Cancel'],
      ['discard', 'Discard changes'],
      ['save', 'Save'],
    ]
  );
  return result === 'save' ? await save(false) : result === 'discard';
}
function reset(next, nextBase, nextTitle, nextPath) {
  const previous = base;
  const previousAssets = Object.values(assets);
  base = nextBase;
  overview = false;
  commentDrafts.clear();
  railSlides.clear();
  overviewSlides.clear();
  pickedSlides.clear();
  slideAnchor = 0;
  pinPosition = null;
  pinning = false;
  deck = next;
  assets = { ...base?.parts.media };
  title = nextTitle;
  path = nextPath;
  history = [];
  future = [];
  currentRevision = savedRevision = ++serial;
  setSelection([]);
  index = 0;
  tool = 'pointer';
  zoom = 'fit';
  tab = 'design';
  render();
  platform.release(previous, previousAssets);
}
async function newDocument() {
  const file = await openTemplate();
  if (!file) {
    reset(blankDeck(), null, 'untitled', null);
    return;
  }
  try {
    const imported = importDeck(file.parts);
    reset(
      imported.deck,
      { ...file, ...imported, deck: structuredClone(imported.deck) },
      'untitled',
      null
    );
  } catch (error) {
    await platform.release(file);
    throw error;
  }
}
function chooseSlide(i, event) {
  const id = deck.slides[i].id;
  if (overview || event.shiftKey || event.metaKey || event.ctrlKey) {
    finishText();
    setSelection([]);
    pinPosition = null;
    pinning = false;
    if (event.shiftKey) {
      pickedSlides = new Set(
        deck.slides
          .slice(Math.min(slideAnchor, i), Math.max(slideAnchor, i) + 1)
          .map((s) => s.id)
      );
    } else if (event.metaKey || event.ctrlKey) {
      const next = new Set(slideIds());
      if (next.has(id) && next.size > 1) {
        next.delete(id);
        i = deck.slides.findIndex((s) => next.has(s.id));
      } else next.add(id);
      pickedSlides = next;
      slideAnchor = i;
    } else {
      pickedSlides = new Set([id]);
      slideAnchor = i;
    }
    index = i;
    railSlides.highlight(i, slideIds());
    if (overview) overviewSlides.highlight(i, slideIds());
    else renderBoard();
    properties();
    status();
    if (overview && event.detail >= 2) setOverview(false);
  } else switchSlide(i);
}
function askSectionName(initial, title = 'New section') {
  return new Promise((resolve) => {
    const d = el('dialog', 'modal');
    d.innerHTML =
      '<form method="dialog"><h3></h3><label class="field">Section name<input required maxlength="160"></label><div class="buttons"><button class="top-action" type="button">Cancel</button><button class="top-action primary" value="ok">Done</button></div></form>';
    d.querySelector('h3').textContent = title;
    const input = d.querySelector('input');
    input.value = initial;
    d.querySelector('button[type=button]').onclick = () => d.close();
    d.onclose = () => {
      const name = d.returnValue === 'ok' && input.value.trim();
      d.remove();
      resolve(name || null);
    };
    document.body.append(d);
    d.showModal();
    input.select();
  });
}
async function editSection(id) {
  const ids = slideIds(),
    current = active().id;
  if (id === 'newSection') {
    const value = await askSectionName(
      'Section ' + ((deck.sections?.length || 0) + 1)
    );
    if (!value) return;
    change(() => {
      addSection(deck, value, ids);
      index = deck.slides.findIndex((s) => s.id === current);
    });
    return;
  }
  if (!deck.sections?.length) {
    await editSection('newSection');
    return;
  }
  const d = el('dialog', 'modal'),
    form = el('form');
  form.method = 'dialog';
  form.innerHTML =
    '<h3>Move to section</h3><label class="field">Section<select></select></label><div class="buttons"><button type="button" class="top-action">Cancel</button><button value="ok" class="top-action primary">Move</button></div>';
  const select = form.querySelector('select');
  for (const section of deck.sections) {
    select.add(new Option(section.name, section.id));
  }
  select.value = active().sectionId || deck.sections[0].id;
  form.querySelector('[type=button]').onclick = () => d.close();
  d.append(form);
  document.body.append(d);
  d.onclose = () => {
    if (d.returnValue === 'ok')
      change(() => {
        moveIntoSection(deck, ids, select.value);
        index = deck.slides.findIndex((s) => s.id === current);
        railSlides.reveal(active());
        overviewSlides.reveal(active());
      });
    d.remove();
  };
  d.showModal();
}
function bindSlideList(host, browser) {
  host.addEventListener('contextmenu', (e) => {
    const section = e.target.closest('[data-section]'),
      tile = e.target.closest('[data-slide]');
    if (section && section.dataset.section) {
      e.preventDefault();
      menu(section, [
        ['renameSection', 'Rename section…', 'text'],
        ['removeSection', 'Remove section grouping', 'section'],
      ]);
      $('.menu').dataset.sectionId = section.dataset.section;
      return;
    }
    if (!tile) return;
    e.preventDefault();
    const i = Number(tile.dataset.slide);
    if (!slideIds().has(deck.slides[i].id)) {
      chooseSlide(i, { detail: 1 });
    }
    execute('slideMenu', host.querySelector('[data-slide="' + i + '"]'));
  });
  host.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-section]'),
      eye = e.target.closest('[data-hide-slide]');
    if (toggle) {
      e.stopPropagation();
      browser.toggleSection(toggle.dataset.section);
      renderThumbs();
    }
    if (eye) {
      e.stopPropagation();
      const s = deck.slides[Number(eye.dataset.hideSlide)];
      change(() => {
        s.hidden = !s.hidden;
      });
    }
  });
  host.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('[data-slide]');
    if (!tile) return;
    const slide = deck.slides[Number(tile.dataset.slide)];
    const ids = slideIds().has(slide.id) ? [...slideIds()] : [slide.id];
    e.dataTransfer.setData(
      'application/x-pure-point-slides',
      JSON.stringify(ids)
    );
    e.dataTransfer.effectAllowed = 'move';
  });
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-pure-point-slides'))
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.querySelector('.drop-target')?.classList.remove('drop-target');
    e.target
      .closest('.slide-tile,.section-label')
      ?.classList.add('drop-target');
  });
  host.addEventListener('dragleave', (e) => {
    if (!host.contains(e.relatedTarget))
      host.querySelector('.drop-target')?.classList.remove('drop-target');
  });
  host.addEventListener('dragend', () =>
    host.querySelector('.drop-target')?.classList.remove('drop-target')
  );
  host.addEventListener('drop', (e) => {
    const raw = e.dataTransfer.getData('application/x-pure-point-slides');
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    host.querySelector('.drop-target')?.classList.remove('drop-target');
    let keys;
    try {
      keys = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(keys)) return;
    const ids = new Set(
      keys.filter((id) => deck.slides.some((s) => s.id === id))
    );
    if (!ids.size) return;
    const tile = e.target.closest('[data-slide]'),
      section = e.target.closest('[data-section]'),
      destination = tile && deck.slides[Number(tile.dataset.slide)];
    if (destination && ids.has(destination.id)) return;
    const current = active().id;
    change(() => {
      moveIntoSection(
        deck,
        ids,
        section?.dataset.section ||
          destination?.sectionId ||
          (!destination && deck.slides.at(-1)?.sectionId) ||
          null,
        destination?.id
      );
      index = deck.slides.findIndex((s) => s.id === current);
    });
  });
}
bindSlideList($('.thumbs'), railSlides);
bindSlideList($('.sorter'), overviewSlides);
bindPinch($('.stage'), zoomAt);
if (platform.native)
  window.addEventListener(
    'purepoint-magnify',
    ({ detail: { factor, x, y } }) => {
      if (
        !busy &&
        !present &&
        document.elementFromPoint(x, y)?.closest('.stage') &&
        !document.querySelector('dialog[open]')
      )
        zoomAt(factor, x, y);
    }
  );
$('.stage').addEventListener(
  'pointerdown',
  (e) => {
    if (
      busy ||
      tab !== 'comments' ||
      !inspectorOpen ||
      !e.target.closest('.artboard')
    )
      return;
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      e.preventDefault();
      e.stopImmediatePropagation();
      focusComment = pin.dataset.pin;
      commentPins();
      const i = (active().comments || []).findIndex(
        (c) => c.id === focusComment
      );
      document
        .querySelectorAll('.comment-card')
        [i]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (pinning) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pinPosition = coordinates(e);
      pinning = false;
      commentPins();
      properties();
      $('.comment-form textarea')?.focus();
    }
  },
  true
);

async function open(incoming) {
  let file;
  try {
    file = await platform.openPackage(incoming);
    if (!file) return;
    const loaded = importDeck(file.parts);
    if (!(await allowReplace())) return;
    reset(
      loaded.deck,
      { ...file, ...loaded, deck: structuredClone(loaded.deck) },
      platform.fileName(file.path),
      file.path
    );
    file = null;
  } finally {
    if (file) await platform.release(file);
  }
}
function drawPresentation() {
  const host = $('.present'),
    s = scene(active(), deck, assets, 'present'),
    ratio = Math.min(innerWidth / deck.w, innerHeight / deck.h);
  const frame = el('div', 'present-frame');
  Object.assign(frame.style, {
    width: deck.w * ratio + 'px',
    height: deck.h * ratio + 'px',
  });
  s.style.transform = `scale(${ratio})`;
  frame.append(s);
  host.replaceChildren(frame);
  const controls = el('div', 'present-controls');
  controls.innerHTML =
    action('prev', 'Previous slide', 'left') +
    `<span>${index + 1} / ${deck.slides.length}</span>` +
    action('next', 'Next slide', 'right') +
    action('endPresent', 'End presentation (Esc)', 'close');
  host.append(controls);
}
async function showPresentation(on) {
  finishText();
  if (on && active().hidden) {
    const start = deck.slides.findIndex((s, i) => i >= index && !s.hidden);
    const first = start < 0 ? deck.slides.findIndex((s) => !s.hidden) : start;
    if (first < 0) {
      toast('All slides are hidden.');
      return;
    }
    switchSlide(first);
  }
  present = on;
  if (on) {
    const host = el('div', 'present');
    document.body.append(host);
    drawPresentation();
  } else $('.present')?.remove();
  try {
    await platform.fullScreen(on);
  } catch {}
}
async function execute(id, button) {
  if (busy || document.querySelector('dialog[open]')) return;
  const sectionId = $('.menu')?.dataset.sectionId;
  if (id === 'renameSection' || id === 'removeSection') {
    $('.menu')?.remove();
    const section = deck.sections?.find((s) => s.id === sectionId);
    if (!section) return;
    if (id === 'renameSection') {
      const name = await askSectionName(section.name, 'Rename section');
      if (name)
        change(() => {
          section.name = name;
        });
    } else
      change(() => {
        const i = deck.sections.indexOf(section);
        deck.sections.splice(i, 1);
        const merge = deck.sections[Math.max(0, i - 1)]?.id || null;
        for (const s of deck.slides)
          if (s.sectionId === sectionId) s.sectionId = merge;
      });
    return;
  }
  if (!['fileMenu', 'slideMenu'].includes(id)) $('.menu')?.remove();
  if (id === 'overview' || id === 'canvasView') {
    setOverview(id === 'overview' ? !overview : false);
    return;
  }
  if (id === 'inspector') {
    if (overview) {
      setOverview(false);
      inspectorOpen = true;
    } else inspectorOpen = !inspectorOpen;
    localStorage.setItem(
      'pure-point.inspector',
      inspectorOpen ? 'open' : 'closed'
    );
    updateChrome();
    commentPins();
    return;
  }
  if (id === 'fileMenu') {
    if ($('.menu')?.dataset.kind === 'file') {
      $('.menu').remove();
      return;
    }
    menu(button || $('.p-menu'), [
      ['new', 'New presentation', 'new', '⌘N'],
      ['open', 'Open presentation…', 'open', '⌘O'],
      ['save', 'Save', 'save', '⌘S'],
      ['saveAs', 'Save as…', 'save', '⇧⌘S'],
      ['pdf', 'Export PDF…', 'export', '⇧⌘E'],
      ['present', 'Present', 'play', '⌥⌘P'],
      ['undo', 'Undo', 'undo', '⌘Z'],
      ['redo', 'Redo', 'redo', '⇧⌘Z'],
    ]);
    $('.menu').dataset.kind = 'file';
    status();
    return;
  }
  if (id === 'slideMenu') {
    menu(button, [
      ['newSection', 'Group in new section…', 'section'],
      ['moveSection', 'Move to section…', 'section'],
      [
        'hideSlides',
        [...slideIds()].every(
          (id) => deck.slides.find((s) => s.id === id)?.hidden
        )
          ? 'Show slides'
          : 'Hide slides',
        'eye',
      ],
      ['slideUp', 'Move up', 'layers'],
      ['slideDown', 'Move down', 'layers'],
      ['deleteSlide', 'Delete slide', 'delete'],
    ]);
    return;
  }
  if (id === 'undo' || id === 'redo') {
    if (
      editor ||
      ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    ) {
      document.execCommand(id);
      return;
    }
    restore(id === 'undo' ? history : future, id === 'undo' ? future : history);
    return;
  }
  finishText();
  if (
    [
      'save',
      'saveAs',
      'open',
      'incoming',
      'new',
      'quit',
      'pdf',
      'tool-image',
      'tool-video',
      'tool-embed',
    ].includes(id)
  ) {
    busy = true;
    status();
    try {
      if (id === 'save' || id === 'saveAs') await save(id === 'saveAs');
      if (id === 'open' || id === 'incoming') await open(id === 'incoming');
      if (id === 'new' && (await allowReplace())) await newDocument();
      if (id === 'pdf' && (await exportPDF(deck, base, assets, fileTitle())))
        toast('PDF exported.');
      if (id === 'quit' && (await allowReplace())) await platform.quit();
      if (id === 'tool-image') await mediaEditor.insertImage();
      if (id === 'tool-video') await mediaEditor.insertVideo();
      if (id === 'tool-embed') await mediaEditor.insertEmbed();
    } finally {
      busy = false;
      status();
      if (ready && incomingQueued) {
        incomingQueued = false;
        queueMicrotask(() => run('incoming'));
      }
    }
    return;
  }
  if (id.startsWith('tool-')) {
    setTool(id.slice(5));
    return;
  }
  if (id === 'addSlide') {
    change(() => {
      const previous = active();
      index++;
      deck.slides.splice(index, 0, {
        ...slide('', previous.bg),
        sectionId: previous.sectionId,
        layoutPath: previous.layoutPath,
        back: structuredClone(previous.back || []),
      });
      pickedSlides.clear();
      slideAnchor = index;
      setSelection([]);
      tool = 'pointer';
    });
    $('.select-slide.active')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (id === 'newSection' || id === 'moveSection') {
    await editSection(id);
    return;
  }
  if (id === 'hideSlides') {
    const ids = slideIds(),
      hide = deck.slides.some((s) => ids.has(s.id) && !s.hidden);
    change(() =>
      deck.slides.forEach((s) => {
        if (ids.has(s.id)) s.hidden = hide;
      })
    );
    return;
  }
  if (id === 'slideUp' || id === 'slideDown') {
    const next = index + (id === 'slideUp' ? -1 : 1);
    if (next >= 0 && next < deck.slides.length)
      change(() => {
        const s = deck.slides.splice(index, 1)[0];
        s.sectionId =
          deck.slides[Math.min(next, deck.slides.length - 1)]?.sectionId;
        deck.slides.splice(next, 0, s);
        index = next;
      });
    return;
  }
  if (id === 'deleteSlide') {
    const ids = slideIds();
    if (deck.slides.length === ids.size) {
      toast('Keep at least one slide in the presentation.');
      return;
    }
    change(() => {
      deck.slides = deck.slides.filter((s) => !ids.has(s.id));
      index = Math.min(index, deck.slides.length - 1);
      pickedSlides.clear();
      slideAnchor = index;
      setSelection([]);
    });
    return;
  }
  if (
    [
      'group',
      'ungroup',
      'delete',
      'toggleLayerVisibility',
      'toggleLayerLock',
    ].includes(id)
  ) {
    layerAction(
      { toggleLayerVisibility: 'hidden', toggleLayerLock: 'locked' }[id] || id
    );
    return;
  }
  if (['layers', 'design', 'comments'].includes(id)) {
    tab = id;
    pinning = false;
    pinPosition = null;
    properties();
    commentPins();
    return;
  }
  if (id === 'gridVisible') {
    updateGrid('visible', !grid.visible);
    return;
  }
  if (id === 'snap') {
    updateGrid('snap', !grid.snap);
    return;
  }
  if (id === 'present' || id === 'endPresent') {
    await showPresentation(id === 'present');
    return;
  }
  if (id === 'prev' || id === 'next') {
    const step = id === 'next' ? 1 : -1;
    let next = index + step;
    while (present && deck.slides[next]?.hidden) next += step;
    switchSlide(next);
    return;
  }
  if (id === 'fit') {
    chooseZoom('fit');
    return;
  }
  if (id === 'zoomIn' || id === 'zoomOut') {
    zoomStep(id === 'zoomIn');
    return;
  }
  if (!selected()) return;
  if (id === 'bold' || id === 'italic') updateObject(id, !selected()[id]);
  if (id.startsWith('align')) updateObject('align', id.slice(5));
}
const run = (id, b) => execute(id, b).catch(fail);
document.addEventListener('click', (e) => {
  if (busy || e.target.closest('dialog')) return;
  const b = e.target.closest('[data-action]');
  if (b) {
    run(b.dataset.action, b);
    return;
  }
  if (!e.target.closest('.menu')) $('.menu')?.remove();
  const s = e.target.closest('[data-slide]');
  if (s) {
    chooseSlide(Number(s.dataset.slide), e);
    return;
  }
  const disclosure = e.target.closest('[data-disclose]');
  if (disclosure) {
    toggleExpanded(disclosure.dataset.disclose);
    properties();
    return;
  }
  const layerToggle = e.target.closest('[data-layer-toggle]');
  if (layerToggle) {
    layerAction(layerToggle.dataset.layerToggle, layerToggle.dataset.target);
    return;
  }
  const l = e.target.closest('[data-layer]');
  if (l) {
    const id = l.dataset.layer;
    if (e.shiftKey && selection) {
      const visible = [...document.querySelectorAll('[data-layer]')].map(
        (n) => n.dataset.layer
      );
      const from = visible.indexOf(selection),
        to = visible.indexOf(id);
      if (from >= 0 && to >= 0) {
        const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelection([
          ...new Set([
            ...selectedIds(),
            ...range.filter((key) => key !== id),
            id,
          ]),
        ]);
        drawSelection();
        properties();
        return;
      }
    }
    select(id, e.metaKey || e.ctrlKey || e.shiftKey);
    return;
  }
  const p = e.target.closest('[data-preset]');
  if (p) {
    grid.visible = true;
    updateGrid('type', p.dataset.preset);
  }
});
document.addEventListener('change', (e) => {
  if (busy) return;
  const input = e.target;
  if (input.id === 'zoom') {
    chooseZoom(input.value);
    return;
  }
  const { field: key, scope, color, font } = input.dataset;
  if (key) {
    if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) {
      properties();
      return;
    }
    let v = Math.min(
      Number(input.max),
      Math.max(Number(input.min), input.valueAsNumber)
    );
    v /= dimension(key);
    if (scope === 'grid') {
      if (['columns', 'rows'].includes(key)) v = Math.round(v);
      updateGrid(key, v);
    } else updateObject(key, v);
  }
  if (color === 'bg') {
    change(() => {
      active().bg = input.value;
    });
  } else if (color) updateObject(color, input.value);
  if (font) updateObject('font', input.value);
});
const coordinates = (e) => {
  const r = $('.artboard').getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
};
$('.stage').addEventListener('pointerdown', (e) => {
  if (
    busy ||
    e.button !== 0 ||
    e.target.closest(
      '.floating-tools,textarea,.sorter,.comment-pin,.video-controls,[data-media-control],.media-controls,iframe'
    )
  )
    return;
  const art = e.target.closest('.artboard'),
    p = coordinates(e);
  if (!art && !e.target.closest('.world,.viewport')) return;
  if (tool !== 'pointer' && !art) return;
  if (tool !== 'pointer') {
    e.preventDefault();
    if (tool === 'text') {
      insertText(p);
      return;
    }
    const kind = tool,
      w = Math.min(deck.w, 120),
      h = Math.min(deck.h, 100);
    addObject(
      shape(
        kind,
        kind === 'rect' ? 'Rectangle' : 'Ellipse',
        Math.min(deck.w - w, Math.max(0, p.x)),
        Math.min(deck.h - h, Math.max(0, p.y)),
        w,
        h,
        { fill: blue }
      )
    );
    return;
  }
  const handle = e.target.closest('[data-handle]'),
    target = e.target.closest('[data-id]');
  const all = layerEntries(active().items),
    added = e.shiftKey || e.metaKey || e.ctrlKey;
  if (!handle && !target) {
    const prior = selectedIds();
    if (!added) select(null);
    drag = {
      id: e.pointerId,
      mode: 'marquee',
      start: p,
      prior,
      added,
      moved: false,
    };
    e.preventDefault();
    return;
  }
  let hit = target && all.get(target.dataset.id);
  if (hit) {
    if (hit.locked || hit.hidden) return;
    if (!e.metaKey && !e.ctrlKey) {
      // Click a group as a unit. A deep selection from the layer tree keeps its
      // editing context until a different branch is selected.
      const last = all.get(selection);
      while (
        hit.parent &&
        hit.object.id !== selection &&
        !selectedIds().includes(hit.object.id) &&
        hit.parent.object.id !== last?.parent?.object.id
      )
        hit = hit.parent;
    }
    const id = hit.object.id;
    if (added) {
      select(id, true);
      if (!selectedIds().includes(id)) return;
    } else if (!selectedIds().includes(id)) select(id);
  }
  const entries = selectedEntries(all).filter(
    (entry) => !entry.locked && !entry.hidden
  );
  if (!entries.length) return;
  e.preventDefault();
  const sources = entries.map((entry) => ({
    entry,
    from: {
      x: entry.object.x,
      y: entry.object.y,
      w: entry.object.w,
      h: entry.object.h,
    },
  }));
  const excluded = new Set(entries.map((entry) => entry.object.id));
  // Compare the selection box with visible siblings in slide coordinates.
  const visible = active().items.filter(
    (o) =>
      !o.hidden &&
      !excluded.has(o.id) &&
      !entries.some((e) => {
        let parent = e.parent;
        while (parent) {
          if (parent.object === o) return true;
          parent = parent.parent;
        }
        return false;
      })
  );
  drag = {
    id: e.pointerId,
    mode: 'objects',
    start: p,
    sources,
    box: selectionBounds(entries),
    handle: handle?.dataset.handle,
    before: snapshot(),
    targets: snapTargets(deck, { items: visible }, null, grid),
    collapse: !added && entries.length > 1 ? hit?.object.id : null,
    moved: false,
  };
});
function guides(x, y) {
  const sc = $('.artboard>.scene');
  sc.querySelector('.guide-layer')?.remove();
  const layer = el('div', 'guide-layer');
  for (const [v, isX] of [
    [x, true],
    [y, false],
  ])
    if (v != null) {
      const n = el('i', 'guide-line ' + (isX ? 'v' : 'h'));
      n.style[isX ? 'left' : 'top'] = v + 'px';
      layer.append(n);
    }
  sc.append(layer);
}
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const p = coordinates(e),
    dx = p.x - drag.start.x,
    dy = p.y - drag.start.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) * scale < 3) return;
    drag.moved = true;
    $('.stage').setPointerCapture(e.pointerId);
  }
  if (drag.mode === 'marquee') {
    const box = {
      x: Math.min(drag.start.x, p.x),
      y: Math.min(drag.start.y, p.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
    const all = layerEntries(active().items);
    const hits = active()
      .items.filter((o) => {
        const entry = all.get(o.id);
        if (entry.hidden || entry.locked) return false;
        const b = layerBounds(entry);
        return (
          b.x >= box.x &&
          b.y >= box.y &&
          b.x + b.w <= box.x + box.w &&
          b.y + b.h <= box.y + box.h
        );
      })
      .map((o) => o.id);
    setSelection(drag.added ? [...drag.prior, ...hits] : hits);
    drawSelection();
    const sc = $('.artboard>.scene');
    let overlay = sc.querySelector('.marquee');
    if (!overlay) {
      overlay = el('div', 'marquee');
      sc.append(overlay);
    }
    Object.assign(overlay.style, {
      left: box.x + 'px',
      top: box.y + 'px',
      width: box.w + 'px',
      height: box.h + 'px',
    });
    return;
  }
  const { box, handle, targets, sources } = drag,
    snap = grid.snap && !e.altKey;
  let gx = null,
    gy = null;
  if (!handle) {
    const x = box.x + dx,
      y = box.y + dy;
    const sx = snap
      ? snapAxis([x, x + box.w / 2, x + box.w], targets.x, 5 / scale)
      : { delta: 0 };
    const sy = snap
      ? snapAxis([y, y + box.h / 2, y + box.h], targets.y, 5 / scale)
      : { delta: 0 };
    gx = sx.guide;
    gy = sy.guide;
    for (const { entry, from } of sources) {
      const delta = localDelta(entry.transform, dx + sx.delta, dy + sy.delta),
        o = entry.object;
      o.x = from.x + delta.x;
      o.y = from.y + delta.y;
      const node = $('.artboard [data-id="' + o.id + '"]');
      if (node)
        Object.assign(node.style, { left: o.x + 'px', top: o.y + 'px' });
    }
  } else {
    const { entry, from } = sources[0],
      o = entry.object;
    const a = (o.rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const west = handle.includes('w') !== !!o.flipH,
      north = handle.includes('n') !== !!o.flipV;
    const d = localDelta(entry.transform, dx, dy);
    let lx = d.x * c + d.y * s,
      ly = -d.x * s + d.y * c;
    if (snap && !entry.parent && Math.abs(a) < 0.0001) {
      const sx = snapAxis(
          [from.x + (west ? 0 : from.w) + lx],
          targets.x,
          5 / scale
        ),
        sy = snapAxis(
          [from.y + (north ? 0 : from.h) + ly],
          targets.y,
          5 / scale
        );
      lx += sx.delta;
      ly += sy.delta;
      gx = sx.guide;
      gy = sy.guide;
    }
    o.w = Math.max(1, from.w + (west ? -lx : lx));
    o.h = Math.max(1, from.h + (north ? -ly : ly));
    if (e.shiftKey && from.w > 0) o.h = (o.w * from.h) / from.w;
    const mx = ((o.w - from.w) * (west ? -1 : 1)) / 2,
      my = ((o.h - from.h) * (north ? -1 : 1)) / 2;
    o.x = from.x + from.w / 2 + mx * c - my * s - o.w / 2;
    o.y = from.y + from.h / 2 + mx * s + my * c - o.h / 2;
    $('.artboard [data-id="' + o.id + '"]')?.replaceWith(
      itemNode(o, assets, true)
    );
  }
  drawSelection();
  guides(gx, gy);
});
function endDrag(e, cancel) {
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  const stage = $('.stage');
  if (stage.hasPointerCapture(e.pointerId))
    stage.releasePointerCapture(e.pointerId);
  if (d.mode === 'marquee') {
    $('.artboard .marquee')?.remove();
    if (cancel) setSelection(d.prior);
    drawSelection();
    properties();
    return;
  }
  if (d.moved) {
    if (cancel)
      for (const { entry, from } of d.sources)
        Object.assign(entry.object, from);
    else record(d.before);
    render();
  } else if (d.collapse && !cancel) select(d.collapse);
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
$('.stage').addEventListener('dblclick', (e) => {
  const n = e.target.closest('[data-id]');
  if (e.target.closest('textarea,.comment-pin,.floating-tools,.sorter') || busy)
    return;
  if (n) {
    select(n.dataset.id);
    const o = selected();
    if (!o || o.locked || o.kind === 'image' || o.kind === 'video') return;
    if (o.kind === 'text' || o.text) startText();
    else if (['rect', 'ellipse', 'roundRect', 'triangle'].includes(o.kind))
      startText(true);
  } else if (e.target.closest('.artboard')) insertText(coordinates(e));
});
document.addEventListener('keydown', (e) => {
  if (e.isComposing || busy || document.querySelector('dialog[open]')) return;
  const editing = e.target.closest(
      'input,textarea,select,[contenteditable="true"]'
    ),
    cmd = e.metaKey || e.ctrlKey;
  if (present) {
    if (
      [
        'ArrowRight',
        'ArrowDown',
        ' ',
        'PageDown',
        'ArrowLeft',
        'ArrowUp',
        'PageUp',
        'Escape',
      ].includes(e.key)
    ) {
      e.preventDefault();
      run(
        e.key === 'Escape'
          ? 'endPresent'
          : ['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)
            ? 'next'
            : 'prev'
      );
    }
    return;
  }
  if (e.key === 'Escape') {
    $('.menu')?.remove();
    if (overview && !editing) {
      setOverview(false);
      return;
    }
    if (!editing) {
      tool = 'pointer';
      select(null);
      renderBoard();
    }
    return;
  }
  if (cmd && !editing) {
    const key = e.key.toLowerCase();
    const layerCommand =
      key === 'g'
        ? e.shiftKey
          ? 'ungroup'
          : 'group'
        : e.shiftKey && key === 'l'
          ? 'toggleLayerLock'
          : e.shiftKey && key === 'h'
            ? 'toggleLayerVisibility'
            : null;
    if (layerCommand) {
      e.preventDefault();
      run(layerCommand);
      return;
    }
    if (key === 'a' && (overview || e.target.closest('.rail'))) {
      e.preventDefault();
      pickedSlides = new Set(deck.slides.map((s) => s.id));
      renderThumbs();
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      setSelection(
        active()
          .items.filter((o) => !o.hidden && !o.locked)
          .map((o) => o.id)
      );
      drawSelection();
      properties();
      return;
    }
  }
  if (cmd) {
    const key = e.key.toLowerCase(),
      id = {
        s: e.shiftKey ? 'saveAs' : 'save',
        o: 'open',
        n: 'new',
        z: e.shiftKey ? 'redo' : 'undo',
      }[key];
    // The macOS menu handles its own accelerator even while a field has focus.
    if (id && !platform.native && !(editing && key === 'z')) {
      e.preventDefault();
      run(id);
    }
    return;
  }
  if (editing || e.target.closest('[role=separator]')) return;
  if (overview && e.key === 'Enter') {
    e.preventDefault();
    setOverview(false);
    return;
  }
  const o = selected();
  if (
    o &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
  ) {
    e.preventDefault();
    const entries = selectedEntries().filter((e) => !e.locked);
    const step = (e.shiftKey ? 10 : 1) / designUnit;
    if (entries.length)
      change(() => {
        for (const entry of entries) {
          const delta = localDelta(
            entry.transform,
            e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
            e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
          );
          entry.object.x += delta.x;
          entry.object.y += delta.y;
        }
      });
    return;
  }
  if (
    !o &&
    [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
    ].includes(e.key)
  ) {
    e.preventDefault();
    switchSlide(
      index + (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) ? 1 : -1)
    );
    return;
  }
  if (o && e.key === 'Enter') {
    e.preventDefault();
    startText();
    return;
  }
  const id = {
    Delete: 'delete',
    Backspace: 'delete',
    v: 'tool-pointer',
    t: 'tool-text',
    r: 'tool-rect',
    o: 'tool-ellipse',
    g: 'gridVisible',
  }[e.key];
  if (id) {
    e.preventDefault();
    run(id);
  }
});
window.addEventListener('beforeunload', (e) => {
  if (!platform.native && currentRevision !== savedRevision) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!platform.native && present && !document.fullscreenElement) {
    present = false;
    $('.present')?.remove();
  }
});
$('.viewport').addEventListener('scroll', drawRulers);
new ResizeObserver(() => {
  sizing();
  if (present) drawPresentation();
}).observe($('.stage'));
render();
platform
  .getFonts()
  .then((list) => {
    fonts = list;
    properties();
    loadFonts();
  })
  .catch(fail);
let ready = false,
  incomingQueued = false;
platform
  .nativeEvents((id) => {
    if (id === 'incoming' && (!ready || busy)) {
      incomingQueued = true;
      return;
    }
    run(id);
  })
  .then(async () => {
    busy = true;
    try {
      await newDocument();
    } catch (err) {
      await fail(err);
    } finally {
      busy = false;
      ready = true;
      status();
    }
    if (platform.native || incomingQueued) {
      incomingQueued = false;
      await run('incoming');
    }
  });
