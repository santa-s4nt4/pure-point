import { uid } from './model.js';
import { esc } from './xml.js';
import { releaseClipboardMedia } from './clipboard-media.js';

// Native Edit > Copy/Paste and the macOS keyboard shortcuts send DOM clipboard
// events to the webview. Keep media in its original store; only the selection
// token and a human-readable text representation go on the system pasteboard.
const mime = 'application/x-pure-point-objects';
export function objectClipboard({ available, capture, insert, onError }) {
  let clip;
  function copy(event) {
    if (!available(event.target) || !event.clipboardData) return;
    let next;
    try {
      next = capture();
      if (!next) return;
      const token = uid();
      const text = next.items.map((o) => o.text || o.name || o.kind).join('\n');
      const html = `<span data-pure-point-objects="${token}">${esc(text)}</span>`;
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
  function paste(event) {
    if (!available(event.target) || !clip) return;
    const data = event.clipboardData;
    if (
      !data ||
      (data.getData(mime) !== clip.token &&
        !data
          .getData('text/html')
          .includes(`data-pure-point-objects="${clip.token}"`))
    )
      return;
    event.preventDefault();
    try {
      insert(clip);
    } catch (error) {
      onError(error);
    }
  }
  document.addEventListener('copy', copy);
  document.addEventListener('paste', paste);
  return {
    get hasObjects() {
      return Boolean(clip);
    },
    copy() {
      document.execCommand('copy');
    },
    async paste() {
      if (!clip) return;
      // A context-menu click is a user gesture. Prefer the current system
      // clipboard when the browser grants access to its HTML representation.
      if (navigator.clipboard?.read) {
        try {
          const values = await navigator.clipboard.read();
          for (const value of values) {
            if (!value.types.includes('text/html')) continue;
            const html = await (await value.getType('text/html')).text();
            if (html.includes(`data-pure-point-objects="${clip.token}"`)) {
              if (available(document.activeElement)) insert(clip);
              return;
            }
          }
          return;
        } catch (error) {
          if (!['NotAllowedError', 'NotSupportedError'].includes(error.name))
            throw error;
        }
      }
      if (available(document.activeElement)) insert(clip);
    },
  };
}
