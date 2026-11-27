import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { mediaReferences } from './clipboard-media.js';
import { native, fullScreen, getFonts } from './platform.js';
import { loadSlideFonts } from './slide-fonts.js';
import { el, icon, itemNode, scene } from './view.js';
import { pageNumberItem } from './page-numbers.js';
import './style.css';
import './vector.css';

const prefix = 'presentation-';
const ready = 'presentation-ready';
const closed = 'presentation-closed';
const update = 'presentation-update';
const navigate = 'presentation-navigate';

export function presentationControl(snapshot, move) {
  const owner = native ? getCurrentWindow() : null;
  const label = owner && prefix + owner.label;
  let popup, listening;
  let connected = false, scheduled = false, sending = false, pending = false;
  let lastFrame = '', lastAssets = new Map();

  function handshake() {
    connected = true;
    lastFrame = '';
    lastAssets.clear();
    publish();
  }

  if (!native) {
    window.addEventListener('message', (event) => {
      if (!popup || event.source !== popup || event.origin !== location.origin) return;
      if (event.data?.type === ready) handshake();
      if (event.data?.type === closed) connected = false;
      if (event.data?.type === navigate) move(event.data.payload);
    });
    window.addEventListener('pagehide', () => popup?.close());
  }

  async function open() {
    if (owner) {
      listening ??= Promise.all([
        owner.listen(ready, handshake),
        owner.listen(closed, () => { connected = false; }),
        owner.listen(navigate, ({ payload }) => move(payload)),
      ]);
      await listening;
      await invoke('open_presentation');
      return;
    }
    if (popup && !popup.closed) {
      popup.focus();
      return;
    }
    connected = false;
    const url = new URL(location.href);
    url.hash = 'presentation';
    popup = window.open(url, '_blank', 'popup,width=960,height=600');
    if (!popup) throw Error('Allow pop-up windows to open the presentation.');
  }

  function publish() {
    if (!connected) return;
    pending = true;
    if (scheduled || sending) return;
    scheduled = true;
    // Coalesce synchronous changes without relying on a visible editor window.
    queueMicrotask(async () => {
      scheduled = false;
      pending = false;
      if (!connected || (!owner && popup?.closed)) return;
      const { assets, ...frame } = snapshot();
      const signature = JSON.stringify(frame);
      const current = new Map();
      if (frame.slide)
        mediaReferences([...frame.slide.back, ...frame.slide.items], (item, key) => {
          const path = item[key];
          if (Object.hasOwn(assets, path)) current.set(path, assets[path]);
        });
      const media = [...current].filter(([path, asset]) => lastAssets.get(path) !== asset);
      const removed = [...lastAssets.keys()].filter((path) => !current.has(path));
      if (signature === lastFrame && !media.length && !removed.length) return;
      const payload = { ...frame, media, removed };
      lastFrame = signature;
      lastAssets = current;
      sending = true;
      try {
        if (owner) await emitTo(label, update, payload);
        else popup.postMessage({ type: update, payload }, location.origin);
      } catch (error) {
        lastFrame = '';
        lastAssets.clear();
        console.warn('Could not update the presentation:', error);
      } finally {
        sending = false;
        if (pending) publish();
      }
    });
  }
  return { open, publish };
}

export async function startPresentation() {
  document.title = 'Presentation — pure-point';
  const viewer = native ? getCurrentWindow() : null;
  const owner = viewer?.label.startsWith(prefix) ? viewer.label.slice(prefix.length) : null;
  const opener = window.opener;
  const send = (type, payload) =>
    owner ? emitTo(owner, type, payload) : opener?.postMessage({ type, payload }, location.origin);
  const host = el('main', 'present');
  const frame = el('div', 'present-frame');
  const controls = el('div', 'present-controls');
  const fullscreen = el('button', 'icon-btn');
  fullscreen.type = 'button';
  fullscreen.innerHTML = icon('fit');
  controls.append(fullscreen);
  host.append(frame, controls);
  document.querySelector('#app').replaceWith(host);

  let exitingFullscreen = false;
  let fullscreenOn = false;
  function updateFullscreen() {
    const label = fullscreenOn ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
    fullscreen.title = label;
    fullscreen.setAttribute('aria-label', label);
  }
  updateFullscreen();
  async function toggleFullscreen() {
    try {
      const next = !(viewer ? await viewer.isFullscreen() : document.fullscreenElement);
      exitingFullscreen = !next;
      await fullScreen(next);
      fullscreenOn = next;
      updateFullscreen();
    } catch (error) {
      console.warn('Could not toggle fullscreen:', error);
    } finally {
      exitingFullscreen = false;
    }
  }
  function close() {
    if (viewer) viewer.close().catch(console.warn);
    else window.close();
  }
  fullscreen.onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    if (fullscreenOn && !active && !exitingFullscreen) close();
    fullscreenOn = active;
    updateFullscreen();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'f' || event.key === 'F11') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (event.target.closest('button,input,iframe')) return;
    const step = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key) ? 1
      : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
    if (step) {
      event.preventDefault();
      send(navigate, step);
    }
  });

  let snapshot, fonts;
  const assets = Object.create(null);
  function sizeFrame() {
    if (!snapshot?.slide) return;
    const { w, h } = snapshot;
    const scale = Math.min(host.clientWidth / w, host.clientHeight / h);
    frame.style.width = w * scale + 'px';
    frame.style.height = h * scale + 'px';
    frame.firstElementChild.style.transform = `scale(${scale})`;
  }
  new ResizeObserver(sizeFrame).observe(host);
  function draw(next) {
    const { slide, w, h, number, media, removed } = next;
    for (const path of removed) delete assets[path];
    for (const [path, value] of media) assets[path] = value;
    if (!slide) frame.replaceChildren();
    else {
      if (fonts) loadSlideFonts(slide, fonts);
      const previous = snapshot?.slide;
      const layers = [...slide.back, ...slide.items];
      const previousLayers = previous && [...previous.back, ...previous.items];
      if (!previous || previous.id !== slide.id || snapshot.w !== w || snapshot.h !== h ||
          layers.length !== previousLayers.length ||
          layers.some((item, i) => item.id !== previousLayers[i].id)) {
        frame.replaceChildren(scene(slide, { w, h }, assets, 'present', false,
          new Map([[slide.id, number]])));
      } else {
        const board = frame.firstElementChild;
        const changedMedia = new Set([...media.map(([path]) => path), ...removed]);
        board.style.background = slide.bg;
        layers.forEach((item, i) => {
          let mediaChanged = false;
          if (changedMedia.size)
            mediaReferences([item], (object, key) => { mediaChanged ||= changedMedia.has(object[key]); });
          // Keep unchanged media players mounted while editing other layers.
          if (mediaChanged || JSON.stringify(item) !== JSON.stringify(previousLayers[i]))
            board.children[i].replaceWith(itemNode(item, assets, i >= slide.back.length && 'present'));
        });
        if (snapshot.number !== number) {
          board.querySelector('.slide-page-number')?.remove();
          if (number) {
            const label = itemNode(pageNumberItem({ w, h }, number), assets);
            label.classList.add('slide-page-number');
            board.append(label);
          }
        }
      }
    }
    snapshot = next;
    sizeFrame();
  }
  if (viewer && owner) {
    await viewer.listen(update, ({ payload }) => draw(payload));
    await viewer.listen('editor-command', ({ payload }) => {
      if (payload === 'close') close();
    });
    await send(ready);
    getFonts().then((faces) => {
      fonts = faces;
      if (snapshot?.slide) loadSlideFonts(snapshot.slide, fonts);
    }).catch(console.warn);
  } else if (opener) {
    window.addEventListener('message', (event) => {
      if (event.source === opener && event.origin === location.origin && event.data?.type === update)
        draw(event.data.payload);
    });
    window.addEventListener('pagehide', () => send(closed));
    send(ready);
  }
}
