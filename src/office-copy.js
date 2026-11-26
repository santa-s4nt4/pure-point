import {
  R,
  PKG,
  attr,
  children,
  desc,
  parse,
  relative,
  relfile,
  resolve,
} from './xml.js';
import { readLayerFlags, writeLayerFlags } from './layer-xml.js';

// source indexes are relative to the original parent, including non-shape XML
// children. An edited layer may already have moved to a different group.
const sourceIndexes = new WeakMap();
function indexSlide(slide, xml) {
  if (sourceIndexes.has(slide)) return sourceIndexes.get(slide);
  const index = new Map();
  const raw = parse(xml[slide.source]);
  function visit(parent, items) {
    const elements = children(parent);
    for (const o of items) {
      const node = elements[o.source];
      if (!node) continue;
      index.set(o.id, { node, original: o });
      if (o.items) visit(node, o.items);
    }
  }
  visit(desc(raw, 'spTree'), slide.items);
  sourceIndexes.set(slide, index);
  return index;
}

function relationshipAttributes(node) {
  return [node, ...node.getElementsByTagName('*')].flatMap((el) =>
    [...el.attributes].filter(
      (a) =>
        a.value &&
        (a.namespaceURI === R ||
          (a.namespaceURI === 'urn:schemas-microsoft-com:office:office' &&
            a.localName === 'relid'))
    )
  );
}

const documentId = (base) => base?.deck?.slides[0]?.id;

// The underlying chart, diagram, media or OLE package can stay in place when
// pasting within one deck. Fully inline tables and external links travel too.
export function captureOfficeObject(o, slide, base) {
  if (o.officeCopy || !['table', 'unsupported'].includes(o.kind)) return;
  const originalSlide = base?.deck?.slides.find(
    (s) => s.id === (slide.copyOf || slide.id)
  );
  if (!originalSlide?.source)
    throw Error(`The PowerPoint source for “${o.name}” is unavailable.`);
  const { xml } = base.parts;
  const entry = indexSlide(originalSlide, xml).get(o.copyOf || o.id);
  if (!entry)
    throw Error(`Could not find “${o.name}” in its PowerPoint slide.`);

  const used = new Set(relationshipAttributes(entry.node).map((a) => a.value));
  const data = xml[relfile(originalSlide.source)];
  const rels = data ? children(parse(data).documentElement) : [];
  const relations = [...used].map((id) => {
    const r = rels.find((n) => attr(n, 'Id') === id);
    if (!r) throw Error(`“${o.name}” references a missing PowerPoint part.`);
    const external = attr(r, 'TargetMode') === 'External';
    const target = attr(r, 'Target');
    return {
      id,
      type: attr(r, 'Type'),
      external,
      target: external ? target : resolve(originalSlide.source, target),
    };
  });
  const original = { ...entry.original };
  delete original.table;
  const copy = entry.node.cloneNode(true);
  // Markup Compatibility can use prefix names in attribute *values*, where
  // XMLSerializer will not automatically restore declarations from the slide.
  const xmlns = 'http://www.w3.org/2000/xmlns/';
  for (let el = entry.node.parentElement; el; el = el.parentElement) {
    for (const a of el.attributes) {
      if (a.namespaceURI === xmlns && !copy.hasAttributeNS(xmlns, a.localName))
        copy.setAttributeNS(xmlns, a.name, a.value);
    }
  }
  o.officeCopy = {
    xml: new XMLSerializer().serializeToString(copy),
    original,
    relations,
    documentId: documentId(base),
  };
}

export function validateOfficeCopies(items, base) {
  for (const o of items) {
    const copy = o.officeCopy;
    if (
      copy &&
      copy.documentId !== documentId(base) &&
      copy.relations.some((r) => !r.external)
    )
      throw Error(
        `“${o.name}” links to parts in its source presentation. Paste it within that presentation.`
      );
    if (o.items) validateOfficeCopies(o.items, base);
  }
}

export function writeOfficeCopy(
  o,
  { doc, path, sr, base, id, nextId, patch, onRelationsChanged }
) {
  validateOfficeCopies([o], base);
  const copy = o.officeCopy,
    root = doc.importNode(parse(copy.xml).documentElement, true);
  const mapped = new Map();
  for (const r of copy.relations) {
    const target = r.external ? r.target : relative(path, r.target);
    let existing = children(sr.documentElement).find(
      (n) =>
        attr(n, 'Type') === r.type &&
        (attr(n, 'TargetMode') === 'External') === r.external &&
        (r.external
          ? attr(n, 'Target') === r.target
          : resolve(path, attr(n, 'Target')) === r.target)
    );
    if (!existing) {
      const used = new Set(
        children(sr.documentElement).map((n) => attr(n, 'Id'))
      );
      let k = 1;
      while (used.has('rId' + k)) k++;
      existing = sr.createElementNS(PKG, 'Relationship');
      existing.setAttribute('Id', 'rId' + k);
      existing.setAttribute('Type', r.type);
      existing.setAttribute('Target', target);
      if (r.external) existing.setAttribute('TargetMode', 'External');
      sr.documentElement.append(existing);
      onRelationsChanged();
    }
    mapped.set(r.id, attr(existing, 'Id'));
  }
  for (const a of relationshipAttributes(root))
    if (mapped.has(a.value)) a.value = mapped.get(a.value);

  const ids = new Map();
  for (const info of root.getElementsByTagNameNS('*', 'cNvPr')) {
    const old = attr(info, 'id');
    if (!ids.has(old)) ids.set(old, ids.size ? nextId() : id);
    info.setAttribute('id', ids.get(old));
  }
  for (const mark of root.getElementsByTagNameNS('*', 'creationId')) {
    if (mark.hasAttribute('id'))
      mark.setAttribute('id', '{' + crypto.randomUUID().toUpperCase() + '}');
    if (mark.hasAttribute('val'))
      mark.setAttribute('val', crypto.getRandomValues(new Uint32Array(1))[0]);
  }
  const shapes =
    root.localName === 'AlternateContent'
      ? children(root).flatMap((branch) => children(branch))
      : [root];
  for (const shape of shapes) {
    patch(shape, o, copy.original, true);
    writeLayerFlags(shape, o, readLayerFlags(shape));
  }
  return root;
}
