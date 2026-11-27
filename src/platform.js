import { mediaMime } from './media-format.js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
export const native = isTauri();
export const windows = /^Win/i.test(navigator.platform);
export const nativeMac = native && !windows;
export function shortcutLabel(keys = '') {
  if (!windows) return keys;
  return [
    keys.includes('⌘') && 'Ctrl',
    keys.includes('⇧') && 'Shift',
    keys.includes('⌥') && 'Alt',
    keys.replace(/[⌘⇧⌥]/g, ''),
  ].filter(Boolean).join('+');
}

export const fileName = (path) =>
  path
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.pptx$/i, '') || 'untitled';
export const shareDocumentMode = (path) =>
  native && path
    ? invoke('share_document_mode', { path })
    : Promise.resolve('none');
export const revealShareDocument = (path) =>
  invoke('reveal_share_document', { path });
export const copyOrganizationLink = (path) =>
  invoke('copy_organization_link', { path });
export async function readCanvasClipboard() {
  const data = await invoke('read_canvas_clipboard');
  const images = data.images.map(({ data: encoded, mime, name }) => {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    return new File([bytes], name, { type: mime });
  });
  return { html: data.html, text: data.text, images };
}
export async function nativeEvents(callback) {
  if (native)
    await getCurrentWindow().listen('editor-command', (e) =>
      callback(e.payload)
    );
}
export async function pickFile(accept) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  return new Promise((resolve) => {
    input.onchange = () => resolve(input.files[0]);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
export const toData = (file) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    r.readAsDataURL(file);
  });
export async function openPackage() {
  if (native) return invoke('open_document');
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('open');
  if (!token || !/^[a-f0-9-]+$/i.test(token)) return;
  history.replaceState(null, '', location.pathname + location.search);
  const url = 'blob:' + location.origin + '/' + token;
  let bytes;
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error('Could not read the presentation.');
    bytes = await response.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
  const { unzipSync, strFromU8 } = await import('fflate');
  const raw = unzipSync(new Uint8Array(bytes)),
    parts = { xml: {}, media: {} };
  for (const [k, v] of Object.entries(raw)) {
    if (/\.(xml|rels)$/i.test(k)) parts.xml[k] = strFromU8(v);
    else if (mediaMime(k)) {
      parts.media[k] = await toData(new Blob([v], { type: mediaMime(k) }));
    }
  }
  return { path: params.get('name') || 'untitled.pptx', id: null, parts, raw };
}
export async function savePackage(base, path, name, changes) {
  if (native)
    return invoke('save_document', {
      source: base?.id ?? null,
      path: path ?? null,
      name: name + '.pptx',
      changes,
    });
  const { zipSync, strToU8 } = await import('fflate'),
    raw = { ...base?.raw };
  for (const k of changes.removed || []) delete raw[k];
  for (const [k, v] of Object.entries(changes.xml)) raw[k] = strToU8(v);
  for (const [k, v] of Object.entries(changes.media))
    raw[k] = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([zipSync(raw)], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
  );
  a.download = name + '.pptx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}
// Native registration gives the source document one ownership. A clipboard
// capture and each destination document can acquire another share of its file.
const additionalMovieOwners = new Map();
function movieTokens(values) {
  return new Set(values.map((value) => value?.token).filter(Boolean));
}
export function retainMovies(values) {
  for (const token of movieTokens(values)) {
    additionalMovieOwners.set(
      token,
      (additionalMovieOwners.get(token) || 0) + 1
    );
  }
}
export function releaseMovies(values) {
  const tokens = [];
  for (const token of movieTokens(values)) {
    const shares = additionalMovieOwners.get(token);
    if (shares === undefined) tokens.push(token);
    else if (shares === 1) additionalMovieOwners.delete(token);
    else additionalMovieOwners.set(token, shares - 1);
  }
  return native && tokens.length
    ? invoke('release_movies', { tokens })
    : Promise.resolve();
}
export async function release(
  base,
  values = Object.values(base?.parts.media ?? {})
) {
  await releaseMovies(values);
  if (native && base?.id != null)
    await invoke('release_document', { id: base.id });
}
export const dirtyFlag = (dirty) =>
  native ? invoke('set_dirty', { dirty }) : Promise.resolve();
export async function openWindow(pick) {
  if (native) return invoke('new_document_window', { pick });
  const file = pick && (await pickFile('.pptx'));
  if (pick && !file) return;
  const url = new URL(location.href);
  const blob = file && URL.createObjectURL(file);
  url.hash = file
    ? new URLSearchParams({ open: blob.split('/').pop(), name: file.name })
    : 'new';
  const child = window.open(url, '_blank', 'popup');
  if (child) {
    child.opener = null;
    return;
  }
  // Some browsers end user activation in the system file picker. The link
  // lets the same chosen file open from a fresh, trusted click.
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML =
    '<h3>Open in a new window</h3><div class="buttons"><button class="top-action">Cancel</button><a class="top-action primary" target="_blank" rel="noopener">Open window</a></div>';
  const link = dialog.querySelector('a');
  link.href = url;
  link.onclick = () => dialog.close('open');
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.onclose = () => {
    if (blob && dialog.returnValue !== 'open') URL.revokeObjectURL(blob);
    dialog.remove();
  };
  document.body.append(dialog);
  dialog.showModal();
}
export const closeWindow = (quitting) => invoke('finish_close', { quitting });
export const setTitle = (title) =>
  native ? getCurrentWindow().setTitle(title) : (document.title = title);
export const fullScreen = (on) =>
  native
    ? getCurrentWindow().setFullscreen(on)
    : on
      ? document.documentElement.requestFullscreen()
      : document.fullscreenElement
        ? document.exitFullscreen()
        : Promise.resolve();
export async function getFonts() {
  if (native) return invoke('system_fonts');
  return [
    'Arial',
    'Georgia',
    'Helvetica Neue',
    'Hiragino Sans',
    'Menlo',
    'Times New Roman',
  ].map((f) => ({ family: f, full: f, postscript: f, style: 'Regular' }));
}
const loaded = new Set();
const pendingFonts = new Map();
const pdfFontRules = new Map();
const fontSources = new Map();
const fontIndexes = new WeakMap();
const fontKey = (name) => name.normalize('NFKC').trim().toLowerCase();

export function resolveTypeface(name, faces, bold = false, italic = false) {
  if (!name || !faces.length) return;
  let index = fontIndexes.get(faces);
  if (!index) {
    index = new Map();
    for (const face of faces) {
      for (const spelling of new Set([
        face.family,
        face.full,
        face.postscript,
        ...(face.aliases || []),
      ])) {
        if (!spelling) continue;
        const key = fontKey(spelling);
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(face);
      }
    }
    fontIndexes.set(faces, index);
  }
  const candidates = index.get(fontKey(name));
  if (!candidates) return;
  const score = (f) =>
    (Boolean(f.italic) === italic ? 0 : 8) +
    (Boolean(f.bold) === bold ? 0 : 4) +
    Math.abs((f.weight || 0) - (bold ? 0.4 : 0));
  let best;
  for (const face of candidates)
    if (!best || score(face) < score(best)) best = face;
  return best;
}
export async function pdfFontStyles() {
  await Promise.all([...pendingFonts.values()]);
  return [...pdfFontRules.values()].join('\n');
}
export function loadTypeface(font, faces, bold = false, italic = false) {
  const key = JSON.stringify([font, bold, italic]);
  if (pendingFonts.has(key)) return pendingFonts.get(key);
  const work = registerTypeface(font, faces, bold, italic).finally(() =>
    pendingFonts.delete(key)
  );
  pendingFonts.set(key, work);
  return work;
}
function sourceFor(postscript) {
  if (!fontSources.has(postscript)) {
    const local = `local("${CSS.escape(postscript)}")`;
    if (windows) return Promise.resolve(local);
    const source = new FontFace(postscript, local)
      .load()
      .then(
        () => local,
        async () => {
          const data = await invoke('font_data', { postscript });
          return `url("data:font/otf;base64,${data}")`;
        }
      )
      .catch((error) => {
        fontSources.delete(postscript);
        throw error;
      });
    fontSources.set(postscript, source);
  }
  return fontSources.get(postscript);
}
async function registerTypeface(font, faces, bold = false, italic = false) {
  const key = JSON.stringify([font, bold, italic]);
  if (!native || loaded.has(key)) return;
  const face = resolveTypeface(font, faces, bold, italic);
  if (!face) return;
  loaded.add(key);
  try {
    const alias = 'pp-' + font,
      descriptors = {
        weight: face.bold ? '700' : '400',
        style: face.italic ? 'italic' : 'normal',
      };
    const src = await sourceFor(face.postscript);
    document.fonts.add(await new FontFace(alias, src, descriptors).load());
    pdfFontRules.set(
      key,
      `@font-face{font-family:"${CSS.escape(alias)}";src:${src};font-weight:${descriptors.weight};font-style:${descriptors.style}}`
    );
  } catch (error) {
    loaded.delete(key);
    console.warn('Font preview:', font, error);
  }
}
