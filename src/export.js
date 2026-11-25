import { layoutPatches, placeholderShape } from './slide-layouts.js';
import {
  geometryXML,
  strokeXML,
  connectorXML,
  patchVector,
} from './vector-xml.js';
import { writeDocumentMetadata } from './document-metadata.js';
import { syncLayerTree, groupXML } from './layer-xml.js';
import { createPictureWriter, discardUnlinkedMedia } from './media-xml.js';
import {
  A,
  P,
  R,
  PKG,
  TYPES,
  ns,
  namespaceDialect,
  attr,
  child,
  children,
  desc,
  emu,
  esc,
  parse,
  rawSlide,
  relative,
  relfile,
  rels,
  rid,
  serialize,
  solid,
} from './xml.js';
import { relationships } from './import.js';
import { replaceRunText, updateText } from './text.js';
import { template, slideType } from './template.js';

const xfrm = (o) =>
  `<a:xfrm${o.rotation ? ' rot="' + Math.round(o.rotation * 60000) + '"' : ''}${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}><a:off x="${emu(o.x)}" y="${emu(o.y)}"/><a:ext cx="${emu(o.w)}" cy="${emu(o.h)}"/></a:xfrm>`;
const align = (s) =>
  ({ left: 'l', right: 'r', center: 'ctr', justify: 'just' })[s] || 'l';
const typefaces = (o) =>
  ['latin', 'ea', 'cs']
    .map(
      (s) =>
        `<a:${s} typeface="${esc(s === 'ea' ? o.eastAsianFont || o.font : o.font)}"/>`
    )
    .join('');
function lineSpacingXml(value) {
  return typeof value === 'string'
    ? '<a:spcPts val="' + Math.round(parseFloat(value) * 100) + '"/>'
    : '<a:spcPct val="' + Math.round((value || 1) * 100000) + '"/>';
}
function textBody(o) {
  const [l, t, r, b] = o.inset.map(emu);
  let paragraphs = o.paragraphs;
  if (
    paragraphs &&
    paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') !==
      o.text
  ) {
    const normalized = { ...o };
    updateText(normalized, o.text);
    paragraphs = normalized.paragraphs;
  }
  paragraphs ??= o.text.split('\n').map((text) => ({ runs: [{ ...o, text }] }));
  const runProps = (style) =>
    `lang="ja-JP" spc="${Math.round((style.letterSpacing || 0) * 100)}" sz="${Math.round(style.size * 100)}" b="${Number(Boolean(style.bold))}" i="${Number(Boolean(style.italic))}"`;
  const runs = paragraphs
    .map((p) => {
      const style = p.base || o;
      const bullet = p.bullet
        ? `<a:buChar char="${esc(p.bullet)}"/>`
        : '<a:buNone/>';
      const props = `<a:pPr algn="${align(p.align || o.align)}" marL="${emu(p.margin || 0)}" indent="${emu(p.indent || 0)}"><a:lnSpc>${lineSpacingXml(p.lineHeight ?? o.lineHeight)}</a:lnSpc><a:spcBef><a:spcPts val="${Math.round((p.before || 0) * 100)}"/></a:spcBef><a:spcAft><a:spcPts val="${Math.round((p.after || 0) * 100)}"/></a:spcAft>${bullet}</a:pPr>`;
      const text = p.runs
        .map((run) => {
          const attrs = `<a:rPr ${runProps(run)}>${solid(run.color)}${typefaces(run)}</a:rPr>`;
          return run.text
            .split('\n')
            .map((line) => `<a:r>${attrs}<a:t>${esc(line)}</a:t></a:r>`)
            .join(`<a:br>${attrs}</a:br>`);
        })
        .join('');
      return `<a:p>${props}${text}<a:endParaRPr ${runProps(style)}>${solid(style.color)}${typefaces(style)}</a:endParaRPr></a:p>`;
    })
    .join('');
  return `<p:txBody><a:bodyPr wrap="${o.autoWidth ? 'none' : 'square'}" lIns="${l}" tIns="${t}" rIns="${r}" bIns="${b}" anchor="${{ middle: 'ctr', bottom: 'b' }[o.valign] || 't'}">${o.autoWidth ? '<a:spAutoFit/>' : '<a:noAutofit/>'}</a:bodyPr><a:lstStyle/>${runs}</p:txBody>`;
}
function shapeXML(o, id) {
  if (o.kind === 'line') return connectorXML(o, id, xfrm(o));
  const name = `<p:cNvPr id="${id}" name="${esc(o.name)}"/>`;
  return `<p:sp><p:nvSpPr>${name}<p:cNvSpPr${o.kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(o)}${geometryXML(o)}${solid(o.fill)}${strokeXML(o)}</p:spPr>${o.kind === 'text' || o.text ? textBody(o) : ''}</p:sp>`;
}
const fragment = (doc, xml) =>
  doc.importNode(
    parse(`<p:root ${ns}>${xml}</p:root>`).documentElement.firstElementChild,
    true
  );
function ensure(parent, space, tag, before) {
  const name = tag.split(':').pop();
  let n = child(parent, name);
  if (!n) {
    n = parent.ownerDocument.createElementNS(space, tag);
    parent.insertBefore(n, before || null);
  }
  return n;
}
function replacePaint(parent, hex, before) {
  children(parent)
    .filter((n) =>
      [
        'noFill',
        'solidFill',
        'gradFill',
        'blipFill',
        'pattFill',
        'grpFill',
      ].includes(n.localName)
    )
    .forEach((n) => n.remove());
  parent.insertBefore(
    fragment(parent.ownerDocument, solid(hex)),
    before || null
  );
}
function patchOriginal(n, o, old, reparented = false) {
  const doc = n.ownerDocument,
    changed = (k) => o[k] !== old[k];
  if (changed('name')) desc(n, 'cNvPr')?.setAttribute('name', o.name);
  if (
    reparented ||
    ['x', 'y', 'w', 'h', 'rotation', 'flipH', 'flipV'].some(changed)
  ) {
    const parent =
      n.localName === 'graphicFrame'
        ? n
        : child(n, 'grpSpPr') || child(n, 'spPr');
    if (parent) {
      const frame = n.localName === 'graphicFrame';
      const xf = ensure(
        parent,
        frame ? P : A,
        frame ? 'p:xfrm' : 'a:xfrm',
        frame ? child(n, 'graphic') : parent.firstElementChild
      );
      const off = ensure(xf, A, 'a:off', xf.firstElementChild);
      const ext = ensure(xf, A, 'a:ext', off.nextElementSibling);
      for (const [el, k, v] of [
        [off, 'x', o.x],
        [off, 'y', o.y],
        [ext, 'cx', o.w],
        [ext, 'cy', o.h],
      ])
        el.setAttribute(k, emu(v));
      for (const key of ['flipH', 'flipV'])
        if (changed(key)) xf.setAttribute(key, o[key] ? '1' : '0');
      if (changed('rotation'))
        xf.setAttribute('rot', Math.round(o.rotation * 60000));
    }
  }
  if (changed('fill') && child(n, 'spPr')) {
    const sp = child(n, 'spPr');
    replacePaint(
      sp,
      o.fill,
      children(sp).find((el) =>
        ['ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'].includes(
          el.localName
        )
      )
    );
  }
  patchVector(n, o, old, fragment);
  const body = child(n, 'txBody');
  if (changed('text')) {
    const next = fragment(doc, textBody(o));
    if (body) {
      // Reuse run and paragraph markup for edits within existing paragraphs.
      // A run keeps its formatting and hyperlink when its characters survive.
      const paragraphs = children(body, 'p'),
        lines = children(next, 'p').map((p) =>
          children(p)
            .filter((r) => ['r', 'fld', 'br'].includes(r.localName))
            .map((r) =>
              r.localName === 'br' ? '\n' : child(r, 't')?.textContent || ''
            )
            .join('')
        );
      lines.forEach((line, i) => {
        const p = paragraphs[i];
        if (!p) {
          body.appendChild(
            o.placeholder
              ? fragment(
                  doc,
                  '<a:p><a:r><a:t>' + esc(line) + '</a:t></a:r></a:p>'
                )
              : children(next, 'p')[i].cloneNode(true)
          );
          return;
        }
        const runs = children(p).filter((r) =>
          ['r', 'fld', 'br'].includes(r.localName)
        );
        const prior =
          old.paragraphs?.[i]?.runs.map((r) => r.text).join('') ?? '';
        if (line === prior) return;
        if (!runs.length && o.placeholder) {
          // Inherit placeholder layout and list style, including themed fonts.
          p.insertBefore(
            fragment(doc, '<a:r><a:t>' + esc(line) + '</a:t></a:r>'),
            child(p, 'endParaRPr') || null
          );
          return;
        }
        if (!runs.length || runs.some((r) => r.localName === 'br')) {
          p.replaceWith(children(next, 'p')[i].cloneNode(true));
          return;
        }
        const texts = runs.map((run) => child(run, 't')).filter(Boolean);
        const values = replaceRunText(
          texts.map((t) => t.textContent),
          line
        );
        texts.forEach((t, j) => {
          t.textContent = values[j];
        });
      });
      paragraphs.slice(lines.length).forEach((p) => p.remove());
    } else n.appendChild(next);
  }
  const tb = child(n, 'txBody');
  if (!tb) return;
  if (JSON.stringify(old.inset) !== JSON.stringify(o.inset)) {
    const props = ensure(tb, A, 'a:bodyPr', tb.firstElementChild);
    ['lIns', 'tIns', 'rIns', 'bIns'].forEach((k, i) =>
      props.setAttribute(k, emu(o.inset[i]))
    );
  }
  if (Boolean(o.autoWidth) !== Boolean(old.autoWidth)) {
    const props = ensure(tb, A, 'a:bodyPr', tb.firstElementChild);
    props.setAttribute('wrap', o.autoWidth ? 'none' : 'square');
    const target = fragment(
      doc,
      o.autoWidth ? '<a:spAutoFit/>' : '<a:noAutofit/>'
    );
    const existing = children(props).find((el) =>
      ['spAutoFit', 'noAutofit', 'normAutofit'].includes(el.localName)
    );
    if (existing) existing.replaceWith(target);
    else
      props.insertBefore(
        target,
        child(props, 'scene3d') ||
          child(props, 'sp3d') ||
          child(props, 'extLst') ||
          null
      );
  }
  for (const [paragraphIndex, p] of children(tb, 'p').entries()) {
    const current = o.paragraphs?.[paragraphIndex] || o,
      prior = old.paragraphs?.[paragraphIndex] || old;
    if (current && prior) {
      const ppr = () => ensure(p, A, 'a:pPr', p.firstElementChild);
      if (current.margin !== prior.margin)
        ppr().setAttribute('marL', emu(current.margin || 0));
      if (current.indent !== prior.indent)
        ppr().setAttribute('indent', emu(current.indent || 0));
      for (const [key, element] of [
        ['before', 'spcBef'],
        ['after', 'spcAft'],
        ['lineHeight', 'lnSpc'],
      ]) {
        if (current[key] === prior[key]) continue;
        const val =
          element === 'lnSpc' && typeof current.lineHeight === 'string'
            ? parseFloat(current.lineHeight)
            : current[key];
        if (!Number.isFinite(val)) continue;
        const parent = ppr(),
          oldSpacing = child(parent, element),
          spacing = fragment(
            doc,
            `<a:${element}>${element === 'lnSpc' ? lineSpacingXml(current.lineHeight) : '<a:spcPts val="' + Math.round(val * 100) + '"/>'}</a:${element}>`
          );
        if (oldSpacing) oldSpacing.replaceWith(spacing);
        else {
          const order = ['lnSpc', 'spcBef', 'spcAft'];
          const insert = children(parent).find(
            (e) =>
              !order.includes(e.localName) ||
              order.indexOf(e.localName) > order.indexOf(element)
          );
          parent.insertBefore(spacing, insert || null);
        }
      }
    }
    if (changed('align'))
      ensure(p, A, 'a:pPr', p.firstElementChild).setAttribute(
        'algn',
        align(o.align)
      );
    const styleChanged = (key) =>
      changed(key) ||
      Boolean(
        current.base &&
        prior.base &&
        (current.base[key] !== prior.base[key] ||
          current.runs.some(
            (r, i) => prior.runs[i] && r[key] !== prior.runs[i][key]
          ))
      );
    if (
      !['size', 'font', 'bold', 'italic', 'color', 'letterSpacing'].some(
        styleChanged
      )
    )
      continue;
    const ppr = ensure(p, A, 'a:pPr', p.firstElementChild);
    const props = [
      ensure(ppr, A, 'a:defRPr', child(ppr, 'extLst')),
      ...children(p)
        .filter((r) => ['r', 'br', 'fld'].includes(r.localName))
        .map((r) => ensure(r, A, 'a:rPr', r.firstElementChild)),
      ensure(p, A, 'a:endParaRPr'),
    ];
    for (const [i, rp] of props.entries()) {
      const style = current.runs?.[i - 1] || current.base || o;
      const size = style.size;
      for (const [k, xmlKey, v] of [
        ['size', 'sz', Math.round(size * 100)],
        ['letterSpacing', 'spc', Math.round((style.letterSpacing || 0) * 100)],
        ['bold', 'b', +style.bold],
        ['italic', 'i', +style.italic],
      ])
        if (styleChanged(k)) rp.setAttribute(xmlKey, v);
      if (styleChanged('color'))
        replacePaint(
          rp,
          style.color,
          children(rp).find(
            (el) =>
              ![
                'ln',
                'noFill',
                'solidFill',
                'gradFill',
                'blipFill',
                'pattFill',
                'grpFill',
              ].includes(el.localName)
          )
        );
      if (styleChanged('font')) {
        const order = [
          'latin',
          'ea',
          'cs',
          'sym',
          'hlinkClick',
          'hlinkMouseOver',
          'rtl',
          'extLst',
        ];
        for (const f of order.slice(0, 3))
          ensure(
            rp,
            A,
            'a:' + f,
            children(rp).find(
              (el) => order.indexOf(el.localName) > order.indexOf(f)
            )
          ).setAttribute(
            'typeface',
            f === 'ea' ? style.eastAsianFont || style.font : style.font
          );
      }
    }
  }
}
export function exportDeck(deck, base, assets = {}) {
  const original = base?.parts || template();
  const addedLayouts = layoutPatches(deck, original.xml);
  const source = { ...original, xml: { ...original.xml, ...addedLayouts } },
    xml = source.xml;
  const commentNodes = new Map();
  const changes = { xml: base ? { ...addedLayouts } : { ...xml }, media: {} };
  const presPath = base?.presPath || 'ppt/presentation.xml',
    dir = presPath.slice(0, presPath.lastIndexOf('/') + 1);
  const pres = parse(xml[presPath]),
    pr = parse(xml[relfile(presPath)]),
    types = parse(xml['[Content_Types].xml']);
  const list =
    desc(pres, 'sldIdLst') ||
    ensure(pres.documentElement, P, 'p:sldIdLst', desc(pres, 'sldSz'));
  const order = [];
  const detachedMedia = new Set();
  let sequence = Math.max(
      255,
      ...children(list).map((n) => Number(attr(n, 'id')))
    ),
    partIndex = 1,
    structure = false,
    typesChanged = false;
  function relation(doc, type, target) {
    let i = 1;
    const root = doc.documentElement,
      used = new Set(children(root).map((el) => attr(el, 'Id')));
    while (used.has('rId' + i)) i++;
    const el = doc.createElementNS(PKG, 'Relationship');
    el.setAttribute('Id', 'rId' + i);
    el.setAttribute('Type', R + '/' + type);
    el.setAttribute('Target', target);
    root.appendChild(el);
    return 'rId' + i;
  }
  const defaultLayout = Object.keys(xml).find((p) =>
    /\/slideLayouts\/[^/]+\.xml$/.test(p)
  );
  for (const s of deck.slides) {
    const old = base?.deck.slides.find((x) => x.id === s.id);
    if (s.relId) order.push(s.relId);
    if (old && JSON.stringify(s) === JSON.stringify(old)) continue;
    let path = s.source,
      sr,
      doc;
    if (!path) {
      do {
        path = dir + 'slides/slide' + partIndex + '.xml';
        partIndex++;
      } while (xml[path] || changes.xml[path]);
      const rel = relation(pr, 'slide', relative(presPath, path));
      order.push(rel);
      const si = pres.createElementNS(P, 'p:sldId');
      si.setAttribute('id', ++sequence);
      si.setAttributeNS(R, 'r:id', rel);
      list.appendChild(si);
      const override = types.createElementNS(TYPES, 'Override');
      override.setAttribute('PartName', '/' + path);
      override.setAttribute('ContentType', slideType);
      types.documentElement.appendChild(override);
      const layoutPath = xml[s.layoutPath] ? s.layoutPath : defaultLayout;
      if (!layoutPath) throw Error('The slide layout is missing.');
      sr = parse(rels([['rId1', 'slideLayout', relative(path, layoutPath)]]));
      doc = parse(rawSlide(s.name, s.bg));
      if (s.inheritBackground === s.bg) desc(doc, 'bg')?.remove();
      structure = true;
      typesChanged = true;
    } else {
      doc = parse(xml[path]);
      sr = parse(xml[relfile(path)] || rels([]));
      if (s.bg !== old.bg) {
        const c = desc(doc, 'cSld'),
          bg = fragment(
            doc,
            `<p:bg><p:bgPr>${solid(s.bg)}<a:effectLst/></p:bgPr></p:bg>`
          );
        if (child(c, 'bg')) child(c, 'bg').replaceWith(bg);
        else c.insertBefore(bg, c.firstElementChild);
      }
      if (s.name !== old.name) desc(doc, 'cSld').setAttribute('name', s.name);
    }
    const tree = desc(doc, 'spTree');
    let id = Math.max(
      1,
      ...Array.from(doc.getElementsByTagNameNS('*', 'cNvPr'), (n) =>
        Number(attr(n, 'id', 1))
      )
    );
    let relChanged = !s.source;
    const pictures = createPictureWriter({
      doc,
      path,
      sr,
      types,
      changes,
      assets,
      source,
      onRelationsChanged: () => {
        relChanged = true;
      },
      onTypesChanged: () => {
        typesChanged = true;
      },
    });
    syncLayerTree(
      tree,
      old?.items || [],
      s.items,
      (o) => {
        id++;
        if (o.placeholder && o.layoutOriginal) {
          const node = fragment(doc, placeholderShape(o, id));
          patchOriginal(node, o, o.layoutOriginal);
          return node;
        }
        if (o.kind === 'group') return fragment(doc, groupXML(o, id));
        if (o.kind === 'image' || o.kind === 'video')
          return fragment(doc, pictures.create(o, id, xfrm(o)));
        return fragment(doc, shapeXML(o, id));
      },
      (node, o, initial, reparented) => {
        patchOriginal(node, o, initial, reparented);
        if (o.kind === 'image' || o.kind === 'video')
          pictures.patch(node, o, initial);
      },
      s.comments?.some((c) => c.objectId)
        ? (o, node) => commentNodes.set(o.id, node)
        : null
    );
    pictures.finish(detachedMedia);
    changes.xml[path] = serialize(doc);
    if (relChanged) changes.xml[relfile(path)] = serialize(sr);
  }
  const deleted = (base?.deck.slides || []).filter(
    (s) => !deck.slides.some((current) => current.id === s.id)
  );
  const deadPaths = new Set(deleted.map((s) => s.source));
  for (const s of deleted) {
    children(list)
      .find((n) => rid(n) === s.relId)
      ?.remove();
    children(pr.documentElement)
      .find((n) => attr(n, 'Id') === s.relId)
      ?.remove();
    for (const n of pres.getElementsByTagNameNS('*', 'sld'))
      if (rid(n) === s.relId) n.remove();
    for (const n of [...pres.getElementsByTagNameNS('*', 'sldId')])
      if (attr(n, 'id') === s.slideId) n.remove();
    structure = true;
  }
  if (children(list).map(rid).join('/') !== order.join('/')) {
    const nodes = new Map(children(list).map((n) => [rid(n), n]));
    for (const id of order) if (nodes.has(id)) list.appendChild(nodes.get(id));
    structure = true;
  }
  if (structure) {
    changes.xml[presPath] = serialize(pres);
    changes.xml[relfile(presPath)] = serialize(pr);
  }
  if (deleted.length) {
    // Links and notes may point back to a deleted slide. Drop those references,
    // then remove only parts that became unreachable because of the deletion.
    const edited = { ...xml, ...changes.xml };
    for (const path of Object.keys(edited).filter(
      (k) => k.includes('/_rels/') && k.endsWith('.rels')
    )) {
      const owner = path.replace('/_rels/', '/').slice(0, -5);
      const gone = relationships(edited, owner).filter((r) =>
        deadPaths.has(r.target)
      );
      if (!gone.length || !edited[owner]) continue;
      const relDoc = parse(edited[path]),
        partDoc = parse(edited[owner]);
      for (const r of gone) {
        children(relDoc.documentElement)
          .find((n) => attr(n, 'Id') === r.id)
          ?.remove();
        for (const n of [...partDoc.getElementsByTagName('*')])
          if (rid(n) === r.id) {
            if (n.localName.startsWith('hlink')) n.remove();
            else n.removeAttributeNS(R, 'id');
          }
      }
      changes.xml[path] = edited[path] = serialize(relDoc);
      changes.xml[owner] = edited[owner] = serialize(partDoc);
    }
    function reachable(parts) {
      const seen = new Set(),
        stack = children(parse(parts['_rels/.rels']).documentElement)
          .filter((n) => attr(n, 'TargetMode') !== 'External')
          .map((n) => attr(n, 'Target').replace(/^\//, ''));
      while (stack.length) {
        const p = stack.pop();
        if (seen.has(p)) continue;
        seen.add(p);
        if (parts[relfile(p)]) {
          seen.add(relfile(p));
          for (const r of relationships(parts, p))
            if (r.target) stack.push(r.target);
        }
      }
      return seen;
    }
    const after = reachable(edited);
    changes.removed = [...reachable(xml)].filter((p) => !after.has(p));
    for (const p of changes.removed) {
      delete changes.xml[p];
      children(types.documentElement)
        .find((el) => attr(el, 'PartName') === '/' + p)
        ?.remove();
    }
    typesChanged = true;
  }
  if (discardUnlinkedMedia(xml, changes, types, detachedMedia))
    typesChanged = true;
  if (typesChanged) changes.xml['[Content_Types].xml'] = serialize(types);
  writeDocumentMetadata(deck, base, changes, xml, presPath, commentNodes);
  if (
    xml[presPath].includes('http://purl.oclc.org/ooxml/presentationml/main')
  ) {
    for (const [name, value] of Object.entries(changes.xml))
      changes.xml[name] = namespaceDialect(value, true);
  }
  return changes;
}
