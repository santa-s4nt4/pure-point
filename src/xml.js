export const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PKG =
  'http://schemas.openxmlformats.org/package/2006/relationships';
export const TYPES =
  'http://schemas.openxmlformats.org/package/2006/content-types';
export const ns = `xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`;
export const esc = (v) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export const children = (n, k) =>
  [...(n?.children || [])].filter((e) => !k || e.localName === k);
export const child = (n, k) => children(n, k)[0];
export const desc = (n, k) => n?.getElementsByTagNameNS('*', k)[0];
export const attr = (n, k, d = '') => n?.getAttribute(k) ?? d;
export const rid = (n) => n?.getAttributeNS(R, 'id') || attr(n, 'r:id');
const strictBase = 'http://purl.oclc.org/ooxml/';
const namespacePairs = [
  [P, strictBase + 'presentationml/main'],
  [A, strictBase + 'drawingml/main'],
  [R, strictBase + 'officeDocument/relationships'],
];
// Normalize only namespace declarations and relationship Type attributes. A URI
// used as slide text or as a hyperlink target belongs to the presentation.
export function namespaceDialect(xml, toStrict) {
  return xml.replace(
    /(\s(?:xmlns(?::[\w.-]+)?|Type)\s*=\s*)(["'])([^"']*)\2/g,
    (all, attr, quote, value) => {
      for (const pair of namespacePairs) {
        const from = pair[toStrict ? 0 : 1],
          to = pair[toStrict ? 1 : 0];
        if (value === from || value.startsWith(from + '/'))
          return attr + quote + to + value.slice(from.length) + quote;
      }
      return all;
    }
  );
}
export function parse(xml) {
  const normalized = xml.includes(strictBase)
    ? namespaceDialect(xml, false)
    : xml;
  const doc = new DOMParser().parseFromString(normalized, 'application/xml');
  if (desc(doc, 'parsererror')) throw Error('The PPTX contains invalid XML.');
  return doc;
}
export const serialize = (doc) =>
  new XMLSerializer().serializeToString(doc.documentElement);
export const relfile = (path) => path.replace(/([^/]+)$/, '_rels/$1.rels');
export function resolve(part, target) {
  const nodes = target.startsWith('/') ? [] : part.split('/').slice(0, -1);
  for (const s of target.split('/')) {
    if (s === '..') nodes.pop();
    else if (s && s !== '.') nodes.push(s);
  }
  return nodes.join('/');
}
export function relative(part, target) {
  const from = part.split('/').slice(0, -1),
    to = target.split('/');
  while (from.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return '../'.repeat(from.length) + to.join('/');
}
export const rels = (pairs) =>
  `<Relationships xmlns="${PKG}">${pairs.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${esc(target)}"/>`).join('')}</Relationships>`;
export const treeStart =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
export function solid(hex) {
  if (!hex) return '<a:noFill/>';
  const rgb = hex.slice(1, 7);
  if (hex.length === 7)
    return `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>`;
  const alpha = parseInt(hex.slice(7, 9), 16),
    percent = Math.round((alpha * 100) / 255);
  // Recover whole percentages entered in the picker whenever the byte represents one.
  const amount =
    Math.round((percent * 255) / 100) === alpha
      ? percent * 1000
      : Math.round((alpha * 100000) / 255);
  return `<a:solidFill><a:srgbClr val="${rgb}"><a:alpha val="${amount}"/></a:srgbClr></a:solidFill>`;
}

export const emu = (n) => Math.round(n * 12700);
export const rawSlide = (name, bg, content = '') =>
  `<p:sld ${ns}><p:cSld name="${esc(name)}"><p:bg><p:bgPr>${solid(bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${treeStart}${content}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
