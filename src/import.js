import { readDocumentMetadata } from './document-metadata.js';
import { readLayerFlags } from './layer-xml.js';
import { readPictureMedia } from './media-xml.js';
import { readTable } from './table.js';
import { shape, slide } from './model.js';
import {
  parse,
  attr,
  children,
  child,
  desc,
  rid,
  resolve,
  relfile,
  R,
} from './xml.js';

export function relationships(xml, path) {
  const raw = xml[relfile(path)];
  return raw
    ? children(parse(raw).documentElement).map((n) => ({
        id: attr(n, 'Id'),
        external:
          attr(n, 'TargetMode') === 'External' ? attr(n, 'Target') : undefined,
        type: attr(n, 'Type').split('/').pop(),
        target:
          attr(n, 'TargetMode') === 'External'
            ? null
            : resolve(path, attr(n, 'Target')),
      }))
    : [];
}
const points = (node, key, fallback = 0) =>
  node?.hasAttribute(key) ? Number(attr(node, key)) / 12700 : fallback;
const first = (...values) =>
  values.find((v) => v !== undefined && v !== null && v !== '');
function color(node, theme, fallback = null) {
  if (!node) return fallback;
  const n = children(node)[0];
  if (!n) return fallback;
  let value = attr(n, 'val');
  if (n.localName === 'schemeClr')
    value = theme.colors[theme.map[value] || value];
  else if (n.localName === 'sysClr') value = attr(n, 'lastClr');
  else if (n.localName !== 'srgbClr') return fallback;
  if (!/^[a-f\d]{6}$/i.test(value || '')) return fallback;
  let channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  for (const mod of children(n)) {
    const amount = Number(attr(mod, 'val')) / 100000;
    if (mod.localName === 'tint' || mod.localName === 'lumOff')
      channels = channels.map((c) =>
        mod.localName === 'tint' ? 255 - (255 - c) * amount : c + 255 * amount
      );
    if (mod.localName === 'shade' || mod.localName === 'lumMod')
      channels = channels.map((c) => c * amount);
  }
  return (
    '#' +
    channels
      .map((c) =>
        Math.min(255, Math.max(0, Math.round(c)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
      .toUpperCase()
  );
}
function themeFor(theme, master, layout, page) {
  const result = {
    colors: {},
    map: { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' },
    major: 'Arial',
    minor: 'Arial',
  };
  for (const n of children(desc(theme, 'clrScheme')))
    result.colors[n.localName] =
      attr(children(n)[0], 'lastClr') || attr(children(n)[0], 'val');
  for (const map of [
    desc(master, 'clrMap'),
    desc(layout, 'overrideClrMapping'),
    desc(page, 'overrideClrMapping'),
  ]) {
    for (const a of map?.attributes || []) result.map[a.name] = a.value;
  }
  for (const k of ['minor', 'major']) {
    const group = desc(theme, k + 'Font');
    result[k] = attr(child(group, 'latin'), 'typeface', 'Arial');
    result[k + 'EA'] =
      attr(child(group, 'ea'), 'typeface') ||
      attr(
        children(group, 'font').find((n) => attr(n, 'script') === 'Jpan'),
        'typeface'
      ) ||
      result[k];
  }
  return result;
}
function fontName(n, theme) {
  const name = attr(n, 'typeface');
  if (name.startsWith('+mj'))
    return name.endsWith('-ea') ? theme.majorEA : theme.major;
  if (name.startsWith('+mn'))
    return name.endsWith('-ea') ? theme.minorEA : theme.minor;
  return name || undefined;
}
function textStyle(n, fallback, theme) {
  return {
    eastAsianFont: fontName(child(n, 'ea'), theme) || fallback.eastAsianFont,
    font:
      fontName(child(n, 'latin'), theme) ||
      fontName(child(n, 'ea'), theme) ||
      fallback.font,
    size: n?.hasAttribute('sz') ? Number(attr(n, 'sz')) / 100 : fallback.size,
    color: color(child(n, 'solidFill'), theme, fallback.color),
    bold: n?.hasAttribute('b')
      ? ['true', '1'].includes(attr(n, 'b'))
      : fallback.bold,
    italic: n?.hasAttribute('i')
      ? ['true', '1'].includes(attr(n, 'i'))
      : fallback.italic,
  };
}
const alignment = (n) =>
  ({ ctr: 'center', r: 'right', l: 'left', just: 'justify' })[attr(n, 'algn')];
function matchPlaceholder(node, tree) {
  const ph = desc(node, 'ph');
  if (!ph) return;
  const candidates = children(tree).filter((n) => desc(n, 'ph'));
  const idx = attr(ph, 'idx', '0'),
    type = attr(ph, 'type', 'obj');
  return (
    candidates.find(
      (n) =>
        attr(desc(n, 'ph'), 'idx', '0') === idx &&
        attr(desc(n, 'ph'), 'type', 'obj') === type
    ) ||
    candidates.find((n) => attr(desc(n, 'ph'), 'idx', '0') === idx) ||
    candidates.find((n) => attr(desc(n, 'ph'), 'type', 'obj') === type)
  );
}
function readPaths(custom) {
  const paths = [];
  for (const path of children(child(custom, 'pathLst'), 'path')) {
    const w = Number(attr(path, 'w')),
      h = Number(attr(path, 'h'));
    let pts = [];
    if (!w || !h) return;
    for (const cmd of children(path)) {
      if (cmd.localName === 'close') {
        if (pts.length) pts.push(pts[0]);
        continue;
      }
      if (!['moveTo', 'lnTo'].includes(cmd.localName)) return;
      if (cmd.localName === 'moveTo' && pts.length) {
        paths.push(pts);
        pts = [];
      }
      const p = child(cmd, 'pt'),
        x = Number(attr(p, 'x')),
        y = Number(attr(p, 'y'));
      if (!Number.isFinite(x + y)) return;
      pts.push([(x / w) * 1000, (y / h) * 1000]);
    }
    if (pts.length) paths.push(pts);
  }
  return paths.length ? paths : undefined;
}
function readShape(n, ctx, index, layer, master) {
  if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.localName)) return null;
  const styles = [n, layer, master].filter(Boolean);
  const props = styles.map((s) => child(s, 'spPr') || child(s, 'grpSpPr'));
  const xfrm = first(
    ...styles.map((s, i) => child(props[i], 'xfrm') || child(s, 'xfrm'))
  );
  const off = child(xfrm, 'off'),
    ext = child(xfrm, 'ext');
  const info = desc(n, 'cNvPr'),
    name = attr(info, 'name', 'Object');
  const geom = attr(first(...props.map((p) => child(p, 'prstGeom'))), 'prst');
  const body = child(n, 'txBody');
  const paths = readPaths(child(props[0], 'custGeom'));
  let kind =
    n.localName === 'sp' &&
    ['1', 'true'].includes(attr(desc(n, 'cNvSpPr'), 'txBox'))
      ? 'text'
      : n.localName === 'pic'
        ? 'image'
        : n.localName === 'grpSp'
          ? 'group'
          : n.localName === 'graphicFrame'
            ? 'unsupported'
            : paths
              ? 'path'
              : {
                  rect: 'rect',
                  roundRect: 'roundRect',
                  ellipse: 'ellipse',
                  triangle: 'triangle',
                  line: 'line',
                }[geom] ||
                (n.localName === 'cxnSp'
                  ? 'line'
                  : body && !geom
                    ? 'text'
                    : 'unsupported');
  const obj = shape(
    kind,
    name,
    points(off, 'x'),
    points(off, 'y'),
    points(ext, 'cx'),
    points(ext, 'cy'),
    {
      source: index,
      ...readLayerFlags(n),
      rotation: Number(attr(xfrm, 'rot', 0)) / 60000,
      flipH: ['1', 'true'].includes(attr(xfrm, 'flipH')),
      flipV: ['1', 'true'].includes(attr(xfrm, 'flipV')),
      fill: color(
        child(props[0], 'solidFill'),
        ctx.theme,
        child(props[0], 'noFill')
          ? null
          : color(desc(child(n, 'style'), 'fillRef'), ctx.theme)
      ),
      stroke: color(child(child(props[0], 'ln'), 'solidFill'), ctx.theme),
      strokeWidth: points(child(props[0], 'ln'), 'w', 1),
      ...(paths ? { paths } : {}),
    }
  );
  const table = n.localName === 'graphicFrame' && desc(n, 'tbl');
  if (table) {
    obj.kind = 'table';
    obj.table = readTable(table, ctx.theme, color, textStyle);
  }
  if (n.localName === 'pic') {
    const blip = desc(n, 'blip'),
      id = blip?.getAttributeNS(R, 'embed') || attr(blip, 'r:embed');
    obj.asset = ctx.rels.find((r) => r.id === id)?.target;
    const crop = desc(n, 'srcRect');
    obj.crop = ['l', 't', 'r', 'b'].map(
      (k) => Number(attr(crop, k, 0)) / 100000
    );
    if (!ctx.media[obj.asset]) obj.kind = 'unsupported';
    readPictureMedia(n, obj, ctx.rels);
  }
  if (n.localName === 'grpSp') {
    const o = child(xfrm, 'chOff'),
      e = child(xfrm, 'chExt');
    obj.childBox = [
      points(o, 'x'),
      points(o, 'y'),
      points(e, 'cx', obj.w) || 1,
      points(e, 'cy', obj.h) || 1,
    ];
    obj.items = children(n)
      .map((s, i) => readShape(s, ctx, i))
      .filter(Boolean);
  }
  if (body) {
    const bodies = styles.map((s) => child(s, 'txBody'));
    const bps = bodies.map((b) => child(b, 'bodyPr'));
    obj.inset = ['lIns', 'tIns', 'rIns', 'bIns'].map((k, i) =>
      points(
        bps.find((b) => b?.hasAttribute(k)),
        k,
        [7.2, 3.6, 7.2, 3.6][i]
      )
    );
    const anchor = first(...bps.map((b) => attr(b, 'anchor')));
    obj.valign = { ctr: 'middle', b: 'bottom' }[anchor] || 'top';
    const placeholder = attr(
      desc(n, 'ph'),
      'type',
      attr(desc(layer, 'ph'), 'type', 'obj')
    );
    const title = ['title', 'ctrTitle'].includes(placeholder);
    const masterStyle = desc(
      ctx.master,
      title ? 'titleStyle' : desc(n, 'ph') ? 'bodyStyle' : 'otherStyle'
    );
    obj.paragraphs = children(body, 'p').map((p) => {
      const pp = child(p, 'pPr'),
        level = 'lvl' + (1 + Number(attr(pp, 'lvl', 0))) + 'pPr';
      const defaults = [
        child(ctx.defaults, level),
        child(masterStyle, level),
        ...bodies
          .slice()
          .reverse()
          .map((b) => child(child(b, 'lstStyle'), level)),
        pp,
      ].filter(Boolean);
      const base = defaults.reduce(
        (s, d) => textStyle(child(d, 'defRPr'), s, ctx.theme),
        {
          font: title ? ctx.theme.major : ctx.theme.minor,
          eastAsianFont: title ? ctx.theme.majorEA : ctx.theme.minorEA,
          size: title ? 32 : 18,
          color: color(
            desc(child(n, 'style'), 'fontRef'),
            ctx.theme,
            '#222222'
          ),
          bold: false,
          italic: false,
        }
      );
      const runs = children(p)
        .filter((r) => ['r', 'br', 'fld'].includes(r.localName))
        .map((r) => ({
          text: r.localName === 'br' ? '\n' : child(r, 't')?.textContent || '',
          ...textStyle(child(r, 'rPr'), base, ctx.theme),
        }));
      const format = defaults.slice().reverse();
      const space = (key) => {
        const n = format.map((f) => child(f, key)).find(Boolean);
        return child(n, 'spcPts')
          ? Number(attr(child(n, 'spcPts'), 'val')) / 100
          : child(n, 'spcPct')
            ? (Number(attr(child(n, 'spcPct'), 'val')) / 100000) * base.size
            : 0;
      };
      const bullet = format
        .map((f) =>
          children(f).find((t) =>
            ['buNone', 'buChar', 'buAutoNum'].includes(t.localName)
          )
        )
        .find(Boolean);
      const indent = (key) =>
        Number(first(...format.map((f) => attr(f, key))) || 0) / 12700;
      const ls = format.map((f) => child(f, 'lnSpc')).find(Boolean);
      const lineHeight = child(ls, 'spcPts')
        ? Number(attr(child(ls, 'spcPts'), 'val')) / 100 + 'px'
        : child(ls, 'spcPct')
          ? (1.16 * Number(attr(child(ls, 'spcPct'), 'val'))) / 100000
          : undefined;
      return {
        runs,
        align: first(...format.map(alignment)) || 'left',
        base,
        before: space('spcBef'),
        after: space('spcAft'),
        margin: indent('marL'),
        indent: indent('indent'),
        lineHeight,
        bullet: bullet?.localName === 'buChar' ? attr(bullet, 'char') : '',
      };
    });
    obj.text = obj.paragraphs
      .map((p) => p.runs.map((r) => r.text).join(''))
      .join('\n');
    const firstPara = obj.paragraphs[0],
      s = firstPara?.runs[0] || firstPara?.base;
    if (s)
      for (const k of ['font', 'size', 'color', 'bold', 'italic'])
        obj[k] = s[k];
    obj.align = firstPara?.align || 'left';
  }
  return obj;
}
export function importDeck(parts) {
  const { xml, media } = parts;
  const rootRels = parse(xml['_rels/.rels'] || '<Relationships/>');
  const office = children(rootRels.documentElement).find((n) =>
    attr(n, 'Type').endsWith('/officeDocument')
  );
  const presPath = resolve('', attr(office, 'Target', 'ppt/presentation.xml'));
  if (!xml[presPath]) throw Error('The presentation part is missing.');
  const cache = new Map(),
    doc = (p) => {
      if (!xml[p]) return;
      if (!cache.has(p)) cache.set(p, parse(xml[p]));
      return cache.get(p);
    };
  const pres = doc(presPath),
    pr = relationships(xml, presPath),
    sz = desc(pres, 'sldSz');
  const slides = children(desc(pres, 'sldIdLst'), 'sldId').map((id, i) => {
    const source = pr.find((r) => r.id === rid(id))?.target,
      page = doc(source);
    if (!page) throw Error('Slide ' + (i + 1) + ' is missing.');
    const rel = relationships(xml, source),
      layoutPath = rel.find((r) => r.type === 'slideLayout')?.target,
      layout = doc(layoutPath);
    const masterPath =
        layoutPath &&
        relationships(xml, layoutPath).find((r) => r.type === 'slideMaster')
          ?.target,
      master = doc(masterPath);
    const themePath =
      masterPath &&
      relationships(xml, masterPath).find((r) => r.type === 'theme')?.target;
    const theme = themeFor(doc(themePath), master, layout, page);
    const ctx = {
      rels: rel,
      theme,
      master,
      media,
      defaults: desc(pres, 'defaultTextStyle'),
    };
    const lt = desc(layout, 'spTree'),
      mt = desc(master, 'spTree');
    const items = children(desc(page, 'spTree'))
      .map((n, idx) => {
        const ln = matchPlaceholder(n, lt);
        return readShape(n, ctx, idx, ln, matchPlaceholder(ln || n, mt));
      })
      .filter(Boolean);
    const bg = first(
      ...[page, layout, master].map(
        (d) =>
          color(desc(desc(d, 'bgPr'), 'solidFill'), theme) ||
          color(desc(d, 'bgRef'), theme)
      ),
      '#FFFFFF'
    );
    const name = attr(desc(page, 'cSld'), 'name');
    const s = {
      ...slide(name, bg, items),
      source,
      layoutPath,
      relId: rid(id),
      slideId: attr(id, 'id'),
    };
    for (const [tree, path, show] of [
      [
        mt,
        masterPath,
        attr(layout?.documentElement, 'showMasterSp') !== '0' &&
          attr(page.documentElement, 'showMasterSp') !== '0',
      ],
      [lt, layoutPath, attr(page.documentElement, 'showMasterSp') !== '0'],
    ]) {
      if (show && path)
        s.back.push(
          ...children(tree)
            .filter((n) => !desc(n, 'ph'))
            .map((n, i) =>
              readShape(n, { ...ctx, rels: relationships(xml, path) }, i)
            )
            .filter(Boolean)
        );
    }
    return s;
  });
  if (!slides.length)
    throw Error('This presentation contains no editable slides.');
  return {
    deck: readDocumentMetadata(
      { w: points(sz, 'cx', 960), h: points(sz, 'cy', 540), slides },
      xml,
      presPath,
      doc
    ),
    presPath,
  };
}
