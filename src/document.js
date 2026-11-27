import { invoke } from '@tauri-apps/api/core';
import { native, pdfFontStyles } from './platform.js';
import { scene } from './view.js';
import editorStyles from './style.css?inline';
import mediaStyles from './media.css?inline';

// Read the template in place on this Mac. Its private contents are never put
// in the application's distributable web assets.
export async function openTemplate() {
  return native ? invoke('open_template') : null;
}

export async function pdfDocument(deck, assets) {
  const slides = deck.slides.filter((s) => !s.hidden);
  if (!slides.length) throw Error('Show at least one slide to export a PDF.');
  const sections = slides.map((slide) => {
    const paper = scene(slide, deck, assets, false, native);
    // Playback controls and external players do not have a printed representation.
    paper.querySelectorAll('iframe,button,input,video').forEach((n) => {
      if (n.tagName === 'VIDEO' && n.poster) {
        const img = document.createElement('img');
        img.src = n.poster;
        img.style.cssText = n.style.cssText;
        n.replaceWith(img);
      } else n.remove();
    });
    return '<section hidden>' + paper.outerHTML + '</section>';
  });
  const css = `
    ${editorStyles}
    ${mediaStyles}
    ${await pdfFontStyles()}
    html,body,main{margin:0;padding:0;overflow:visible;background:white}
    main>section{margin:0;position:relative;width:${deck.w}px;height:${deck.h}px;overflow:hidden;break-after:page}
    main>section:last-child{break-after:auto}
    main>section[hidden]{display:none}
    @page {size:${deck.w}pt ${deck.h}pt;margin:0}
    @media print {
      main>section[hidden]{display:block!important;width:${deck.w}pt;height:${deck.h}pt}
      .scene{transform:scale(1.3333333333);transform-origin:0 0}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }`;
  // The detached PDF renderer can request the same disk-backed images as
  // the canvas, one page at a time. Only native media tokens supply an origin.
  const imageOrigins = new Set();
  for (const asset of Object.values(assets)) {
    if (asset?.token && /^http:\/\/127\.0\.0\.1:\d+\//.test(asset.url))
      imageOrigins.add(new URL(asset.url).origin);
  }
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: ${[...imageOrigins].join(' ')}; style-src 'unsafe-inline'; font-src data:;"><style>` +
    css.replace(/<\/style/gi, '<\\/style') +
    '</style></head><body><main>' +
    sections.join('') +
    '</main></body></html>';
  return { html, width: deck.w, height: deck.h, count: slides.length };
}

export async function exportPDF(deck, _base, assets, name) {
  const pdf = await pdfDocument(deck, assets);
  if (native)
    return Boolean(
      await invoke('export_pdf', {
        ...pdf,
        name: name.replace(/\.pptx$/i, '') + '.pdf',
      })
    );
  const frame = document.createElement('iframe');
  frame.title = 'PDF print preview';
  frame.style.cssText =
    'position:fixed;left:-200vw;top:0;width:1px;height:1px;border:0';
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.srcdoc = pdf.html;
    document.body.append(frame);
  });
  const doc = frame.contentDocument;
  await Promise.all(
    [...doc.images].map(async (img) => {
      try {
        await img.decode();
      } catch {
        if (img.dataset.fallbackSrc) {
          img.src = img.dataset.fallbackSrc;
          await img.decode().catch(() => {});
        }
      }
    })
  );
  await doc.fonts.ready;
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), {
    once: true,
  });
  frame.contentWindow.print();
  return true;
}
