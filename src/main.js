import './vector.css';
import {
  vectorKinds,
  createAt,
  sizeDraft,
  moveVertex,
  setCurvature,
  splitEdge,
  deleteVertex,
  resizeDimensions,
  localContours,
} from './vector.js';
import {
  appendVertexOverlay,
  strokePanel,
  shapePanel,
  vectorDrawing,
} from './vector-view.js';
import { calloutTip } from './shape-presets.js';
import { anchorAt, refreshCommentPositions } from './comment-anchors.js';
import {
  alignments,
  alignmentMoves,
  bindLayerReordering,
  reorderLayers,
} from './arrange.js';
import { chooseColor, closeColorPicker } from './color-dialog.js';
import { documentColors } from './paint.js';
import { captureSlides, pasteSlides } from './slide-clipboard.js';
import { objectClipboard } from './object-clipboard.js';
import {
  captureClipboardMedia,
  pasteClipboardMedia,
} from './clipboard-media.js';
import { captureOfficeObject, validateOfficeCopies } from './office-copy.js';
import './style.css';
import { bindNumberFields } from './number-fields.js';
import { editCrop } from './image-crop.js';
import { createMediaEditor, readClipboardImages } from './media-editor.js';
import './workspace.css';
import './appearance.css';
import {
  workspace,
  animateLogo,
  bindAppearance,
  bindRailResize,
  bindScriptPanel,
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
  copiesOnSlide,
  localDelta,
  fitGroups,
  makeGroup,
  ungroup,
} from './layers.js';
import { layerPanel, toggleExpanded } from './layer-panel.js';
import { defaultTextSize, measureTextElement, singleLine } from './text.js';
import { layoutOptions, setTitleSpacing } from './slide-layouts.js';
import { resizeDeck, sameSlideSize, slideSizeLabel } from './slide-size.js';
import { chooseLayout } from './layout-picker.js';
import { inlineText } from './inline-text.js';
import {
  blankDeck, designUnit, hasTextFrame, slide, slideSizes, textItem, uid,
} from './model.js';
import { pageNumberColor, pageNumbers } from './page-numbers.js';
import { presentationControl } from './presentation.js';
import { replaceLiveItem, replaceLiveScene, slidePlayback } from './playback.js';
import { loadSlideFonts as prepareSlideFonts } from './slide-fonts.js';
import { importDeck } from './import.js';
import { objectDecoration, runFontFor } from './text-runs.js';
import { exportDeck } from './export.js';
import { defaults, snapAxis, snapTargets } from './grid.js';
import {
  appendSpacing,
  objectSpacing,
  snapMovement,
  stationaryBounds,
} from './canvas-arrange.js';
import './canvas-arrange.css';
import { el, gridOverlay, icon, itemNode, scene } from './view.js';
import { esc } from './xml.js';
import * as platform from './platform.js';

const $ = (s) => document.querySelector(s);
const action = (id, label, glyph, cls = 'icon-btn', content = false) =>
  `<button type="button" class="${cls}" data-action="${id}" aria-label="${esc(label)}" title="${esc(label)}">${icon(glyph)}${content ? esc(label) : ''}</button>`;
const fileTitle = () => (path ? platform.fileName(path) : title);
const loadSlideFonts = (slide) =>
  prepareSlideFonts(slide, fonts, deck.showPageNumbers && !slide.hidden);
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
  busy = true,
  editor = null,
  cropEdit = null;
let panOrigin = null;
let numberAdjustment = null;
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
document.body.classList.toggle('native-mac', platform.nativeMac);
root.innerHTML = workspace(action);
bindAppearance($('#appearance'));
const presentation = presentationControl(presentationSnapshot, movePresentation);
const commentDrafts = new Map();
const scriptField = $('#slide-script');
const shareButton = $('[data-action="copyShareLink"]');
const pageNumberButton = $('[data-action="pageNumber"]');
let shareMode = 'none';
let sharingPath = null;
let scriptOpen = false,
  savingDocument = false,
  noteRevision = null,
  navigatorOpen = localStorage.getItem('pure-point.navigator') !== 'closed';
let documentId = uid();
let overview = false,
  inspectorOpen = localStorage.getItem('pure-point.inspector') !== 'closed';
let tileWidth = 216,
  selectionScope = 'canvas',
  pickedSlides = new Set(),
  slideAnchor = 0,
  pinPosition = null,
  pinning = false,
  focusComment = null;
const railSlides = slideBrowser($('.thumbs'), { prepareSlide: loadSlideFonts }),
  overviewSlides = slideBrowser($('.sorter'), {
    sorter: true,
    prepareSlide: loadSlideFonts,
  });
animateLogo($('#floating-p'));
bindRailResize($('.rail-resizer'));
bindScriptPanel($('#script-panel'));
for (const [action, panel] of [
  ['navigator', 'slide-navigator'],
  ['script', 'script-panel'],
  ['inspector', 'slide-inspector'],
]) {
  document
    .querySelector(`.panel-toggles [data-action="${action}"]`)
    .setAttribute('aria-controls', panel);
}
scriptField.addEventListener('input', () => {
  const slide = active();
  if (scriptField.readOnly || scriptField.value === (slide.notes || '')) return;
  // A continuous edit has one document undo entry. A save starts a new entry
  // even if the insertion point remains in the same speaker-notes field.
  const before =
    noteRevision !== currentRevision || currentRevision === savedRevision
      ? snapshot()
      : null;
  slide.notes = scriptField.value;
  if (before) record(before);
  noteRevision = currentRevision;
});
scriptField.addEventListener('blur', () => {
  noteRevision = null;
});
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
  root.classList.toggle('navigator-closed', !navigatorOpen);
  $('#script-panel').hidden = !scriptOpen;
  $('[data-action="navigator"]').setAttribute('aria-pressed', navigatorOpen);
  $('[data-action="script"]').setAttribute('aria-pressed', scriptOpen);
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
  sc?.querySelectorAll('.comment-pin,.pending-pin').forEach((n) => n.remove());
  if (!sc || tab !== 'comments' || !inspectorOpen || overview) return;
  for (const card of document.querySelectorAll('[data-comment-id]'))
    card.classList.toggle('focused', card.dataset.commentId === focusComment);
  (active().comments || []).forEach((c, i) => {
    const b = el(
      'button',
      'comment-pin' + (focusComment === c.id ? ' focused' : '')
    );
    b.dataset.pin = c.id;
    b.onclick = () => selectComment(c.id, true);
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
function selectComment(id, fromPin = false) {
  focusComment = id;
  commentPins();
  const pin = $('.artboard .comment-pin.focused');
  if (fromPin) pin?.focus({ preventScroll: true });
  const other = fromPin ? $('.comment-card.focused') : pin;
  other?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function removeComment(id) {
  change(() => {
    active().comments = active().comments.filter((comment) => comment.id !== id);
    if (focusComment === id) focusComment = null;
  });
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
async function refreshSharing() {
  const file = path;
  shareMode = 'none';
  shareButton.hidden = true;
  const mode = await platform.shareDocumentMode(file).catch(() => 'none');
  if (!file || path !== file || !['graph', 'finder', 'explorer'].includes(mode)) return;
  shareMode = mode;
  shareButton.querySelector('span').textContent =
    mode === 'graph' ? 'Copy link' : 'Share…';
  shareButton.title =
    mode === 'graph'
      ? 'Copy a link that people at Dentsu can use to edit this file'
      : mode === 'explorer' ? 'Share this file using OneDrive in File Explorer' : 'Share this file using OneDrive in Finder';
  shareButton.hidden = false;
}
async function shareDocument() {
  if (!path || shareMode === 'none' || sharingPath) return;
  const file = path;
  sharingPath = file;
  shareButton.disabled = true;
  shareButton.setAttribute('aria-busy', 'true');
  try {
    let message = '';
    if (shareMode === 'graph') {
      try {
        await platform.copyOrganizationLink(file);
        toast('Edit link copied for people at Dentsu.');
        return;
      } catch (error) {
        if (file !== path) return;
        message = (error?.message || String(error)) + '\n\n';
      }
    }
    const answer = await dialog(
      'Share in OneDrive',
      message +
        (shareMode === 'explorer'
          ? 'In File Explorer, right-click the selected presentation and choose OneDrive’s Share command. Choose the recipients and permissions before copying the link.'
          : 'In Finder, Control-click the selected presentation and choose OneDrive’s Share command. In Link settings, select “People in Dentsu” and “Can edit”, then choose “Copy link”.'),
      [
        ['cancel', 'Cancel'],
        ['reveal', shareMode === 'explorer' ? 'Show in File Explorer' : 'Show in Finder'],
      ]
    );
    if (answer === 'reveal') await platform.revealShareDocument(file);
  } finally {
    sharingPath = null;
    shareButton.removeAttribute('aria-busy');
    shareButton.disabled = busy;
  }
}
function snapshot() {
  return {
    deck: JSON.stringify(deck),
    index,
    selection,
    additionalSelection: [...additionalSelection],
    slideSelection: [...pickedSlides],
    slideAnchor,
    selectionScope,
    rev: currentRevision,
  };
}
function record(before) {
  if (numberAdjustment) return;
  fitGroups(active().items);
  refreshCommentPositions(active());
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
  const before = numberAdjustment?.before || snapshot();
  fn();
  record(before);
  render();
}
function restore(from, to) {
  const snap = from.pop();
  if (!snap) return;
  to.push(snapshot());
  const restored = JSON.parse(snap.deck);
  if (!sameSlideSize(deck, restored)) {
    zoom = 'fit';
    panOrigin = null;
  }
  deck = restored;
  index = snap.index;
  setSelection(
    [...(snap.additionalSelection || []), snap.selection].filter(Boolean)
  );
  pickedSlides = new Set(snap.slideSelection);
  slideAnchor = snap.slideAnchor ?? index;
  selectionScope = snap.selectionScope || 'canvas';
  currentRevision = snap.rev;
  render();
}
function status() {
  presentation.publish();
  shareButton.disabled = busy || Boolean(sharingPath);
  const dirty =
    currentRevision !== savedRevision ||
    Boolean(editor?.changed() || cropEdit?.changed());
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    platform.dirtyFlag(dirty);
  }
  $('.doc-name').textContent = fileTitle() + '.pptx';
  $('.doc-name').title = path || $('.doc-name').textContent;
  if (scriptField.dataset.slideId !== active().id) {
    noteRevision = null;
    scriptField.dataset.slideId = active().id;
  }
  if (scriptField.value !== (active().notes || ''))
    scriptField.value = active().notes || '';
  scriptField.readOnly = busy && !savingDocument;
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
  pageNumberButton.setAttribute('aria-pressed', Boolean(deck.showPageNumbers));
  document
    .querySelectorAll('[data-action="undo"]')
    .forEach((b) => (b.disabled = !history.length));
  document
    .querySelectorAll('[data-action="redo"]')
    .forEach((b) => (b.disabled = !future.length));
  platform.setTitle(fileTitle() + (dirty ? ' •' : '') + ' — pure-point');
}
function renderThumbs(refreshPreview = true) {
  $('.head-count').textContent = deck.slides.length;
  railSlides.render(deck, assets, index, slideIds(), refreshPreview);
  if (overview)
    overviewSlides.render(deck, assets, index, slideIds(), refreshPreview);
}
function setOverview(on) {
  finishText();
  overview = on;
  selectionScope = on ? 'slides' : 'canvas';
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
  if (!Number.isFinite(factor) || factor <= 0) return;
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
      panOrigin = null;
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
  const viewWidth = vp.clientWidth,
    viewHeight = vp.clientHeight;
  const horizontalPadding = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight),
    verticalPadding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const availableW = viewWidth - horizontalPadding,
    availableH = viewHeight - verticalPadding;
  scale =
    zoom === 'fit'
      ? Math.max(0.01, Math.min(availableW / deck.w, availableH / deck.h))
      : Number(zoom) * designUnit;
  const w = deck.w * scale,
    h = deck.h * scale;
  // Leave room to scroll on both axes at every zoom, even when the slide fits.
  // Preserve native trackpad inertia and the user's offset from the center.
  const worldWidth = Math.max(viewWidth, w + horizontalPadding) + 2 * viewWidth,
    worldHeight = Math.max(viewHeight, h + verticalPadding) + 2 * viewHeight;
  const origin = {
    x: Math.round((worldWidth - viewWidth) / 2),
    y: Math.round((worldHeight - viewHeight) / 2),
  };
  const panX = panOrigin ? vp.scrollLeft - panOrigin.x : 0,
    panY = panOrigin ? vp.scrollTop - panOrigin.y : 0;
  Object.assign($('.artboard').style, { width: w + 'px', height: h + 'px' });
  world.style.width = worldWidth + 'px';
  world.style.height = worldHeight + 'px';
  const sc = $('.artboard .scene');
  if (sc) {
    // Lay out at the display scale so WebKit paints live text at that size.
    sc.style.zoom = scale;
    sc.style.setProperty('--hair', 1 / scale + 'px');
  }
  vp.scrollLeft = origin.x + panX;
  vp.scrollTop = origin.y + panY;
  panOrigin = origin;
  editor?.paintCaret();
  updateZoomLabel();
  $('.page-label').textContent = 'Slide ' + (index + 1);
  drawRulers();
}
let vectorEdit = null;
let groupChild = null;
function setSelection(ids) {
  if (vectorEdit && (ids.length !== 1 || ids[0] !== vectorEdit.id))
    vectorEdit = null;
  if (ids.length !== 1 || ids[0] !== groupChild) groupChild = null;
  if (ids.length) selectionScope = 'canvas';
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
// Pick the group as a unit unless the user is working inside that group.
function canvasEntry(all, id, deep) {
  let hit = all.get(id);
  if (!hit || deep) return hit;
  const last = all.get(selection);
  const ids = selectedIds();
  while (
    hit.parent &&
    !ids.includes(hit.object.id) &&
    hit.parent.object.id !== last?.parent?.object.id
  )
    hit = hit.parent;
  return hit;
}
function canGroup(entries) {
  return entries.length > 1 && entries.every((e) => !e.locked);
}
function resizeCursor(handle, transform) {
  const vector = transform.transformPoint({
    x: handle.includes('w') ? -1 : Number(handle.includes('e')),
    y: handle.includes('n') ? -1 : Number(handle.includes('s')),
    w: 0,
  });
  const angle = Math.atan2(vector.y, vector.x);
  if (handle.length === 2) {
    // A corner keeps a diagonal cursor even when the shape's transform
    // makes its diagonal shallow or steep.
    const quadrant = Math.floor((2 * angle) / Math.PI);
    return quadrant % 2 ? 'nesw-resize' : 'nwse-resize';
  }
  const octant = Math.round((4 * angle) / Math.PI);
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][
    (octant + 4) % 4
  ];
}
function drawSelection() {
  const sc = $('.artboard>.scene');
  if (!sc) return;
  sc.querySelector('.selection')?.remove();
  const entries = selectedEntries().filter((e) => !e.hidden && !e.locked);
  if (!entries.length) return;
  const layer = el('div', 'selection');
  if (entries.length === 1 && vectorEdit?.id === entries[0].object.id) {
    appendVertexOverlay(layer, entries[0], vectorEdit.selected, scale);
    sc.append(layer);
    return;
  }
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
    const entry = entries[0],
      o = entry.object;
    if (o.kind === 'callout' && o.w > 0 && o.h > 0) {
      const tip = calloutTip(o);
      const point = entry.transform.multiply(shapeTransform(o)).transformPoint({
        x: (tip.x * o.w) / 1000,
        y: (tip.y * o.h) / 1000,
      });
      const handle = el('i', 'callout-tip');
      handle.title = 'Drag callout tip';
      Object.assign(handle.style, {
        left: point.x + 'px',
        top: point.y + 'px',
      });
      layer.append(handle);
    }
    const transform = entry.transform.multiply(shapeTransform(o));
    for (const name of ['n', 's', 'w', 'e']) {
      const edge = el('i', 'resize-edge');
      edge.dataset.handle = name;
      edge.style.cursor = resizeCursor(name, transform);
      box.append(edge);
    }
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
        cursor: resizeCursor(name, transform),
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
    if (selectedIds().length === entries.length) {
      const axis = drag?.mode === 'spacing' ? drag.axis : undefined;
      for (const spacing of objectSpacing(entries, axis))
        spacing.gaps.forEach((gap, i) =>
          appendSpacing(layer, spacing.axis, gap, i, scale)
        );
    }
  }
  sc.append(layer);
}
function renderBoard() {
  if (cropEdit) finishCrop();
  presentation.publish();
  loadSlideFonts(active());
  const sc = scene(active(), deck, assets, true);
  replaceLiveScene($('.artboard'), sc, active().id);
  if (grid.visible) $('.artboard').append(gridOverlay(deck, grid));
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
const wrapAngle = (angle) => {
  const degrees = angle % 360;
  if (degrees < -180) return degrees + 360;
  if (degrees > 180) return degrees - 360;
  return degrees;
};
function field(label, key, value, min, max, scope = 'object') {
  const factor = dimension(key);
  const input = `<input aria-label="${label}" type="number" step="any" data-scope="${scope}" data-field="${key}" value="${Number((Number(value) * factor).toFixed(2))}" min="${min * factor}" max="${max * factor}">`;
  if (key === 'rotation')
    return `<label class="field">Rotation<span class="angle-input" title="Counterclockwise angle">${icon('rotation', 12)}${input}<span aria-hidden="true">°</span></span></label>`;
  return `<label class="field">${label}${input}</label>`;
}
const paintLabel = (color) => {
  if (!color) return 'None';
  const opacity =
    color.length === 9
      ? ' · ' + Math.round((parseInt(color.slice(7), 16) * 100) / 255) + '%'
      : '';
  return color.slice(1, 7).toUpperCase() + opacity;
};
const swatch = (label, col, key) =>
  `<div class="property"><span>${esc(label)}</span><button type="button" class="swatch" aria-haspopup="dialog" aria-label="${esc(label)}" data-color="${key}" data-value="${esc(col || '')}"><i style="background:${esc(col || 'transparent')}"></i><span>${esc(paintLabel(col))}</span></button></div>`;
function editPaint(button) {
  const key = button.dataset.color,
    slide = active(),
    target = key === 'bg' ? slide : selected();
  if (!target || (key !== 'bg' && selectedEntries().some((e) => e.locked)))
    return;
  const styles = [target];
  if (key === 'color')
    for (const p of target.paragraphs || []) styles.push(p.base, ...p.runs);
  const editing = editor?.o === target ? editor : null;
  const mark = editing?.remember();
  let before;
  chooseColor(button, {
    colors: documentColors(deck, active()),
    allowNone: key === 'fill' || key === 'stroke',
    restoreFocus: editing ? () => {
      if (editor === editing) editing.resume(mark);
    } : undefined,
    onPreview(value) {
      if (styles.every((style) => (style[key] ?? null) === value)) return;
      before ??= snapshot();
      for (const style of styles) style[key] = value;
      button.dataset.value = value || '';
      button.querySelector('i').style.background = value || 'transparent';
      button.querySelector('span').textContent = paintLabel(value);
      presentation.publish();
      if (key === 'bg') {
        $('.artboard > .scene').style.background = value;
        const label = $('.artboard .slide-page-number .item-text');
        if (label) label.style.color = pageNumberColor(value);
      } else {
        const node = $('.artboard [data-id="' + CSS.escape(target.id) + '"]');
        if (key === 'color') {
          node
            ?.querySelectorAll('.item-text,.item-text div,.item-text span')
            .forEach((n) => {
              n.style.color = value;
            });
        } else if (node) {
          const geometry = node.querySelector(':scope > .geometry');
          if (target.kind === 'text' && !target.fill && !target.stroke)
            geometry?.remove();
          else {
            const next = vectorDrawing(target, true);
            if (geometry) geometry.replaceWith(next);
            else node.prepend(next);
          }
        }
      }
    },
    onCommit() {
      if (!before) return;
      if (before.deck !== JSON.stringify(deck) && !editor?.creation)
        record(before);
      before = null;
      renderThumbs();
    },
    onUndo(redo) {
      finishText();
      restore(redo ? future : history, redo ? history : future);
    },
  });
}

const alignControls = () =>
  '<div class="object-alignment" role="group" aria-label="Object alignment">' +
  alignments
    .map(([dir, label]) => action('objectAlign-' + dir, label, 'object' + dir))
    .join('') +
  '</div>';
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
const textActions = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  alignleft: 'Align left',
  aligncenter: 'Align center',
  alignright: 'Align right',
};
function textButtons(o) {
  return Object.entries(textActions)
    .map(([key, label]) => {
      const pressed =
        key === 'underline' || key === 'strike'
          ? objectDecoration(o, key)
          : Boolean(o[key] || 'align' + o.align === key);
      return `<button type="button" class="icon-btn${pressed ? ' on' : ''}" data-action="${key}" aria-label="${label}" title="${label}" aria-pressed="${pressed}">${icon(key)}</button>`;
    })
    .join('');
}
function properties() {
  if (numberAdjustment) return;
  const o = selected(),
    container = $('#properties');
  document
    .querySelectorAll('.tab')
    .forEach((b) => b.classList.toggle('active', tab === b.dataset.action));
  const layers = selectedEntries();
  if (tab === 'comments') {
    const entries = layerEntries(active().items);
    const target = pinPosition?.objectId
      ? entries.get(pinPosition.objectId)
      : pinPosition
        ? null
        : entries.get(selection);
    renderComments(container, active(), {
      targetName: target?.object.name,
      nameFor: (id) => entries.get(id)?.object.name,
      focused: focusComment,
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
            ...(anchorAt(target, pinPosition) || {
              x: deck.w * 0.5,
              y: deck.h * 0.5,
            }),
          });
          pinPosition = null;
          pinning = false;
        });
      },
      remove(c) {
        removeComment(c.id);
      },
      focusPin(c) {
        selectComment(c.id);
      },
    });
    return;
  }
  if (tab === 'layers') {
    container.innerHTML = layerPanel(
      active().items,
      new Set(selectedIds()),
      canGroup(layers),
      layers.some((e) => e.object.kind === 'group' && !e.locked),
      layers.length && layers.every((e) => !e.locked) ? alignControls() : ''
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
        (locked ? '' : alignControls()) +
          '<div class="layer-set">' +
          options +
          '</div>'
      );
    return;
  }
  if (!o) {
    const currentSize = slideSizes.findIndex((size) => sameSlideSize(deck, size));
    const sizes = slideSizes.map((size, i) =>
      `<option value="${i}"${i === currentSize ? ' selected' : ''}>${slideSizeLabel(size)}</option>`
    );
    if (currentSize < 0)
      sizes.unshift(`<option value="custom" selected disabled>${slideSizeLabel(deck)}</option>`);
    container.innerHTML =
      section(
        'Slide',
        `<label class="field">Slide size<select id="slide-size" title="Applies to all slides">${sizes.join('')}</select></label>${swatch('Background', active().bg, 'bg')}`
      ) + gridPanel();
  } else {
    const fields =
      field('X (px)', 'x', o.x, -100000, 100000) +
      field('Y (px)', 'y', o.y, -100000, 100000) +
      field('Width (px)', 'w', o.w, 0.1, 100000) +
      field('Height (px)', 'h', o.h, 0.1, 100000) +
      field('Rotation (°)', 'rotation', wrapAngle(-o.rotation), -360, 360);
    let html = section(
      'Position',
      `${alignControls()}<div class="form-grid">${fields}</div>`,
      action('delete', 'Delete object', 'delete')
    );
    html += shapePanel(o, { section, field });
    if (hasTextFrame(o)) {
      const displayedFont = runFontFor(o.text, o);
      const families = [...new Set(fonts.map((f) => f.family))],
        face = fonts.find(
          (f) => f.full === displayedFont || f.postscript === displayedFont
        ),
        family = families.includes(displayedFont)
          ? displayedFont
          : face?.family || displayedFont;
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
      const lineHeight = o.lineHeight || 1;
      const custom =
        typeof lineHeight === 'string'
          ? parseFloat(lineHeight) + ' pt'
          : Number(lineHeight.toFixed(3)).toString();
      const lineChoices = [1, 1.15, 1.5, 2].map((n) => [
        String(n),
        n.toFixed(n === 1.15 ? 2 : 1),
      ]);
      if (!lineChoices.some(([value]) => value === String(lineHeight)))
        lineChoices.unshift([String(lineHeight), custom]);
      const lineSelect =
        '<label class="field">Line spacing<select data-line-spacing aria-label="Line spacing">' +
        lineChoices
          .map(
            ([v, label]) =>
              '<option value="' +
              esc(v) +
              '"' +
              (String(lineHeight) === v ? ' selected' : '') +
              '>' +
              esc(label) +
              '</option>'
          )
          .join('') +
        '</select></label>';
      html += section(
        'Text',
        `<div class="form-grid"><label class="field wide">Font family<select data-font="family" aria-label="Font family">${families.map((f) => `<option${f === family ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label><label class="field">Style<select data-font="face" aria-label="Style">${members.map((f) => `<option value="${esc(f.full)}"${f.style === style ? ' selected' : ''}>${esc(f.style)}</option>`).join('')}</select></label>${field('Size (pt)', 'size', o.size, 1, 4000)}${field('Letter spacing (pt)', 'letterSpacing', o.letterSpacing || 0, -40, 40)}${lineSelect}</div><div class="segmented">${textButtons(o)}</div>${swatch('Text color', o.color, 'color')}`
      );
    }
    if (
      ['rect', 'ellipse', 'triangle', 'roundRect', 'callout', 'path', 'text'].includes(
        o.kind
      )
    )
      html += section('Appearance', swatch('Fill', o.fill, 'fill'));
    if (vectorKinds.has(o.kind))
      html += strokePanel(o, { section, field, swatch }, vectorEdit?.selected);
    if (o.kind === 'image')
      html += section(
        'Image',
        '<div class="layer-set"><button data-action="cropImage">Crop image…</button><button data-action="replaceMedia">Replace image…</button></div>'
      );
    if (o.kind === 'unsupported')
      html += section(
        'PowerPoint object',
        '<p class="hint">Simplified preview. The original object is preserved in PowerPoint.</p>'
      );
    container.innerHTML = html;
  }
}
function render(refreshPreview = true) {
  if (numberAdjustment) {
    renderBoard();
    return;
  }
  updateChrome();
  renderThumbs(refreshPreview);
  renderBoard();
  properties();
  status();
}
function setTool(value) {
  if (drag?.mode === 'draw-vector' || drag?.mode === 'vertex')
    endDrag({ pointerId: drag.id }, true);
  vectorEdit = null;
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
  if (!o || selectedEntries().some((e) => e.locked)) return;
  const runStyle = [
    'font',
    'size',
    'color',
    'bold',
    'italic',
    'underline',
    'strike',
    'letterSpacing',
  ].includes(key);
  const paragraphStyle = key === 'align' || key === 'lineHeight';
  const differs = (style) =>
    style[key] !== value ||
    (key === 'font' && style.eastAsianFont && style.eastAsianFont !== value);
  const mixed = o.paragraphs?.some((p) =>
    runStyle
      ? differs(p.base) || p.runs.some(differs)
      : paragraphStyle && p[key] !== value
  );
  if (o[key] === value && !mixed) return;
  changeObject(o, () => {
    const intrinsic =
      o.autoWidth && (runStyle || paragraphStyle) && measureTextBox(o);
    o[key] = value;
    if (o.kind === 'callout') {
      if (key === 'cornerRadius') o.calloutShape = value ? 'roundRect' : 'rect';
      if (key === 'calloutShape' && value === 'rect' && o.cornerRadius > 0)
        o.calloutShape = 'roundRect';
    }
    if (key === 'font') {
      o.eastAsianFont = value;
      o.fontCharset = o.eastAsianCharset = '';
    }
    if (key === 'w' && o.autoWidth) o.autoWidth = false;
    if (
      ['dash', 'strokeWidth', 'startArrow', 'endArrow'].includes(key) &&
      !o.stroke
    )
      o.stroke = '#222521';
    for (const p of o.paragraphs || []) {
      if (paragraphStyle) p[key] = value;
      if (runStyle)
        for (const style of [p.base, ...p.runs]) {
          style[key] = value;
          if (key === 'font') {
            style.eastAsianFont = value;
            style.fontCharset = style.eastAsianCharset = '';
          }
        }
    }
    if (intrinsic) {
      const after = measureTextBox(o);
      o.w = Math.max(2, o.w + after.w - intrinsic.w);
      o.h = Math.max(1, o.h + after.h - intrinsic.h);
    }
  });
}
function changeObject(o, apply) {
  const editing = editor?.o === o ? editor : null;
  const before =
    editing?.creation?.before || numberAdjustment?.before || snapshot();
  const mark = editing?.remember();
  const textChanged = editing?.changed();
  if (editing) {
    const text = editing.read();
    editor = null;
    if (textChanged) {
      if (o.autoWidth) Object.assign(o, editing.size());
      editing.apply();
    }
    editing.close();
    if (o.kind === 'text' && !o.placeholder)
      o.name = text.slice(0, 40) || 'Text';
  }
  const changed = apply();
  const provisional = editing?.creation && !o.text;
  if (!provisional && (changed !== false || textChanged)) record(before);
  render();
  if (editing) {
    startText();
    editor?.restore(mark);
    if (editor && provisional) editor.creation = editing.creation;
  }
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
  render(false);
  $('.select-slide.active')?.scrollIntoView({ block: 'nearest' });
  if (overview)
    $('.sorter [data-slide="' + i + '"]')?.scrollIntoView({ block: 'nearest' });
}
function addObject(o) {
  change(() => {
    active().items.push(o);
    setSelection([o.id]);
    tab = 'design';
    tool = 'pointer';
  });
}
function measureTextBox(object, maxWidth) {
  const node = itemNode(object, assets, true);
  const box = measureTextElement(node.querySelector('.item-text'), maxWidth);
  return {
    w: Math.max(2, box.w),
    h: Math.max(object.size * singleLine, box.h),
  };
}

function visibleSlide() {
  const paper = $('.artboard').getBoundingClientRect();
  const view = $('.viewport').getBoundingClientRect();
  const left = Math.max(0, (view.left - paper.left) / scale);
  const right = Math.min(deck.w, (view.right - paper.left) / scale);
  const top = Math.max(0, (view.top - paper.top) / scale);
  const bottom = Math.min(deck.h, (view.bottom - paper.top) / scale);
  if (right <= left || bottom <= top)
    return { x: 0, y: 0, w: deck.w, h: deck.h };
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const clipboardAvailable = (target) =>
  !busy &&
  !editor &&
  !drag &&
  !document.querySelector('dialog[open]') &&
  !target?.closest?.('input,textarea,select,[contenteditable="true"]');

const clipboard = objectClipboard({
  available: clipboardAvailable,
  destination: active,
  async insertExternal({ images, text }, destination) {
    if (
      destination !== active() ||
      overview ||
      !clipboardAvailable(document.activeElement)
    )
      return;
    const originalDeck = deck;
    const visible = visibleSlide();
    const center = {
      x: visible.x + visible.w / 2,
      y: visible.y + visible.h / 2,
    };
    let items, media;
    if (images?.length) {
      ({ items, assets: media } = await readClipboardImages(
        images,
        deck,
        center
      ));
      if (
        deck !== originalDeck ||
        destination !== active() ||
        overview ||
        !clipboardAvailable(document.activeElement)
      )
        return;
    } else if (text) {
      const object = textItem(text, 0, 0, 2, 0, defaultTextSize, {
        font: 'Yu Gothic',
      });
      Object.assign(
        object,
        measureTextBox(object, Math.max(object.size, deck.w * 0.85))
      );
      // When zoomed into the slide, keep the start of a large paragraph in view.
      const x = Math.max(visible.x, center.x - object.w / 2);
      const y = Math.max(visible.y, center.y - object.h / 2);
      object.x = Math.max(0, Math.min(deck.w - object.w, x));
      object.y = Math.max(0, Math.min(deck.h - object.h, y));
      items = [object];
    } else return;
    change(() => {
      if (media) Object.assign(assets, media);
      destination.items.push(...items);
      pickedSlides.clear();
      setSelection(items.map((object) => object.id));
      tool = 'pointer';
    });
  },
  capture() {
    if (selectionScope === 'slides' || overview)
      return captureSlides(deck, slideIds(), base, assets, documentId);
    const slide = active();
    const items = copiesOnSlide(slide.items, selectedIds(), (o) =>
      captureOfficeObject(o, slide, base)
    );
    if (!items.length) return null;
    return {
      items,
      media: captureClipboardMedia(items, assets),
      from: active().id,
    };
  },
  insert(clip) {
    if (clip.slides) {
      const picked = slideIds();
      const at = deck.slides.findLastIndex((s) => picked.has(s.id)) + 1;
      const slides = pasteSlides(
        clip,
        base,
        assets,
        documentId,
        deck.slides[at - 1].sectionId
      );
      change(() => {
        deck.slides.splice(at, 0, ...slides);
        index = slideAnchor = at;
        pickedSlides = new Set(slides.map((s) => s.id));
        setSelection([]);
        selectionScope = 'slides';
        tool = 'pointer';
        railSlides.reveal(active());
        overviewSlides.reveal(active());
        pinPosition = null;
        pinning = false;
      });
      $(
        overview ? '.sorter .active' : '.rail .select-slide.active'
      )?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (overview) return;
    validateOfficeCopies(clip.items, base);
    const items = structuredClone(clip.items);
    const offset =
      clip.lastSlide === active().id
        ? clip.offset + 12
        : clip.from === active().id
          ? 12
          : 0;
    function identify(o) {
      o.id = uid();
      o.items?.forEach(identify);
    }
    for (const o of items) {
      identify(o);
      o.x += offset;
      o.y += offset;
    }
    pasteClipboardMedia(items, clip.media, assets);
    change(() => {
      active().items.push(...items);
      pickedSlides.clear();
      setSelection(items.map((o) => o.id));
      tool = 'pointer';
    });
    clip.lastSlide = active().id;
    clip.offset = offset;
  },
  onError: fail,
});
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
function startCrop() {
  const entry = selectedEntries()[0];
  if (
    cropEdit ||
    !entry ||
    entry.locked ||
    entry.hidden ||
    entry.object.kind !== 'image'
  )
    return;
  const item = $('.artboard [data-id="' + entry.object.id + '"]');
  cropEdit = editCrop({
    entry,
    item,
    assets,
    coordinates,
    finish: finishCrop,
    onDirty: status,
  });
}
function finishCrop(apply = true, keepInspector = false) {
  if (!cropEdit) return;
  const entry = layerEntries(active().items).get(cropEdit.object.id);
  const changes = cropEdit.close(apply);
  cropEdit = null;
  if (!entry || !changes) {
    status();
    return;
  }
  const before = snapshot();
  Object.assign(entry.object, changes);
  record(before);
  refreshCanvasItem(entry);
  drawSelection();
  renderThumbs();
  commentPins();
  if (!keepInspector) properties();
  else
    for (const key of ['x', 'y', 'w', 'h']) {
      const field = $('#properties [data-field="' + key + '"]');
      if (field) field.value = +(entry.object[key] * dimension(key)).toFixed(2);
    }
}
function refreshCanvasItem(entry) {
  while (entry.parent) entry = entry.parent;
  const o = entry.object;
  replaceLiveItem($('.artboard [data-id="' + o.id + '"]'), itemNode(o, assets, true));
}
function insertText(point) {
  finishText();
  const creation = { before: snapshot(), selected: selectedIds() };
  const height = defaultTextSize * singleLine;
  const o = textItem(
    '',
    point.x,
    Math.max(0, point.y - height / 2),
    2,
    height,
    defaultTextSize,
    { font: 'Yu Gothic', autoWidth: true }
  );
  active().items.push(o);
  setSelection([o.id]);
  tab = 'design';
  tool = 'pointer';
  render();
  startText();
  if (editor) editor.creation = creation;
}
function startText(event) {
  const entry = selectedEntries()[0],
    o = entry?.object;
  if (
    editor ||
    !o ||
    entry.hidden ||
    entry.locked ||
    !(hasTextFrame(o) || o.placeholder)
  )
    return;
  const item = $('.artboard [data-id="' + o.id + '"]');
  if (!item) return;
  editor = inlineText({
    item,
    object: o,
    event: event?.clientX !== undefined ? event : null,
    finish: finishText,
    toLocal(point, bounds) {
      const transform = entry.transform.multiply(shapeTransform(o));
      const delta = localDelta(
        transform,
        (point.x - bounds.x - bounds.width / 2) / scale,
        (point.y - bounds.y - bounds.height / 2) / scale
      );
      return {
        x: parseFloat(item.style.width) / 2 + delta.x,
        y: parseFloat(item.style.height) / 2 + delta.y,
      };
    },
    onInput() {
      if (o.autoWidth) {
        for (const [key, dim] of [
          ['w', 'width'],
          ['h', 'height'],
        ]) {
          const field = $('#properties [data-field="' + key + '"]');
          if (field)
            field.value = +(parseFloat(item.style[dim]) * designUnit).toFixed(
              2
            );
        }
      }
      status();
    },
  });
}
function finishText(cancel = false, deselect = false, passive = false) {
  if (!editor) return;
  const activeEditor = editor,
    { o, creation } = activeEditor;
  const value = activeEditor.read(),
    textChanged = activeEditor.changed(),
    measured = activeEditor.size();
  editor = null;
  const before = creation?.before || snapshot();
  if (creation && (cancel || !value.trim())) {
    active().items = active().items.filter((item) => item !== o);
    setSelection(creation.selected);
  } else if (!cancel && (creation || textChanged)) {
    activeEditor.apply();
    if (o.autoWidth) Object.assign(o, measured);
    if (o.kind === 'text' && !o.placeholder)
      o.name = value.slice(0, 40) || 'Text';
    record(before);
  }
  activeEditor.close();
  if (deselect) setSelection([]);
  // Preserve other canvas hit targets across the two clicks of a double-click.
  const entry = layerEntries(active().items).get(o.id);
  if (entry) refreshCanvasItem(entry);
  else activeEditor.input.closest('.item')?.remove();
  drawSelection();
  renderThumbs();
  commentPins();
  if (!passive) properties();
  status();
}
// Canvas pointer handlers normally prevent the browser's focus change. Commit
// first so clicking empty space can release both the caret and the selection.
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!e.target.closest('.crop-source,.crop-actions'))
      finishCrop(true, !!e.target.closest('#properties'));
    if (!editor || editor.input.contains(e.target)) return;
    const designControl =
      tab === 'design' &&
      e.target.closest('#properties,.inspector [data-action="design"]');
    if (designControl || e.target.closest('dialog')) {
      editor.remember();
      // WebKit can blur the editor to the body when clicking an inspector button.
      if (
        designControl &&
        !editor.composing &&
        !e.target.closest('input,select,textarea')
      )
        e.preventDefault();
      return;
    }
    if (editor.composing) {
      editor.input.blur();
      return;
    }
    if (e.target.closest('.callout-tip')) return;
    if (e.target.closest('.stage')) finishText(false, true);
    else {
      // Keep the clicked navigator or command mounted until its click handler runs.
      finishText(false, true, true);
      document.addEventListener(
        'click',
        () =>
          setTimeout(() => {
            if (!editor) properties();
          }, 0),
        { once: true, capture: true }
      );
    }
  },
  true
);
function menu(anchor, rows, point) {
  $('.menu')?.remove();
  const m = el('div', 'menu');
  m.setAttribute('role', 'menu');
  m.innerHTML = rows
    .map(
      ([k, label, glyph, key]) =>
        `<button data-action="${k}" role="menuitem">${icon(glyph, 15)}${label}<kbd>${platform.shortcutLabel(key)}</kbd></button>`
    )
    .join('');
  document.body.append(m);
  const b = anchor.getBoundingClientRect();
  m.style.left =
    Math.max(4, Math.min(point?.x ?? b.left, innerWidth - m.offsetWidth - 6)) +
    'px';
  m.style.top =
    Math.max(
      4,
      Math.min(point?.y ?? b.bottom + 4, innerHeight - m.offsetHeight - 8)
    ) + 'px';
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
  const revision = currentRevision;
  noteRevision = null;
  const changes = exportDeck(deck, base, assets);
  const output = await platform.savePackage(
    base,
    as ? null : path,
    fileTitle(),
    changes
  );
  if (!output) return false;
  path = output;
  refreshSharing();
  savedRevision = revision;
  status();
  toast('Presentation saved.');
  return true;
}
async function allowClose() {
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
  if (result === 'save')
    return (await save(false)) && currentRevision === savedRevision;
  return result === 'discard';
}
function reset(next, nextBase, nextTitle, nextPath) {
  const previous = base;
  const previousAssets = Object.values(assets);
  documentId = uid();
  base = nextBase;
  overview = false;
  selectionScope = 'canvas';
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
  refreshSharing();
  history = [];
  future = [];
  currentRevision = savedRevision = ++serial;
  setSelection([]);
  index = 0;
  tool = 'pointer';
  zoom = 'fit';
  panOrigin = null;
  tab = 'design';
  render();
  platform.release(previous, previousAssets);
}
async function newDocument() {
  const file = await openTemplate();
  if (!file) {
    const next = blankDeck();
    if (platform.native || location.hash === '#new')
      next.slides = [layoutOptions(null, next, next.slides[0])[0].slide];
    reset(next, null, 'untitled', null);
    return;
  }
  try {
    const imported = importDeck(file.parts);
    const original = structuredClone(imported.deck);
    imported.deck.slides.forEach(setTitleSpacing);
    reset(
      imported.deck,
      { ...file, ...imported, deck: original },
      'untitled',
      null
    );
  } catch (error) {
    await platform.release(file);
    throw error;
  }
}
function chooseSlide(i, event) {
  selectionScope = 'slides';
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
    if (selectionScope !== 'slides' || !slideIds().has(deck.slides[i].id)) {
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
    browser.dragPreview(e, tile, ids);
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
bindLayerReordering(
  $('#properties'),
  () => layerEntries(active().items),
  selectedIds,
  change
);
bindSlideList($('.thumbs'), railSlides);
bindSlideList($('.sorter'), overviewSlides);
function objectMenu(e) {
  if (
    busy ||
    e.target.closest(
      'input,textarea,[contenteditable="true"],.sorter,.floating-tools'
    )
  )
    return;
  const row = e.target.closest('[data-layer-row]'),
    item = e.target.closest('[data-id]');
  const layerPane = tab === 'layers' && e.target.closest('#properties');
  if (!layerPane && !e.target.closest('.viewport')) return;
  e.preventDefault();
  finishText();
  const hit =
    item && canvasEntry(layerEntries(active().items), item.dataset.id, e.metaKey || e.ctrlKey);
  const id =
    row?.dataset.layerRow ||
    hit?.object.id ||
    (e.target.closest('.selection') && selection);
  if (id && !selectedIds().includes(id)) select(id);
  if (!id) select(null);
  selectionScope = 'canvas';
  const entries = selectedEntries(),
    o = selected(),
    rows = [];
  if (entries.length === 1 && !entries[0].locked) {
    if (hasTextFrame(o) || o.placeholder)
      rows.push(['editText', 'Edit text', 'text']);
    if (vectorKinds.has(o.kind) && !o.placeholder)
      rows.push(['editPath', 'Edit path', 'path']);
    if (o.kind === 'image' && !entries[0].hidden)
      rows.push(['cropImage', 'Crop image…', 'crop']);
    if (o.kind === 'image' || o.kind === 'video')
      rows.push([
        'replaceMedia',
        o.kind === 'image' ? 'Replace image…' : 'Replace video…',
        o.kind,
      ]);
  }
  if (canGroup(entries)) rows.push(['group', 'Group selection', 'group', '⌘G']);
  if (entries.some((entry) => !entry.locked && entry.object.kind === 'group'))
    rows.push(['ungroup', 'Ungroup', 'ungroup', '⇧⌘G']);
  if (entries.length) {
    if (entries.every((entry) => !entry.locked))
      rows.push(['flipHorizontal', 'Flip horizontal', 'flipHorizontal', '⇧H']);
    rows.push(['copyObjects', 'Copy', 'copy', '⌘C']);
    if (reorderLayers(entries, null, 'front'))
      rows.push(['front', 'Bring to front', 'layers']);
    if (reorderLayers(entries, null, 'back'))
      rows.push(['back', 'Send to back', 'layers']);
    rows.push([
      'toggleLayerVisibility',
      entries.every((x) => x.object.hidden) ? 'Show' : 'Hide',
      'eye',
    ]);
    rows.push([
      'toggleLayerLock',
      entries.every((x) => x.object.locked) ? 'Unlock' : 'Lock',
      'lock',
    ]);
  }
  rows.push(['pasteObjects', 'Paste', 'paste', '⌘V']);
  rows.push(['selectionComment', 'Add comment…', 'comment']);
  if (entries.some((entry) => !entry.locked))
    rows.push(['delete', 'Delete', 'delete']);
  menu(row || $('.artboard'), rows, { x: e.clientX, y: e.clientY });
}
$('.stage').addEventListener('contextmenu', objectMenu);
$('.stage').addEventListener('drop', () => finishCrop(), true);
$('#properties').addEventListener('contextmenu', objectMenu);
bindPinch($('.stage'), zoomAt);
if (platform.native)
  window.addEventListener(
    'purepoint-magnify',
    ({ detail: { factor, x, y } }) => {
      if (
        !busy &&
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
      selectComment(pin.dataset.pin, true);
      return;
    }
    if (focusComment) {
      focusComment = null;
      commentPins();
    }
    if (pinning) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const hit = e.target.closest('[data-id]');
      pinPosition = anchorAt(
        layerEntries(active().items).get(hit?.dataset.id),
        coordinates(e)
      );
      pinning = false;
      commentPins();
      properties();
      $('.comment-form textarea')?.focus();
    }
  },
  true
);

async function loadDocument(file) {
  try {
    const loaded = importDeck(file.parts);
    reset(
      loaded.deck,
      { ...file, ...loaded, deck: structuredClone(loaded.deck) },
      platform.fileName(file.path),
      file.path
    );
  } catch (error) {
    await platform.release(file);
    throw error;
  }
}
function presentationSnapshot() {
  const { id, bg, back } = active();
  let { items } = active();
  if (editor?.changed()) {
    const draft = structuredClone(editor.o);
    editor.apply(draft);
    if (draft.autoWidth) Object.assign(draft, editor.size());
    const withDraft = (layers) => layers.map((item) => {
      if (item.id === draft.id) return draft;
      return item.items ? { ...item, items: withDraft(item.items) } : item;
    });
    items = withDraft(items);
  }
  if (drag?.moved && drag.mode === 'draw-vector')
    items = [...items, drag.draft];
  return {
    w: deck.w, h: deck.h,
    number: pageNumbers(deck).get(id) ?? null,
    slide: { id, bg, back, items },
    playback: slidePlayback($('.artboard > .scene')),
    assets,
  };
}
function movePresentation(step) {
  if (busy || (step !== 1 && step !== -1)) return;
  let next = index + step;
  while (deck.slides[next]?.hidden) next += step;
  switchSlide(next);
}
async function execute(id, button) {
  finishCrop();
  closeColorPicker();
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
  if (id === 'copyObjects' || id === 'copySlides') return clipboard.copy();
  if (id === 'pasteSlides') return clipboard.paste(true);
  if (id === 'pasteObjects') return clipboard.paste();
  if (id === 'copyShareLink') return shareDocument();
  if (id === 'overview' || id === 'canvasView') {
    setOverview(id === 'overview' ? !overview : false);
    return;
  }
  if (id === 'navigator') {
    navigatorOpen = !navigatorOpen;
    localStorage.setItem(
      'pure-point.navigator',
      navigatorOpen ? 'open' : 'closed'
    );
    updateChrome();
    return;
  }
  if (id === 'script') {
    scriptOpen = !scriptOpen;
    updateChrome();
    if (scriptOpen) scriptField.focus();
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
      ['copySlides', 'Copy slides', 'copy', '⌘C'],
      ['pasteSlides', 'Paste slides', 'paste', '⌘V'],
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
  if (id === 'delete' && editor?.creation) {
    finishText(true);
    return;
  }
  if (
    !Object.hasOwn(textActions, id) &&
    !id.startsWith('objectAlign-') &&
    id !== 'design'
  )
    finishText();
  if (
    [
      'save',
      'saveAs',
      'open',
      'close',
      'new',
      'quit',
      'pdf',
      'tool-image',
      'tool-video',
      'tool-embed',
    ].includes(id)
  ) {
    busy = true;
    savingDocument = id === 'save' || id === 'saveAs';
    status();
    try {
      if (id === 'save' || id === 'saveAs') await save(id === 'saveAs');
      if (id === 'open' || id === 'new') {
        const reuse = id === 'open' && !path && currentRevision === savedRevision &&
          !Array.from(commentDrafts.values()).some((draft) => draft.trim());
        const file = await platform.openWindow(id === 'open', reuse);
        if (file) await loadDocument(file);
      }
      if (id === 'pdf') {
        deck.slides.filter((slide) => !slide.hidden).forEach(loadSlideFonts);
        if (await exportPDF(deck, base, assets, fileTitle()))
          toast('PDF exported.');
      }
      if ((id === 'close' || id === 'quit') && (await allowClose())) {
        await clipboard.dispose();
        await platform.release(base, Object.values(assets));
        await platform.closeWindow(id === 'quit');
      }
      if (id === 'tool-image') await mediaEditor.insertImage();
      if (id === 'tool-video') await mediaEditor.insertVideo();
      if (id === 'tool-embed') await mediaEditor.insertEmbed();
    } finally {
      savingDocument = false;
      busy = false;
      status();
    }
    return;
  }
  if (id.startsWith('tool-')) {
    setTool(id.slice(5));
    return;
  }
  if (id === 'addSlide') {
    const previous = active();
    const options = layoutOptions(base, deck, previous);
    options.forEach(({ slide }) => loadSlideFonts(slide));
    const next = await chooseLayout(options, deck, assets);
    if (!next) return;
    change(() => {
      index++;
      next.sectionId = previous.sectionId;
      deck.slides.splice(index, 0, next);
      pickedSlides.clear();
      slideAnchor = index;
      setSelection([]);
      tool = 'pointer';
    });
    $('.select-slide.active')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (id === 'pageNumber') {
    change(() => {
      deck.showPageNumbers = !deck.showPageNumbers;
    });
    return;
  }
  if (id.startsWith('objectAlign-')) {
    const object = selected();
    if (!object) return;
    const direction = id.slice('objectAlign-'.length);
    changeObject(object, () => {
      const moves = alignmentMoves(selectedEntries(), direction, deck);
      for (const { object, delta } of moves) {
        object.x += delta.x;
        object.y += delta.y;
      }
      return Boolean(moves.length);
    });
    return;
  }
  if (id === 'front' || id === 'back') {
    const apply = reorderLayers(selectedEntries(), null, id);
    if (apply) change(apply);
    return;
  }
  if (id === 'selectionComment') {
    tab = 'comments';
    inspectorOpen = true;
    pinning = false;
    pinPosition = null;
    updateChrome();
    properties();
    commentPins();
    $('.comment-form textarea')?.focus();
    return;
  }
  if (id === 'editPath') {
    const entry = selectedEntries()[0];
    if (entry && !entry.locked && vectorKinds.has(entry.object.kind)) {
      vectorEdit = { id: entry.object.id, selected: null };
      drawSelection();
      properties();
    }
    return;
  }
  if (id === 'editText') {
    startText();
    return;
  }
  if (id === 'flipHorizontal') {
    const entries = selectedEntries();
    if (entries.length && entries.every((entry) => !entry.locked))
      change(() => {
        for (const { object } of entries) object.flipH = !object.flipH;
      });
    return;
  }
  if (id === 'cropImage') {
    startCrop();
    return;
  }
  if (id === 'replaceMedia') {
    await mediaEditor.replaceMedia(selected());
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
    change(() => {
      const remainingBefore = deck.slides
        .slice(0, index)
        .filter((s) => !ids.has(s.id)).length;
      deck.slides = deck.slides.filter((s) => !ids.has(s.id));
      if (!deck.slides.length) deck.slides.push(slide());
      index = remainingBefore;
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
  if (id === 'present') {
    await presentation.open();
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
  if (id === 'underline' || id === 'strike') {
    const active = objectDecoration(selected(), id);
    updateObject(
      id,
      id === 'underline'
        ? active
          ? 'none'
          : 'sng'
        : active
          ? 'noStrike'
          : 'sngStrike'
    );
  }
  if (id.startsWith('align')) updateObject('align', id.slice(5));
}
const run = (id, b) => execute(id, b).catch(fail);
document.addEventListener('click', (e) => {
  if (busy || e.target.closest('dialog')) return;
  const swatchButton = e.target.closest('button[data-color]');
  if (swatchButton) {
    editPaint(swatchButton);
    return;
  }
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
bindNumberFields($('#properties'), {
  available: () => !busy,
  begin(input) {
    numberAdjustment = {
      before: input.dataset.scope === 'grid'
        ? null
        : editor?.creation?.before || snapshot(),
    };
  },
  preview(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },
  finish(input, keepFieldFocus) {
    const { before } = numberAdjustment;
    numberAdjustment = null;
    if (before && !editor?.creation && before.deck !== JSON.stringify(deck))
      record(before);
    renderThumbs();
    properties();
    if (editor && !keepFieldFocus) {
      editor.resume();
      return;
    }
    $(
      '#properties input[aria-label="' + CSS.escape(input.ariaLabel) + '"]'
    )?.focus({ preventScroll: true });
  },
});
document.addEventListener('change', (e) => {
  if (busy) return;
  const input = e.target;
  if (input.hasAttribute('data-line-spacing')) {
    updateObject(
      'lineHeight',
      input.value.endsWith('px') ? input.value : Number(input.value)
    );
    return;
  }
  if (
    input.dataset.vectorField === 'curveMode' ||
    input.hasAttribute('data-curve-percent')
  ) {
    const entry = selectedEntries()[0];
    const percent = input.dataset.vectorField
      ? input.value === 'curve'
        ? 25
        : null
      : input.valueAsNumber;
    if (
      entry &&
      !entry.locked &&
      (percent === null || Number.isFinite(percent))
    )
      changeObject(entry.object, () => {
        setCurvature(entry.object, vectorEdit?.selected, percent);
      });
    else properties();
    return;
  }
  if (input.dataset.vectorField) {
    updateObject(input.dataset.vectorField, input.value);
    return;
  }
  if (input.id === 'zoom') {
    chooseZoom(input.value);
    return;
  }
  if (input.id === 'slide-size') {
    const size = slideSizes[Number(input.value)];
    if (size && !sameSlideSize(deck, size))
      change(() => {
        resizeDeck(deck, size);
        zoom = 'fit';
        panOrigin = null;
      });
    return;
  }
  const { field: key, scope, color, font } = input.dataset;
  if (key) {
    if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) {
      properties();
      editor?.resume();
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
    } else if (key === 'rotation') {
      const degrees = wrapAngle(v);
      if (!numberAdjustment) input.value = degrees;
      updateObject(key, -degrees);
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
  if (drag && drag.id !== e.pointerId) return;
  if (
    busy ||
    e.button !== 0 ||
    e.target.closest(
      '.crop-source,.crop-actions,.floating-tools,textarea,.text-edit,.sorter,.comment-pin,.video-controls,[data-media-control],.media-controls,iframe'
    )
  )
    return;
  const art = e.target.closest('.artboard'),
    p = coordinates(e);
  if (!art && !e.target.closest('.world,.viewport')) return;
  selectionScope = 'canvas';
  if (document.activeElement?.closest('.rail,.sorter'))
    document.activeElement.blur();
  if (pickedSlides.size) {
    pickedSlides.clear();
    railSlides.highlight(index, slideIds());
  }
  if (tool !== 'pointer' && !art) return;
  if (tool !== 'pointer') {
    e.preventDefault();
    if (tool === 'text') {
      insertText(p);
      return;
    }
    if (['rect', 'ellipse', 'line', 'callout'].includes(tool)) {
      drag = {
        mode: 'draw-vector',
        id: e.pointerId,
        start: p,
        draft: createAt(tool, p),
        targets: snapTargets(deck, active(), null, grid),
        moved: false,
      };
      $('.stage').setPointerCapture(e.pointerId);
    }
    return;
  }
  if (e.target.closest('.callout-tip')) {
    finishText();
    const entry = selectedEntries()[0];
    if (entry?.object.kind !== 'callout' || entry.locked) return;
    const o = entry.object;
    drag = {
      id: e.pointerId,
      mode: 'callout-tip',
      start: p,
      moved: false,
      o,
      inverse: entry.transform.multiply(shapeTransform(o)).inverse(),
      initial: { x: o.calloutX, y: o.calloutY },
    };
    e.preventDefault();
    return;
  }
  const pointHandle = e.target.closest('[data-vertex]');
  if (pointHandle && vectorEdit) {
    const entry = selectedEntries()[0];
    if (!entry || entry.locked || entry.hidden) return;
    const key = {
      path: Number(pointHandle.dataset.path),
      vertex: Number(pointHandle.dataset.vertex),
      arm: pointHandle.dataset.arm,
    };
    const inverse = entry.transform
      .multiply(shapeTransform(entry.object))
      .inverse();
    const initial = structuredClone(entry.object),
      n = localContours(initial)[key.path].nodes[key.vertex];
    vectorEdit.selected = { path: key.path, vertex: key.vertex };
    drag = {
      mode: 'vertex',
      id: e.pointerId,
      start: p,
      key,
      initial,
      o: entry.object,
      inverse,
      origin: inverse.transformPoint(p),
      anchor: key.arm ? n[key.arm] : n,
      moved: false,
      targets: snapTargets(deck, active(), entry.object.id, grid),
    };
    e.preventDefault();
    $('.stage').setPointerCapture(e.pointerId);
    drawSelection();
    properties();
    return;
  }
  if (e.target.closest('[data-segment]')) {
    e.preventDefault();
    return;
  }
  const spacingHandle = e.target.closest('[data-spacing-handle]');
  if (spacingHandle) {
    const spacing = spacingAt(spacingHandle);
    if (!spacing) return;
    drag = {
      mode: 'spacing',
      id: e.pointerId,
      start: p,
      ...spacing,
      moved: false,
    };
    e.preventDefault();
    $('.stage').setPointerCapture(e.pointerId);
    return;
  }
  if (vectorEdit) {
    if (e.target.closest('[data-id]')?.dataset.id === vectorEdit.id) {
      e.preventDefault();
      return;
    }
    vectorEdit = null;
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
    hit = canvasEntry(all, hit.object.id, e.metaKey || e.ctrlKey);
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
      ...(entry.object.kind === 'text'
        ? { autoWidth: entry.object.autoWidth }
        : {}),
    },
  }));
  const stationary = stationaryBounds(all, entries);
  drag = {
    id: e.pointerId,
    mode: 'objects',
    start: p,
    sources,
    box: selectionBounds(entries),
    moving: entries.map(layerBounds),
    stationary,
    handle: handle?.dataset.handle,
    targets: snapTargets(deck, { items: handle ? stationary : [] }, null, grid),
    collapse: !added && entries.length > 1 ? hit?.object.id : null,
    moved: false,
  };
  if (handle) {
    const stage = $('.stage');
    stage.style.setProperty('--canvas-resize-cursor', handle.style.cursor);
    stage.classList.add('resizing-object');
  }
});
function guides(x, y) {
  const sc = $('.artboard>.scene');
  sc.querySelector('.guide-layer')?.remove();
  if (x == null && y == null) return;
  const layer = el('div', 'guide-layer');
  for (const [v, isX] of [
    [x, true],
    [y, false],
  ])
    if (v != null) {
      const n = el('i', 'guide-line ' + (isX ? 'v' : 'h'));
      if (typeof v === 'number') {
        n.style[isX ? 'left' : 'top'] = v + 'px';
      } else {
        n.classList.add('object-guide');
        Object.assign(n.style, {
          left: (isX ? v.position : v.start) + 'px',
          top: (isX ? v.start : v.position) + 'px',
          [isX ? 'height' : 'width']: v.end - v.start + 'px',
        });
      }
      layer.append(n);
    }
  sc.append(layer);
}
function moveObjects(sources, x, y) {
  for (const { entry, from, multiplier = 1 } of sources) {
    const delta = localDelta(entry.transform, x * multiplier, y * multiplier);
    const o = entry.object;
    o.x = from.x + delta.x;
    o.y = from.y + delta.y;
    const node = $('.artboard [data-id="' + o.id + '"]');
    if (node) Object.assign(node.style, { left: o.x + 'px', top: o.y + 'px' });
  }
}
function spacingAt(handle) {
  const axis = handle.dataset.spacingHandle;
  const index = Number(handle.dataset.spacingGap);
  const spacing = objectSpacing(selectedEntries(), axis)[0];
  if (!spacing?.gaps[index]) return null;
  return {
    axis,
    divider: index + 1,
    minimum: Math.min(...spacing.gaps.map(({ gap }) => gap)),
    sources: spacing.bands.slice(1).flatMap(({ entries }, i) =>
      entries.map((entry) => {
        const { x, y } = entry.object;
        return { entry, from: { x, y }, multiplier: i + 1 };
      })
    ),
  };
}
$('.stage').addEventListener('keydown', (e) => {
  const axis = e.target.dataset.spacingHandle;
  if (!axis || busy || drag) return;
  const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  const direction = keys.indexOf(e.key);
  if (direction < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const spacing = spacingAt(e.target);
  if (!spacing) return;
  const { minimum, sources } = spacing;
  const step = (e.shiftKey ? 10 : 1) / designUnit;
  const distance = Math.max(-minimum, direction ? step : -step);
  if (!distance) return;
  change(() =>
    moveObjects(sources, axis === 'x' ? distance : 0, axis === 'y' ? distance : 0)
  );
  const index = e.target.dataset.spacingGap;
  $(`[data-spacing-handle="${axis}"][data-spacing-gap="${index}"]`)?.focus({
    preventScroll: true,
  });
});
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const p = coordinates(e),
    dx = p.x - drag.start.x,
    dy = p.y - drag.start.y;
  const spacingDelta = drag.axis === 'x' ? dx : dy;
  const axis = drag.handle?.length === 1
    ? ('we'.includes(drag.handle) ? 'x' : 'y')
    : null;
  const entry = drag.handle && drag.sources[0].entry;
  const transform = entry && entry.transform.multiply(shapeTransform(entry.object));
  const resize = transform && localDelta(transform, dx, dy);
  if (!drag.moved) {
    let distance = drag.mode === 'spacing'
      ? Math.abs(spacingDelta)
      : Math.hypot(dx, dy);
    if (axis === 'x') distance = Math.abs(resize.x) * Math.hypot(transform.a, transform.b);
    if (axis === 'y') distance = Math.abs(resize.y) * Math.hypot(transform.c, transform.d);
    if (distance * scale < 3) return;
    // A simple click selects a layer without making a document undo entry.
    if (['objects', 'vertex', 'callout-tip', 'spacing'].includes(drag.mode))
      drag.before = snapshot();
    drag.moved = true;
    $('.stage').setPointerCapture(e.pointerId);
  }
  if (drag.mode === 'spacing') {
    const horizontal = drag.axis === 'x';
    const distance = Math.max(-drag.minimum, spacingDelta / drag.divider);
    moveObjects(
      drag.sources, horizontal ? distance : 0, horizontal ? 0 : distance
    );
    drawSelection();
    return;
  }
  if (drag.mode === 'callout-tip') {
    const { o, inverse, initial } = drag;
    const delta = inverse.transformPoint({ x: dx, y: dy, w: 0 });
    o.calloutX = Math.round((initial.x ?? -20833) + (100000 * delta.x) / o.w);
    o.calloutY = Math.round((initial.y ?? 62500) + (100000 * delta.y) / o.h);
    refreshCanvasItem(selectedEntries()[0]);
    drawSelection();
    return;
  }
  if (drag.mode === 'draw-vector' || drag.mode === 'vertex') {
    const snap = grid.snap && !e.altKey && !e.shiftKey;
    const sx = snap ? snapAxis([p.x], drag.targets.x, 5 / scale) : { delta: 0 };
    const sy = snap ? snapAxis([p.y], drag.targets.y, 5 / scale) : { delta: 0 };
    const end = { x: p.x + sx.delta, y: p.y + sy.delta };
    if (drag.mode === 'draw-vector') {
      sizeDraft(drag.draft, drag.start, end, e.shiftKey);
      const preview = itemNode(drag.draft, assets);
      preview.classList.add('vector-draft');
      const paper = $('.artboard>.scene');
      paper.querySelector('.vector-draft')?.remove();
      paper.append(preview);
    } else {
      const pos = drag.inverse.transformPoint(end);
      moveVertex(
        drag.o,
        drag.initial,
        drag.key,
        {
          x: drag.anchor.x + pos.x - drag.origin.x,
          y: drag.anchor.y + pos.y - drag.origin.y,
        },
        e.altKey
      );
      $('.artboard [data-id="' + drag.o.id + '"]')?.replaceWith(
        itemNode(drag.o, assets, true)
      );
      drawSelection();
    }
    guides(sx.guide, sy.guide);
    return;
  }
  if (drag.mode === 'marquee') {
    const box = {
      x: Math.min(drag.start.x, p.x),
      y: Math.min(drag.start.y, p.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
    const hits = [];
    if (box.w > 0 && box.h > 0) {
      const all = layerEntries(active().items);
      for (const item of active().items) {
        const entry = all.get(item.id);
        if (entry.hidden || entry.locked) continue;
        const b = layerBounds(entry);
        if (
          b.x < box.x + box.w &&
          b.y < box.y + box.h &&
          b.x + b.w > box.x &&
          b.y + b.h > box.y
        ) hits.push(item.id);
      }
    }
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
    const move = snap
      ? snapMovement(drag.moving, drag.stationary, box, targets, dx, dy, scale)
      : { x: dx, y: dy };
    gx = move.guideX;
    gy = move.guideY;
    moveObjects(sources, move.x, move.y);
  } else {
    const { entry, from } = sources[0],
      o = entry.object;
    const a = (o.rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const west = handle.includes('w') !== !!o.flipH,
      north = handle.includes('n') !== !!o.flipV;
    let lx = axis !== 'y' ? resize.x * (o.flipH ? -1 : 1) : 0;
    let ly = axis !== 'x' ? resize.y * (o.flipV ? -1 : 1) : 0;
    if (snap && !entry.parent && Math.abs(a) < 0.0001) {
      if (axis !== 'y') {
        const sx = snapAxis([from.x + (west ? 0 : from.w) + lx], targets.x, 5 / scale);
        lx += sx.delta;
        gx = sx.guide;
      }
      if (axis !== 'x') {
        const sy = snapAxis(
          [from.y + (north ? 0 : from.h) + ly],
          targets.y,
          5 / scale
        );
        ly += sy.delta;
        gy = sy.guide;
      }
    }
    Object.assign(
      o,
      resizeDimensions(o, from, west ? -lx : lx, north ? -ly : ly, e.shiftKey, axis)
    );
    if (o.kind === 'text') o.autoWidth = false;
    // A proportional edge resize expands on both sides of the perpendicular
    // axis, keeping the midpoint of the opposite edge stationary.
    const mx = axis === 'y' ? 0 : ((o.w - from.w) * (west ? -1 : 1)) / 2,
      my = axis === 'x' ? 0 : ((o.h - from.h) * (north ? -1 : 1)) / 2;
    o.x = from.x + from.w / 2 + mx * c - my * s - o.w / 2;
    o.y = from.y + from.h / 2 + mx * s + my * c - o.h / 2;
    replaceLiveItem($('.artboard [data-id="' + o.id + '"]'), itemNode(o, assets, true));
  }
  drawSelection();
  guides(gx, gy);
});
function endDrag(e, cancel) {
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  const stage = $('.stage');
  if (d.handle) {
    stage.style.removeProperty('--canvas-resize-cursor');
    stage.classList.remove('resizing-object');
  }
  if (stage.hasPointerCapture(e.pointerId))
    stage.releasePointerCapture(e.pointerId);
  if (d.mode === 'draw-vector') {
    $('.artboard .vector-draft')?.remove();
    $('.artboard .guide-layer')?.remove();
    if (
      !cancel &&
      d.moved &&
      (d.draft.kind === 'line'
        ? Math.max(d.draft.w, d.draft.h) > 0
        : d.draft.w > 0 && d.draft.h > 0)
    )
      addObject(d.draft);
    return;
  }
  if (d.mode === 'callout-tip') {
    if (d.moved) {
      if (cancel)
        Object.assign(d.o, { calloutX: d.initial.x, calloutY: d.initial.y });
      else record(d.before);
      render();
    }
    return;
  }
  if (d.mode === 'vertex') {
    if (d.moved) {
      if (cancel) {
        delete d.o.contours;
        delete d.o.paths;
        Object.assign(d.o, d.initial);
      } else record(d.before);
      render();
    }
    return;
  }
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
    else if (
      d.mode !== 'spacing' ||
      d.sources.some(({ entry, from }) => entry.object.x !== from.x || entry.object.y !== from.y)
    ) record(d.before);
    render();
  } else if (d.collapse && !cancel) select(d.collapse);
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
$('.stage').addEventListener('dblclick', (e) => {
  const n = e.target.closest('[data-id]');
  if (
    e.target.closest(
      '.crop-source,.crop-actions,textarea,.text-edit,.comment-pin,.floating-tools,.sorter'
    ) ||
    busy
  )
    return;
  const segment = e.target.closest('[data-segment]');
  if (vectorEdit && segment) {
    const entry = selectedEntries()[0];
    if (!entry || entry.locked || entry.hidden) return;
    const pt = entry.transform
      .multiply(shapeTransform(entry.object))
      .inverse()
      .transformPoint(coordinates(e));
    const path = Number(segment.dataset.path);
    change(() => {
      const vertex = splitEdge(
        entry.object,
        path,
        Number(segment.dataset.segment),
        pt
      );
      vectorEdit.selected = { path, vertex };
    });
    return;
  }
  if (e.target.closest('[data-vertex],.callout-tip,[data-handle],[data-spacing-handle]')) return;
  if (n) {
    const entry = layerEntries(active().items).get(n.dataset.id);
    if (!entry || entry.hidden || entry.locked) return;
    const o = entry.object;
    select(o.id);
    if (entry.parent && groupChild !== o.id) {
      groupChild = o.id;
      e.preventDefault();
      return;
    }
    if (o.kind === 'callout' || (hasTextFrame(o) && e.target.closest('.item-text'))) {
      e.preventDefault();
      startText(e);
      return;
    }
    if (vectorKinds.has(o.kind) && !o.placeholder) {
      vectorEdit = { id: o.id, selected: null };
      drawSelection();
      properties();
      e.preventDefault();
      return;
    }
    if (o.kind === 'image') {
      e.preventDefault();
      startCrop();
      return;
    }
    if (o.kind === 'video') return;
    if (hasTextFrame(o) || o.placeholder) {
      e.preventDefault();
      startText(e);
    }
  } else if (e.target.closest('.artboard')) insertText(coordinates(e));
});
document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  // WebView2 also maps Ctrl+Y to redo inside editable fields.
  if (
    platform.windows && e.ctrlKey && !e.altKey && !e.metaKey &&
    !e.shiftKey && e.key.toLowerCase() === 'y'
  ) {
    e.preventDefault();
    return;
  }
  if (busy || document.querySelector('dialog[open]')) return;
  const editing = e.target.closest(
      'input,textarea,select,[contenteditable="true"]'
    ),
    cmd = platform.windows ? e.ctrlKey && !e.getModifierState('AltGraph') : e.metaKey || e.ctrlKey;
  if (!editing && !cmd && ['Delete', 'Backspace'].includes(e.key)) {
    const target = e.target.closest('[data-comment-id], [data-pin]');
    if (focusComment && (target?.dataset.commentId || target?.dataset.pin) === focusComment) {
      e.preventDefault();
      removeComment(focusComment);
      $('.comments-panel [aria-label="Place a comment pin"]')?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('.comments-panel')) return;
  }
  if (cropEdit && !cmd) {
    if (
      e.key === 'Escape' ||
      (e.key === 'Enter' && !e.target.closest('.crop-actions'))
    ) {
      e.preventDefault();
      finishCrop(e.key === 'Enter');
    }
    return;
  }
  if (vectorEdit && !editing) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      if (drag?.mode === 'vertex') endDrag({ pointerId: drag.id }, true);
      vectorEdit = null;
      drawSelection();
      properties();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const o = selected(),
        key = vectorEdit.selected;
      if (o && key) {
        const before = snapshot();
        if (deleteVertex(o, key)) {
          vectorEdit.selected = null;
          record(before);
          render();
        }
      }
      return;
    }
  }
  if (e.key === 'Escape' && drag?.mode === 'draw-vector') {
    e.preventDefault();
    endDrag({ pointerId: drag.id }, true);
    setTool('pointer');
    return;
  }
  if (e.key === 'Escape' && (drag?.mode === 'spacing' || drag?.handle)) {
    e.preventDefault();
    endDrag({ pointerId: drag.id }, true);
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
  const slidesFocused =
    overview ||
    selectionScope === 'slides' ||
    !!e.target.closest('[data-slide]');
  if (!editing && slidesFocused) {
    if (!cmd && ['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      run('deleteSlide');
      return;
    }
    if (cmd && !e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (slideIds().size > 1) run('newSection');
      return;
    }
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
    if (key === 'a' && (slidesFocused || e.target.closest('.rail'))) {
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
        w: platform.native && 'close',
        e: e.shiftKey && 'pdf',
        p: e.altKey && 'present',
      }[key];
    // The macOS menu handles its own accelerator even while a field has focus.
    if (id && !platform.nativeMac && !(editing && key === 'z')) {
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
    !slidesFocused &&
    !editor &&
    e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'h'
  ) {
    e.preventDefault();
    if (!e.repeat) run('flipHorizontal');
    return;
  }
  if (o && e.altKey && !e.shiftKey) {
    const direction = {
      KeyA: 'left',
      KeyH: 'hcenter',
      KeyD: 'right',
      KeyW: 'top',
      KeyV: 'vcenter',
      KeyS: 'bottom',
    }[e.code];
    if (direction) {
      e.preventDefault();
      run('objectAlign-' + direction);
      return;
    }
  }
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
    l: 'tool-line',
    o: 'tool-ellipse',
    g: 'gridVisible',
  }[e.key];
  if (id) {
    e.preventDefault();
    run(id);
  }
});
window.addEventListener('beforeunload', (e) => {
  if (
    !platform.native &&
    (currentRevision !== savedRevision ||
      editor?.changed() ||
      cropEdit?.changed())
  ) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('pointermove', () => {
  if (drag?.moved) presentation.publish();
});
$('.viewport').addEventListener('scroll', drawRulers);
new ResizeObserver(() => {
  sizing();
}).observe($('.stage'));
render();
const initialFonts = platform
  .getFonts()
  .then(async (list) => {
    fonts = list;
    // The first point-text measurement uses the same face as PowerPoint.
    await platform.loadTypeface('Yu Gothic', fonts);
    properties();
    const visible = new Set([active()]);
    for (const preview of document.querySelectorAll('[data-preview] > .scene')) {
      visible.add(deck.slides[Number(preview.parentElement.dataset.preview)]);
    }
    visible.forEach(loadSlideFonts);
  })
  .catch(fail);
platform.nativeEvents(run).then(async () => {
  try {
    const file = await platform.openPackage();
    if (file) await loadDocument(file);
    else await newDocument();
    await initialFonts;
  } catch (err) {
    await fail(err);
  } finally {
    busy = false;
    status();
  }
});
