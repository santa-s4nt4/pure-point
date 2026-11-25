import { template } from './template.js';
import {
  A,
  P,
  R,
  attr,
  child,
  children,
  desc,
  esc,
  ns,
  parse,
  relative,
  relfile,
  resolve,
  rels,
  treeStart,
} from './xml.js';
import { replaceRunText } from './text.js';

const contentType =
  'application/vnd.openxmlformats-officedocument.presentationml.';
const paragraphText = (p) =>
  children(p)
    .map((r) =>
      r.localName === 'br' ? '\n' : child(r, 't')?.textContent || ''
    )
    .join('');
function placeholderOf(shape) {
  return desc(child(shape, 'nvSpPr'), 'ph');
}
function masterPlaceholder(doc, type) {
  return children(desc(doc, 'spTree'), 'sp')
    .map(placeholderOf)
    .find((ph) => attr(ph, 'type') === type);
}
function notesShape(doc, master) {
  const shapes = children(desc(doc, 'spTree'), 'sp');
  const body = shapes.find((s) => attr(placeholderOf(s), 'type') === 'body');
  if (body) return body;
  const ref = masterPlaceholder(master, 'body');
  if (ref)
    return shapes.find((s) => {
      const ph = placeholderOf(s);
      return (
        ph &&
        !ph.hasAttribute('type') &&
        attr(ph, 'idx', '0') === attr(ref, 'idx', '0')
      );
    });
}
export function readNotes(path, part) {
  if (!path) return '';
  const notes = part(path),
    rels = part(relfile(path));
  const master = related(rels, path, 'notesMaster');
  return children(child(notesShape(notes, part(master)), 'txBody'), 'p')
    .map(paragraphText)
    .join('\n');
}
function placeholder(id, type, index, transform = '') {
  const name = type === 'sldImg' ? 'Slide Image' : 'Notes';
  const idx = index === '' ? '' : ` idx="${esc(index)}"`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx}/></p:nvPr></p:nvSpPr><p:spPr>${transform}</p:spPr>${type === 'body' ? '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>' : ''}</p:sp>`;
}
function masterXml(pres) {
  const size = child(pres.documentElement, 'notesSz');
  const w = Number(attr(size, 'cx', 6858000)),
    h = Number(attr(size, 'cy', 9144000));
  const frame = (x, y, width, height) =>
    `<a:xfrm><a:off x="${Math.round(x * w)}" y="${Math.round(y * h)}"/><a:ext cx="${Math.round(width * w)}" cy="${Math.round(height * h)}"/></a:xfrm>`;
  const image = placeholder(2, 'sldImg', 1, frame(0.08, 0.07, 0.84, 0.37));
  const body = placeholder(3, 'body', 2, frame(0.08, 0.49, 0.84, 0.44));
  const colors =
    'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"';
  return `<p:notesMaster ${ns}><p:cSld><p:spTree>${treeStart}${image}${body}</p:spTree></p:cSld><p:clrMap ${colors}/><p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}
function related(doc, owner, type) {
  const r = children(doc?.documentElement).find(
    (n) =>
      attr(n, 'Type') === R + '/' + type && attr(n, 'TargetMode') !== 'External'
  );
  return r && resolve(owner, attr(r, 'Target'));
}
function unusedPath(
  { xml, docs, presPath },
  kind,
  folder = resolve(presPath, kind + 's')
) {
  for (let i = 1; ; i++) {
    const path = `${folder}/${kind}${i}.xml`;
    if (!xml[path] && !docs.has(path)) return path;
  }
}
function ensureMaster(state) {
  const { part, pres, presPath, addRelation, ensureType } = state;
  const relations = part(relfile(presPath), rels([]));
  const current = related(relations, presPath, 'notesMaster');
  if (current) return current;
  const path = unusedPath(state, 'notesMaster');
  part(path, masterXml(pres));
  const master = related(relations, presPath, 'slideMaster');
  const theme =
    master && related(part(relfile(master), rels([])), master, 'theme');
  // PowerPoint requires an independent theme part for its notes master,
  // even if its XML is identical to the theme of the slide master.
  const folder = theme
    ? theme.slice(0, theme.lastIndexOf('/'))
    : resolve(presPath, 'theme');
  const notesTheme = unusedPath(state, 'theme', folder);
  part(notesTheme, state.xml[theme] || template().xml['ppt/theme/theme1.xml']);
  if (theme && state.xml[relfile(theme)])
    part(relfile(notesTheme), state.xml[relfile(theme)]);
  ensureType(
    notesTheme,
    'application/vnd.openxmlformats-officedocument.theme+xml'
  );
  part(relfile(path), rels([['rId1', 'theme', relative(path, notesTheme)]]));
  const id = addRelation(
    relations,
    R + '/notesMaster',
    relative(presPath, path)
  );
  let list = child(pres.documentElement, 'notesMasterIdLst');
  if (!list) {
    list = pres.createElementNS(P, 'p:notesMasterIdLst');
    const next = children(pres.documentElement).find(
      (n) => n.localName !== 'sldMasterIdLst'
    );
    pres.documentElement.insertBefore(list, next || null);
  }
  const ref = pres.createElementNS(P, 'p:notesMasterId');
  ref.setAttributeNS(R, 'r:id', id);
  list.append(ref);
  ensureType(path, contentType + 'notesMaster+xml');
  return path;
}
function updateParagraph(p, value) {
  if (paragraphText(p) === value) return;
  const doc = p.ownerDocument;
  const runs = children(p).filter((n) =>
    ['r', 'fld', 'br'].includes(n.localName)
  );
  if (runs.length && runs.every((n) => n.localName === 'r' && child(n, 't'))) {
    const texts = runs.map((n) => child(n, 't'));
    const next = replaceRunText(
      texts.map((n) => n.textContent),
      value
    );
    texts.forEach((n, i) => {
      n.textContent = next[i];
    });
    return;
  }
  const props = child(runs[0], 'rPr')?.cloneNode(true);
  for (const n of runs) n.remove();
  if (value) {
    const r = doc.createElementNS(A, 'a:r'),
      t = doc.createElementNS(A, 'a:t');
    if (props) r.append(props);
    t.textContent = value;
    r.append(t);
    p.insertBefore(r, child(p, 'endParaRPr') || null);
  }
}
function setNotes(body, value) {
  const current = children(body, 'p');
  const next = value.replace(/\r\n?/g, '\n').split('\n');
  // A single notes paragraph can contain soft line breaks and styled runs.
  // Keep intact paragraphs on either side of a textarea edit.
  let start = 0,
    finish = current.length,
    firstLine = 0,
    lastLine = next.length;
  while (start < finish) {
    const lines = paragraphText(current[start]).split('\n');
    if (
      firstLine + lines.length > lastLine ||
      !lines.every((text, i) => text === next[firstLine + i])
    )
      break;
    start++;
    firstLine += lines.length;
  }
  while (finish > start) {
    const lines = paragraphText(current[finish - 1]).split('\n');
    if (
      lastLine - lines.length < firstLine ||
      !lines.every((text, i) => text === next[lastLine - lines.length + i])
    )
      break;
    finish--;
    lastLine -= lines.length;
  }
  const changed = next.slice(firstLine, lastLine);
  for (const [i, text] of changed.entries()) {
    const p =
      start + i < finish
        ? current[start + i]
        : body.ownerDocument.createElementNS(A, 'a:p');
    if (!p.parentNode) body.insertBefore(p, current[finish] || null);
    updateParagraph(p, text);
  }
  for (let i = start + changed.length; i < finish; i++) current[i].remove();
}
export function writeNotes(state, slide, previous, slidePath) {
  const value = slide.notes || '';
  if (value === (previous?.notes || '')) return;
  const { part, ensureType, addRelation } = state;
  const slideRels = part(relfile(slidePath), rels([]));
  let path = related(slideRels, slidePath, 'notesSlide');
  let doc, masterDoc;
  if (path && state.xml[path]) {
    doc = part(path);
    const notesRels = state.xml[relfile(path)] && part(relfile(path));
    const master = related(notesRels, path, 'notesMaster');
    if (master && state.xml[master]) masterDoc = part(master);
  } else {
    const master = ensureMaster(state);
    masterDoc = part(master);
    // Inherit each placeholder from the notes master by its native index.
    const indexOf = (type) => attr(masterPlaceholder(masterDoc, type), 'idx');
    const image = placeholder(2, 'sldImg', indexOf('sldImg')),
      body = placeholder(3, 'body', indexOf('body'));
    if (!path) {
      path = unusedPath(state, 'notesSlide');
      addRelation(slideRels, R + '/notesSlide', relative(slidePath, path));
    }
    doc = part(
      path,
      `<p:notes ${ns}><p:cSld><p:spTree>${treeStart}${image}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
    );
    part(
      relfile(path),
      rels([
        ['rId1', 'notesMaster', relative(path, master)],
        ['rId2', 'slide', relative(path, slidePath)],
      ])
    );
    ensureType(path, contentType + 'notesSlide+xml');
  }
  let shape = notesShape(doc, masterDoc);
  if (!shape) {
    const tree = desc(doc, 'spTree');
    const id =
      1 +
      Math.max(
        1,
        ...[...doc.getElementsByTagNameNS('*', 'cNvPr')].map(
          (n) => Number(attr(n, 'id')) || 0
        )
      );
    shape = doc.importNode(
      parse(
        `<p:root ${ns}>${placeholder(id, 'body', attr(masterPlaceholder(masterDoc, 'body'), 'idx', '2'))}</p:root>`
      ).documentElement.firstElementChild,
      true
    );
    tree.insertBefore(shape, child(tree, 'extLst') || null);
  }
  let body = child(shape, 'txBody');
  if (!body) {
    body = doc.importNode(
      parse(`<p:txBody ${ns}><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>`)
        .documentElement,
      true
    );
    shape.insertBefore(body, child(shape, 'extLst') || null);
  }
  setNotes(body, value);
}
