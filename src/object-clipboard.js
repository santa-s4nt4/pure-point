import { invoke } from '@tauri-apps/api/core';
import { uid } from './model.js';
import { esc } from './xml.js';
import { releaseClipboardMedia } from './clipboard-media.js';
import { native, readCanvasClipboard } from './platform.js';

// Native Edit > Copy/Paste and the macOS keyboard shortcuts send DOM clipboard
// events to the webview. Keep media in its original store; only the selection
// token and a human-readable text representation go on the system pasteboard.
const mime = 'application/x-pure-point-clipboard';
const isImage = (type) => /^image\/(png|jpeg|gif|webp)$/i.test(type);

async function readBrowserClipboard() {
  if (!navigator.clipboard?.read)
    throw Error('Press ⌘V on the canvas to paste from the clipboard.');
  const data = { html: '', text: '', images: [] };
  for (const item of await navigator.clipboard.read()) {
    const imageType = item.types.find(isImage);
    if (imageType) {
      const blob = await item.getType(imageType);
      data.images.push(
        new File([blob], 'Pasted image.' + imageType.split('/')[1], {
          type: imageType,
        })
      );
    }
    if (!data.html && item.types.includes('text/html'))
      data.html = await (await item.getType('text/html')).text();
    if (item.types.includes('text/plain')) {
      const text = await (await item.getType('text/plain')).text();
      data.text += (data.text ? '\n' : '') + text;
    }
  }
  return data;
}

export function objectClipboard({
  available,
  destination,
  capture,
  insert,
  insertExternal,
  onError,
}) {
  let clip;
  const broker =
    !native && typeof SharedWorker !== 'undefined'
      ? new SharedWorker(new URL('./clipboard-worker.js', import.meta.url)).port
      : null;
  function publish(copy) {
    if (native) {
      const media = [
        ...new Set(
          Object.values(copy.media?.assets || {})
            .map((a) => a?.token)
            .filter(Boolean)
        ),
      ];
      return invoke('store_selection', {
        token: copy.token,
        json: JSON.stringify(copy),
        media,
      });
    }
    broker?.postMessage({ copy });
    return Promise.resolve();
  }
  async function readSelection(token) {
    if (native) {
      const json = await invoke('read_selection', { token });
      return json && JSON.parse(json);
    }
    if (!broker) return null;
    const { port1, port2 } = new MessageChannel();
    return new Promise((resolve) => {
      port1.onmessage = ({ data }) => {
        port1.close();
        resolve(data);
      };
      broker.postMessage({ token }, [port2]);
    });
  }
  function copy(event) {
    // Chromium can target a previously edited textarea after its selection
    // loses focus. Route clipboard commands using the current focus owner.
    if (!available(document.activeElement) || !event.clipboardData) return;
    let next;
    try {
      next = capture();
      if (!next) return;
      const token = uid();
      const text =
        next.text ??
        next.items.map((o) => o.text || o.name || o.kind).join('\n');
      const html = `<span data-pure-point-clipboard="${token}">${esc(text)}</span>`;
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData(mime, token);
      event.preventDefault();
      releaseClipboardMedia(clip?.media).catch(onError);
      clip = { ...next, token };
      publish(clip).catch(onError);
    } catch (error) {
      releaseClipboardMedia(next?.media).catch(onError);
      onError(error);
    }
  }
  function selectionToken(data) {
    return (
      data.token ||
      data.html?.match(/data-pure-point-clipboard="([a-f0-9-]+)"/i)?.[1]
    );
  }
  async function place(data, slide, slidesOnly = false) {
    const canPaste = () =>
      destination() === slide && available(document.activeElement);
    if (!canPaste()) return;
    const token = selectionToken(data);
    if (token) {
      const local = token === clip?.token;
      const copy = local ? clip : await readSelection(token);
      if (copy) {
        try {
          if (canPaste() && (!slidesOnly || copy.slides)) insert(copy);
        } finally {
          if (!local) await releaseClipboardMedia(copy.media);
        }
        return;
      }
      if (!canPaste()) return;
    }
    if (slidesOnly) return;
    const text = (data.text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    if (data.images.length || text)
      await insertExternal({ images: data.images, text }, slide);
  }
  function paste(event) {
    if (!available(document.activeElement)) return;
    const data = event.clipboardData;
    // DataTransfer is only readable during the paste event.
    let files = Array.from(data?.files || []);
    if (!files.length && data?.items) {
      files = Array.from(data.items, (item) => item.getAsFile()).filter(
        Boolean
      );
    }
    const transfer = {
      token: data?.getData(mime),
      html: data?.getData('text/html'),
      text: data?.getData('text/plain'),
      images: files.filter((f) => isImage(f.type)),
    };
    const hasFiles = files.length > 0 || data?.types.includes('Files');
    const fileUrls = /^file:/im.test(data?.getData('text/uri-list') || '');
    const hasContent =
      selectionToken(transfer) ||
      transfer.images.length > 0 ||
      (transfer.text && !hasFiles && !fileUrls);
    // Finder can advertise a file selection with only a thumbnail visible to WebKit.
    const readNative =
      native &&
      event.isTrusted &&
      !selectionToken(transfer) &&
      (!hasContent || fileUrls || transfer.images.length < files.length);
    if (!readNative && !hasContent) return;
    event.preventDefault();
    const slide = destination();
    const payload = readNative
      ? readCanvasClipboard()
      : Promise.resolve(transfer);
    payload.then((value) => place(value, slide)).catch(onError);
  }
  document.addEventListener('copy', copy);
  document.addEventListener('paste', paste);
  return {
    dispose: () => releaseClipboardMedia(clip?.media),
    copy() {
      document.execCommand('copy');
    },
    async paste(slidesOnly = false) {
      if (!available(document.activeElement)) return;
      const slide = destination();
      const data = native
        ? await readCanvasClipboard()
        : await readBrowserClipboard();
      await place(data, slide, slidesOnly);
    },
  };
}
