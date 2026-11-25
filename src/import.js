import { readNotes } from './notes.js';
import { readContours, readLineStyle } from './vector-xml.js';
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
const percent = (value) =>
  value.endsWith('%') ? parseFloat(value) / 100 : Number(value) / 100000;
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
  let alpha = 1;
  for (const mod of children(n)) {
    const raw = attr(mod, 'val');
    const amount = percent(raw);
    if (mod.localName === 'alpha') alpha = amount;
    if (mod.localName === 'alphaMod') alpha *= amount;
    if (mod.localName === 'alphaOff') alpha += amount;
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
      .toUpperCase() +
    (alpha < 1
      ? Math.round(Math.max(0, alpha) * 255)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase()
      : '')
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
    result[k + 'Scripts'] = Object.fromEntries(
      children(group, 'font').map((n) => [
        attr(n, 'script'),
        attr(n, 'typeface'),
      ])
    );
    result[k + 'EastAsianFace'] = attr(child(group, 'ea'), 'typeface');
    result[k + 'EA'] =
      result[k + 'EastAsianFace'] || result[k + 'Scripts'].Jpan || result[k];
  }
  return result;
}
function eastAsianFace(theme, group, lang, altLang) {
  const locale = [lang, altLang].find((s) => /^(?:zh|ko|ja)(?:-|$)/i.test(s));
  if (!locale || theme[group + 'EastAsianFace']) return theme[group + 'EA'];
  const script = /^ko/i.test(locale)
    ? 'Hang'
    : /^ja/i.test(locale)
      ? 'Jpan'
      : /(?:-Hant|-TW|-HK|-MO)(?:-|$)/i.test(locale)
        ? 'Hant'
        : 'Hans';
  return theme[group + 'Scripts']?.[script] || theme[group + 'EA'];
}
function fontName(n, theme, lang, altLang) {
  const name = attr(n, 'typeface');
  if (name.startsWith('+mj') || name.startsWith('+mn')) {
    const group = name.startsWith('+mj') ? 'major' : 'minor';
    return name.endsWith('-ea')
      ? eastAsianFace(theme, group, lang, altLang)
      : theme[group];
  }
  return name || undefined;
}
function textStyle(n, fallback, theme) {
  const lang = attr(n, 'lang') || fallback.lang;
  const altLang = attr(n, 'altLang') || fallback.altLang;
  const latin = child(n, 'latin'),
    east = child(n, 'ea');
  // An explicitly named font with no charset differs from a theme reference.
  const charset = (slot, inherited) => {
    if (!slot) return inherited;
    return attr(slot, 'typeface').startsWith('+')
      ? undefined
      : attr(slot, 'charset');
  };
  return {
    lang,
    altLang,
    fontCharset: charset(latin, fallback.fontCharset),
    eastAsianCharset: charset(east, fallback.eastAsianCharset),
    fallbackFont: theme.minor,
    eastAsianFallback: eastAsianFace(theme, 'minor', lang, altLang),
    kern: n?.hasAttribute('kern')
      ? Number(attr(n, 'kern')) / 100
      : fallback.kern,
    letterSpacing: n?.hasAttribute('spc')
      ? Number(attr(n, 'spc')) / 100
      : fallback.letterSpacing || 0,
    eastAsianFont:
      fontName(east, theme, lang, altLang) || fallback.eastAsianFont,
    font: fontName(latin, theme, lang, altLang) || fallback.font,
    size: n?.hasAttribute('sz') ? Number(attr(n, 'sz')) / 100 : fallback.size,
    color: color(child(n, 'solidFill'), theme, fallback.color),
    highlight: color(child(n, 'highlight'), theme, fallback.highlight),
    underline: attr(n, 'u') || fallback.underline,
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
  const contours = readContours(child(props[0], 'custGeom'), {
    w: Number(attr(ext, 'cx')),
    h: Number(attr(ext, 'cy')),
  });
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
            : contours
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
  const ln = child(props[0], 'ln'),
    lnRef = child(child(n, 'style'), 'lnRef');
  const defaultStroke = kind === 'line' ? '#222521' : null;
  const inheritedStroke =
    Number(attr(lnRef, 'idx')) > 0
      ? color(lnRef, ctx.theme, defaultStroke)
      : defaultStroke;
  const obj = shape(
    kind,
    name,
    points(off, 'x'),
    points(off, 'y'),
    points(ext, 'cx'),
    points(ext, 'cy'),
    {
      source: index,
      officeId: attr(info, 'id'),
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
      stroke: color(
        child(ln, 'solidFill'),
        ctx.theme,
        child(ln, 'noFill') ? null : inheritedStroke
      ),
      strokeWidth: points(ln, 'w', 1),
      ...(contours ? { contours } : {}),
      ...readLineStyle(ln),
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
    const ph = desc(child(n, 'nvSpPr'), 'ph');
    if (ph) {
      obj.placeholder = Object.fromEntries(
        [...ph.attributes].map((a) => [a.name, a.value])
      );
      if (kind === 'rect' || kind === 'unsupported') obj.kind = 'text';
    }
    const bodies = styles.map((s) => child(s, 'txBody'));
    const bps = bodies.map((b) => child(b, 'bodyPr'));
    const bodyAttr = (key) => first(...bps.map((b) => attr(b, key)));
    const fitting = bps
      .map((b) =>
        children(b).find((c) =>
          ['spAutoFit', 'normAutofit', 'noAutofit'].includes(c.localName)
        )
      )
      .find(Boolean);
    const noWrap = bodyAttr('wrap') === 'none';
    obj.autoWidth = noWrap && fitting?.localName === 'spAutoFit';
    if (noWrap && !obj.autoWidth) obj.noWrap = true;
    if (['1', 'true'].includes(bodyAttr('spcFirstLastPara')))
      obj.spaceAtEdges = true;
    obj.inset = ['lIns', 'tIns', 'rIns', 'bIns'].map((k, i) =>
      points(
        bps.find((b) => b?.hasAttribute(k)),
        k,
        [7.2, 3.6, 7.2, 3.6][i]
      )
    );
    const anchor = bodyAttr('anchor');
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
      const lists = [
        ctx.defaults,
        masterStyle,
        ...bodies.map((b) => child(b, 'lstStyle')).reverse(),
      ];
      const defaults = lists
        .flatMap((list) => [child(list, 'defPPr'), child(list, level)])
        .concat(pp)
        .filter(Boolean);
      const base = defaults.reduce(
        (s, d) => textStyle(child(d, 'defRPr'), s, ctx.theme),
        {
          font: title ? ctx.theme.major : ctx.theme.minor,
          eastAsianFont: title ? ctx.theme.majorEA : ctx.theme.minorEA,
          fallbackFont: ctx.theme.minor,
          eastAsianFallback: ctx.theme.minorEA,
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
            ? percent(attr(child(n, 'spcPct'), 'val')) * base.size
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
          ? percent(attr(child(ls, 'spcPct'), 'val'))
          : undefined;
      return {
        runs,
        align: first(...format.map(alignment)) || 'left',
        // In an empty Office paragraph the paragraph mark supplies the glyph
        // metrics and insertion formatting, even when no a:r is present.
        base: runs.some((r) => r.text)
          ? base
          : textStyle(child(p, 'endParaRPr'), base, ctx.theme),
        before: space('spcBef'),
        after: space('spcAft'),
        margin: indent('marL'),
        marginRight: indent('marR'),
        indent: indent('indent'),
        lineHeight,
        bullet: bullet?.localName === 'buChar' ? attr(bullet, 'char') : '',
      };
    });
    obj.text = obj.paragraphs
      .map((p) => p.runs.map((r) => r.text).join(''))
      .join('\n');
    const firstPara = obj.paragraphs[0],
      s = firstPara?.runs.find((r) => r.text) || firstPara?.base;
    if (s)
      for (const k of [
        'font',
        'eastAsianFont',
        'fontCharset',
        'eastAsianCharset',
        'fallbackFont',
        'eastAsianFallback',
        'lang',
        'altLang',
        'kern',
        'size',
        'color',
        'bold',
        'italic',
        'letterSpacing',
      ])
        obj[k] = s[k];
    obj.lineHeight = firstPara?.lineHeight;
    obj.align = firstPara?.align || 'left';
  }
  return obj;
}
export function readSlidePage({
  xml,
  media,
  doc,
  pres,
  page,
  rel,
  layoutPath,
}) {
  const layout = doc(layoutPath);
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
    layoutPath,
    themeColors: Object.values(theme.colors)
      .filter((v) => /^[\da-f]{6}$/i.test(v))
      .map((v) => '#' + v),
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
      layoutPath = rel.find((r) => r.type === 'slideLayout')?.target;
    return {
      ...readSlidePage({ xml, media, doc, pres, page, rel, layoutPath }),
      notes: readNotes(rel.find((r) => r.type === 'notesSlide')?.target, doc),
      source,
      relId: rid(id),
      slideId: attr(id, 'id'),
    };
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
