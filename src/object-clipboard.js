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
    } catch (error) {
      releaseClipboardMedia(next?.media).catch(onError);
      onError(error);
    }
  }
  function isInternal(data) {
    return (
      clip &&
      (data.token === clip.token ||
        data.html?.includes(`data-pure-point-clipboard="${clip.token}"`))
    );
  }
  async function place(data, slide, slidesOnly = false) {
    if (destination() !== slide || !available(document.activeElement)) return;
    if (isInternal(data)) {
      if (!slidesOnly || clip.slides) insert(clip);
      return;
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
      isInternal(transfer) ||
      transfer.images.length > 0 ||
      (transfer.text && !hasFiles && !fileUrls);
    // Finder can advertise a file selection with only a thumbnail visible to WebKit.
    const readNative =
      native &&
      event.isTrusted &&
      !isInternal(transfer) &&
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
