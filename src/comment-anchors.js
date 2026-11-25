import { attr, child, children, desc } from './xml.js';
import { layerBounds, layerEntries } from './layers.js';

const PC = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command';
const AC = 'http://schemas.microsoft.com/office/drawing/2013/main/command';
const tags = {
  sp: 'spMk',
  pic: 'picMk',
  cxnSp: 'cxnSpMk',
  grpSp: 'grpSpMk',
  graphicFrame: 'graphicFrameMk',
};

export function anchorAt(entry, point) {
  if (!entry) return point;
  const box = layerBounds(entry);
  const x = point?.x ?? box.x + box.w / 2,
    y = point?.y ?? box.y + box.h / 2;
  return {
    objectId: entry.object.id,
    offsetX: x - box.x,
    offsetY: y - box.y,
    x,
    y,
  };
}

export function refreshCommentPositions(slide) {
  if (!slide?.comments?.some((c) => c.objectId)) return;
  const entries = layerEntries(slide.items);
  for (const c of slide.comments) {
    if (!c.objectId) continue;
    const entry = entries.get(c.objectId);
    if (entry) {
      const box = layerBounds(entry);
      c.x = box.x + c.offsetX;
      c.y = box.y + c.offsetY;
    } else {
      delete c.objectId;
      delete c.offsetX;
      delete c.offsetY;
    }
  }
}

export function readCommentAnchor(node, byOfficeId, comment) {
  const drawing = child(node, 'deMkLst');
  if (!drawing) return;
  const entry = byOfficeId.get(attr(children(drawing).at(-1), 'id'));
  if (!entry) return;
  const box = layerBounds(entry);
  Object.assign(comment, {
    objectId: entry.object.id,
    offsetX: comment.x,
    offsetY: comment.y,
    x: comment.x + box.x,
    y: comment.y + box.y,
  });
}

export function writeCommentAnchor(node, objectNode, slideId) {
  // Keep replies, text-range anchors and extension data unrelated to our edit.
  for (const el of children(node)) {
    if (
      ['sldMkLst', 'deMkLst', 'unknownAnchor', 'txMkLst'].includes(el.localName)
    )
      el.remove();
  }
  const anchored = objectNode && tags[objectNode.localName];
  const doc = node.ownerDocument;
  const list = doc.createElementNS(
    anchored ? AC : PC,
    anchored ? 'ac:deMkLst' : 'pc:sldMkLst'
  );
  node.insertBefore(list, node.firstElementChild);
  list.append(doc.createElementNS(PC, 'pc:docMk'));
  const slide = doc.createElementNS(PC, 'pc:sldMk');
  slide.setAttribute('sldId', slideId);
  list.append(slide);
  if (!anchored) return;
  // Shape IDs are scoped to the entire slide, including shapes nested in groups.
  const mark = doc.createElementNS(AC, 'ac:' + tags[objectNode.localName]);
  const properties = desc(objectNode, 'cNvPr');
  mark.setAttribute('id', attr(properties, 'id'));
  const creationId = attr(desc(properties, 'creationId'), 'id');
  if (creationId) mark.setAttribute('creationId', creationId);
  list.append(mark);
}
