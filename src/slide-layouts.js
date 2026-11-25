import { readSlidePage, relationships } from './import.js';
import { template } from './template.js';
import {
  P,
  R,
  PKG,
  TYPES,
  attr,
  child,
  children,
  desc,
  emu,
  esc,
  ns,
  parse,
  rawSlide,
  relative,
  relfile,
  rels,
  resolve,
  serialize,
  treeStart,
} from './xml.js';

const layouts = [
  {
    key: 'TitleOnly',
    label: 'タイトルのみ',
    type: 'titleOnly',
    placeholders: [['title', 0, 0.06, 0.06, 0.88, 0.17]],
  },
  {
    key: 'CenteredTitle',
    label: '1_タイトル スライド',
    type: 'cust',
    placeholders: [['ctrTitle', 0, 0.07, 0.37, 0.86, 0.25]],
  },
  {
    key: 'TitleContent',
    label: 'タイトルとコンテンツ',
    type: 'obj',
    placeholders: [
      ['title', 0, 0.06, 0.06, 0.88, 0.17],
      ['obj', 1, 0.06, 0.27, 0.88, 0.65],
    ],
  },
];
const editableTypes = new Set([
  'title',
  'ctrTitle',
  'subTitle',
  'body',
  'obj',
  'pic',
  'chart',
  'tbl',
  'dgm',
  'media',
  'clipArt',
]);
const placeholderTag = (ph) =>
  '<p:ph' +
  Object.entries(ph)
    .map(([k, v]) => ' ' + k + '="' + esc(v) + '"')
    .join('') +
  '/>';
export function placeholderShape(o, id) {
  return (
    '<p:sp><p:nvSpPr><p:cNvPr id="' +
    id +
    '" name="' +
    esc(o.name) +
    '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' +
    placeholderTag(o.placeholder) +
    '</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
  );
}
function appendXML(doc, owner, space, name, attrs) {
  const el = doc.createElementNS(space, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'r:id') el.setAttributeNS(R, key, value);
    else el.setAttribute(key, value);
  }
  owner.appendChild(el);
  return el;
}
// When the current master has no matching layout, add a genuine layout
// relationship on this master so the resulting slide also works in PowerPoint.
function fallback(xml, masterPath, definition, w, h) {
  const master = parse(xml[masterPath]);
  const masterRels = parse(xml[relfile(masterPath)] || rels([]));
  const dir = resolve(masterPath, '../slideLayouts/');
  const owner = masterPath
    .split('/')
    .pop()
    .replace(/\.xml$/i, '');
  let path = dir + '/' + owner + '-' + definition.key + '.xml',
    n = 0;
  while (xml[path])
    path = dir + '/' + owner + '-' + definition.key + ++n + '.xml';
  const shapes = definition.placeholders
    .map(([type, idx, x, y, width, height], i) => {
      const shape = placeholderShape(
        {
          name: type === 'obj' ? 'Content' : 'Title',
          placeholder: { type, idx },
        },
        i + 2
      );
      return shape
        .replace(
          '<p:spPr/>',
          '<p:spPr><a:xfrm><a:off x="' +
            emu(x * w) +
            '" y="' +
            emu(y * h) +
            '"/><a:ext cx="' +
            emu(width * w) +
            '" cy="' +
            emu(height * h) +
            '"/></a:xfrm></p:spPr>'
        )
        .replace(
          '<a:bodyPr/>',
          '<a:bodyPr anchor="' + (type === 'ctrTitle' ? 'ctr' : 't') + '"/>'
        )
        .replace(
          '<a:lstStyle/>',
          '<a:lstStyle><a:lvl1pPr algn="' +
            (type === 'ctrTitle' ? 'ctr' : 'l') +
            '"><a:defRPr sz="' +
            (type === 'obj' ? 2400 : 3600) +
            '"/></a:lvl1pPr></a:lstStyle>'
        );
    })
    .join('');
  const list =
    child(master.documentElement, 'sldLayoutIdLst') ||
    master.documentElement.insertBefore(
      master.createElementNS(P, 'p:sldLayoutIdLst'),
      child(master.documentElement, 'txStyles') || null
    );
  let relNumber = 1;
  const taken = new Set(
    children(masterRels.documentElement).map((r) => attr(r, 'Id'))
  );
  while (taken.has('rId' + relNumber)) relNumber++;
  const rid = 'rId' + relNumber;
  // Layout and master IDs share the 32-bit presentation-wide namespace.
  const lastId = Math.max(
    2147483648,
    ...Object.entries(xml)
      .filter(([name]) =>
        /\/slideMasters\/[^/]+\.xml$|presentation\.xml$/.test(name)
      )
      .flatMap(([, raw]) =>
        [
          ...raw.matchAll(
            /\b(?:\w+:)?(?:sldLayoutId|sldMasterId)\s[^>]*?\bid=["'](\d+)["']/g
          ),
        ].map((m) => Number(m[1]))
      )
  );
  appendXML(master, list, P, 'p:sldLayoutId', {
    id: String(lastId + 1),
    'r:id': rid,
  });
  appendXML(masterRels, masterRels.documentElement, PKG, 'Relationship', {
    Id: rid,
    Type: R + '/slideLayout',
    Target: relative(masterPath, path),
  });
  const types = parse(xml['[Content_Types].xml']);
  appendXML(types, types.documentElement, TYPES, 'Override', {
    PartName: '/' + path,
    ContentType:
      'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  });
  return {
    path,
    patch: {
      [path]:
        '<p:sldLayout ' +
        ns +
        ' type="' +
        definition.type +
        '" preserve="1"><p:cSld name="' +
        esc(definition.label) +
        '"><p:spTree>' +
        treeStart +
        shapes +
        '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
      [relfile(path)]: rels([
        ['rId1', 'slideMaster', relative(path, masterPath)],
      ]),
      [masterPath]: serialize(master),
      [relfile(masterPath)]: serialize(masterRels),
      '[Content_Types].xml': serialize(types),
    },
  };
}
function available(xml, masterPath) {
  return relationships(xml, masterPath)
    .filter((r) => r.type === 'slideLayout' && xml[r.target])
    .map((r) => {
      const doc = parse(xml[r.target]);
      const ph = children(desc(doc, 'spTree'))
        .filter((n) => desc(n, 'ph'))
        .map((n) => attr(desc(n, 'ph'), 'type', 'obj'))
        .filter((t) => editableTypes.has(t));
      return {
        path: r.target,
        name: attr(desc(doc, 'cSld'), 'name'),
        type: attr(doc.documentElement, 'type'),
        ph,
      };
    });
}
function resolveLayout(xml, masterPath, def, w, h) {
  const choices = available(xml, masterPath);
  const match =
    choices.find((l) => l.name === def.label) ||
    choices.find((l) =>
      def.key === 'CenteredTitle'
        ? l.ph.length === 1 && l.ph[0] === 'ctrTitle'
        : l.type === def.type &&
          l.ph.some((t) => t === 'title' || t === 'ctrTitle') &&
          (def.key !== 'TitleContent' ||
            l.ph.some((t) => t === 'obj' || t === 'body'))
    );
  return match || fallback(xml, masterPath, def, w, h);
}
export function layoutPatches(deck, xml) {
  const changes = {};
  for (const s of deck.slides) {
    if (!s.generatedLayout || xml[s.layoutPath] || changes[s.layoutPath])
      continue;
    const def = layouts.find((d) => d.key === s.generatedLayout.key);
    const generated = fallback(
      { ...xml, ...changes },
      s.generatedLayout.master,
      def,
      deck.w,
      deck.h
    );
    if (generated.path !== s.layoutPath)
      throw Error('The slide layout changed while this file was open.');
    Object.assign(changes, generated.patch);
  }
  return changes;
}
export function layoutOptions(base, deck, current) {
  const parts = base?.parts || template(),
    presPath = base?.presPath || 'ppt/presentation.xml';
  const xml = { ...parts.xml, ...layoutPatches(deck, parts.xml) };
  const master =
    current.generatedLayout?.master ||
    (current.layoutPath &&
      relationships(xml, current.layoutPath).find(
        (r) => r.type === 'slideMaster'
      )?.target) ||
    relationships(xml, presPath).find((r) => r.type === 'slideMaster')?.target;
  if (!master || !xml[master])
    throw Error('This presentation has no slide master.');
  return layouts.map((def) => {
    const layout = resolveLayout(xml, master, def, deck.w, deck.h);
    const overlay = { ...xml, ...layout.patch };
    const doc = parse(overlay[layout.path]);
    const shapes = children(desc(doc, 'spTree'))
      .filter((n) => n.localName === 'sp')
      .flatMap((n, i) => {
        const ph = desc(n, 'ph');
        if (!ph || !editableTypes.has(attr(ph, 'type', 'obj'))) return [];
        const properties = Object.fromEntries(
          [...ph.attributes]
            .filter((a) => !a.prefix)
            .map((a) => [a.name, a.value])
        );
        return placeholderShape(
          {
            name: attr(desc(n, 'cNvPr'), 'name', 'Placeholder'),
            placeholder: properties,
          },
          i + 2
        );
      })
      .join('');
    // Derive geometry and typography through the same inheritance path as
    // opening an actual slide, including theme, master and layout defaults.
    const read = (path) => (overlay[path] ? parse(overlay[path]) : undefined);
    const page = parse(rawSlide('', null, shapes));
    desc(page, 'bg').remove();
    const s = readSlidePage({
      xml: overlay,
      media: parts.media,
      doc: read,
      pres: read(presPath),
      page,
      rel: [],
      layoutPath: layout.path,
    });
    s.inheritBackground = s.bg;
    if (layout.patch || !parts.xml[layout.path])
      s.generatedLayout = { key: def.key, master };
    for (const obj of s.items) {
      delete obj.source;
      delete obj.officeId;
      obj.layoutOriginal = structuredClone(obj);
    }
    return { label: def.label, slide: s };
  });
}
