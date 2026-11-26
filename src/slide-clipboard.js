import { uid } from './model.js';
import {
  captureClipboardMedia,
  pasteClipboardMedia,
} from './clipboard-media.js';
import { captureOfficeObject, validateOfficeCopies } from './office-copy.js';

function visit(items, apply) {
  for (const item of items) {
    apply(item);
    if (item.items) visit(item.items, apply);
  }
}
const layers = (slides) => slides.flatMap((s) => [...s.back, ...s.items]);

export function captureSlides(deck, ids, base, assets, documentId) {
  const slides = structuredClone(deck.slides.filter((s) => ids.has(s.id)));
  for (const s of slides)
    visit(s.items, (o) => captureOfficeObject(o, s, base));
  return {
    slides,
    documentId,
    media: captureClipboardMedia(layers(slides), assets),
    text: slides
      .map((s) => s.name || s.items.find((o) => o.text)?.text || 'Slide')
      .join('\n'),
  };
}

export function pasteSlides(clip, base, assets, documentId, sectionId) {
  const slides = structuredClone(clip.slides);
  const local = clip.documentId === documentId;
  for (const s of slides) {
    if (!local) {
      validateOfficeCopies(s.items, base);
      // A layout path belongs to its source package. Materialize the visible
      // master artwork and resolved text styles in the destination slide.
      s.items.unshift(...s.back);
      s.back = [];
      s.hideMasterShapes = true;
      delete s.layoutPath;
      delete s.generatedLayout;
      delete s.inheritBackground;
    }
    const original = local && (s.copyOf || (s.source && s.id));
    delete s.copyOf;
    if (original) s.copyOf = original;
    delete s.source;
    delete s.relId;
    delete s.slideId;
    s.id = uid();
    s.sectionId = sectionId;
    const ids = new Map();
    visit([...s.items, ...s.back], (o) => {
      const previous = o.id;
      if (original && o.source != null) o.copyOf ||= previous;
      if (!local) {
        delete o.copyOf;
        delete o.source;
        delete o.officeId;
        delete o.placeholder;
        delete o.layoutOriginal;
      }
      o.id = uid();
      ids.set(previous, o.id);
    });
    for (const comment of s.comments || []) {
      comment.id = uid();
      delete comment.sourcePart;
      if (comment.objectId) comment.objectId = ids.get(comment.objectId);
    }
  }
  pasteClipboardMedia(layers(slides), clip.media, assets);
  return slides;
}
