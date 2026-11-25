import { mediaMime } from './media-format.js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
export const native = isTauri();
export const fileName = (path) =>
  path
    ?.split('/')
    .pop()
    ?.replace(/\.pptx$/i, '') || 'untitled';
export async function nativeEvents(callback) {
  if (native) await listen('editor-command', (e) => callback(e.payload));
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
export async function openPackage(incoming) {
  if (native) return invoke('open_document', { incoming });
  if (incoming) return;
  const f = await pickFile('.pptx');
  if (!f) return;
  const { unzipSync, strFromU8 } = await import('fflate');
  const raw = unzipSync(new Uint8Array(await f.arrayBuffer())),
    parts = { xml: {}, media: {} };
  for (const [k, v] of Object.entries(raw)) {
    if (/\.(xml|rels)$/i.test(k)) parts.xml[k] = strFromU8(v);
    else if (mediaMime(k)) {
      parts.media[k] = await toData(new Blob([v], { type: mediaMime(k) }));
    }
  }
  return { path: f.name, id: null, parts, raw };
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
export const release = (base) =>
  native && base?.id != null
    ? invoke('release_document', { id: base.id })
    : Promise.resolve();
export const dirtyFlag = (dirty) =>
  native ? invoke('set_dirty', { dirty }) : Promise.resolve();
export const quit = () => native && invoke('finish_quit');
export const setTitle = (title) => native && getCurrentWindow().setTitle(title);
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
async function registerTypeface(font, faces, bold = false, italic = false) {
  const key = JSON.stringify([font, bold, italic]);
  if (!native || loaded.has(key)) return;
  const family = faces.filter((f) => f.family === font);
  const matches = family.filter((f) => f.bold === bold && f.italic === italic);
  const targetWeight = bold ? 0.4 : 0;
  const face =
    matches.sort(
      (a, b) =>
        Math.abs(a.weight - targetWeight) - Math.abs(b.weight - targetWeight)
    )[0] ||
    (family.length
      ? null
      : faces.find((f) => f.full === font || f.postscript === font));
  if (!face) return;
  loaded.add(key);
  try {
    const alias = 'pp-' + font,
      descriptors = {
        weight: bold ? '700' : '400',
        style: italic ? 'italic' : 'normal',
      };
    let src = `local("${CSS.escape(face.postscript)}")`;
    let local = new FontFace(alias, src, descriptors);
    try {
      await local.load();
    } catch {
      const data = await invoke('font_data', { postscript: face.postscript });
      src = 'url("data:font/otf;base64,' + data + '")';
      local = new FontFace(
        alias,
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
        descriptors
      );
      await local.load();
    }
    document.fonts.add(local);
    pdfFontRules.set(
      key,
      `@font-face{font-family:"${CSS.escape(alias)}";src:${src};font-weight:${descriptors.weight};font-style:${descriptors.style}}`
    );
  } catch (error) {
    loaded.delete(key);
    console.warn('Font preview:', font, error);
  }
}
