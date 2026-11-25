import { attr, child, children, emu, esc, solid } from './xml.js';
import { paintPaths, curved, edges, vectorKinds } from './vector.js';

const coordinate = (p, key) => {
  const value = p?.getAttribute(key);
  return value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : NaN;
};
export function readContours(custom, extent) {
  if (!custom) return;
  const contours = [];
  for (const [pathIndex, path] of children(
    child(custom, 'pathLst'),
    'path'
  ).entries()) {
    const w = Number(attr(path, 'w', extent.w)),
      h = Number(attr(path, 'h', extent.h));
    if (!Number.isFinite(w + h) || w < 0 || h < 0) return;
    let c, previous;
    for (const cmd of children(path)) {
      const vals = children(cmd, 'pt').map((p) => ({
        x: (coordinate(p, 'x') / (w || 1)) * 1000,
        y: (coordinate(p, 'y') / (h || 1)) * 1000,
      }));
      if (vals.some((v) => !Number.isFinite(v.x + v.y))) return;
      if (cmd.localName === 'moveTo' && vals.length === 1) {
        c = {
          nodes: [vals[0]],
          pathIndex,
          closed: false,
          fillMode: attr(path, 'fill', 'norm'),
          stroke: !['false', '0'].includes(attr(path, 'stroke', '1')),
        };
        contours.push(c);
        previous = vals[0];
        continue;
      }
      if (!c) return;
      if (cmd.localName === 'close') {
        c.closed = true;
        const first = c.nodes[0];
        if (
          c.nodes.length > 1 &&
          previous.x === first.x &&
          previous.y === first.y
        ) {
          if (previous.in) first.in = previous.in;
          c.nodes.pop();
          previous = first;
        }
        continue;
      }
      let p;
      if (cmd.localName === 'lnTo' && vals.length === 1) p = vals[0];
      else if (cmd.localName === 'cubicBezTo' && vals.length === 3) {
        previous.out = vals[0];
        p = { ...vals[2], in: vals[1] };
      } else if (cmd.localName === 'quadBezTo' && vals.length === 2) {
        const [control, end] = vals;
        previous.out = {
          x: (previous.x + 2 * control.x) / 3,
          y: (previous.y + 2 * control.y) / 3,
        };
        p = {
          ...end,
          in: {
            x: (end.x + 2 * control.x) / 3,
            y: (end.y + 2 * control.y) / 3,
          },
        };
      } else return;
      c.nodes.push(p);
      previous = p;
    }
  }
  return contours.length ? contours : undefined;
}
const xmlPoint = (p) =>
  `<a:pt x="${Math.round(p.x * 1000)}" y="${Math.round(p.y * 1000)}"/>`;
export function geometryXML(o) {
  if (o.kind !== 'path')
    return `<a:prstGeom prst="${o.kind === 'text' ? 'rect' : o.kind}"><a:avLst/></a:prstGeom>`;
  const paths = paintPaths(o).map((contours) => {
    const d = contours
      .map((c) => {
        const commands = [`<a:moveTo>${xmlPoint(c.nodes[0])}</a:moveTo>`];
        edges(c).forEach(({ a, b }, i) => {
          if (curved(a, b))
            commands.push(
              `<a:cubicBezTo>${xmlPoint(a.out || a)}${xmlPoint(b.in || b)}${xmlPoint(b)}</a:cubicBezTo>`
            );
          else if (!c.closed || i < c.nodes.length - 1)
            commands.push(`<a:lnTo>${xmlPoint(b)}</a:lnTo>`);
        });
        if (c.closed) commands.push('<a:close/>');
        return commands.join('');
      })
      .join('');
    const c = contours[0];
    return `<a:path w="1000000" h="1000000" fill="${esc(c.fillMode || 'norm')}" stroke="${c.stroke === false ? 0 : 1}">${d}</a:path>`;
  });
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>${paths.join('')}</a:pathLst></a:custGeom>`;
}
export function readLineStyle(ln) {
  const result = {};
  if (child(ln, 'prstDash')) result.dash = attr(child(ln, 'prstDash'), 'val');
  for (const [tag, key] of [
    ['headEnd', 'startArrow'],
    ['tailEnd', 'endArrow'],
  ]) {
    const end = child(ln, tag);
    if (end) result[key] = attr(end, 'type', 'none');
  }
  return result;
}
export function strokeXML(o) {
  return `<a:ln w="${emu(o.strokeWidth)}">${solid(o.stroke)}${o.dash ? `<a:prstDash val="${esc(o.dash)}"/>` : ''}${o.startArrow ? `<a:headEnd type="${esc(o.startArrow)}"/>` : ''}${o.endArrow ? `<a:tailEnd type="${esc(o.endArrow)}"/>` : ''}</a:ln>`;
}
export function connectorXML(o, id, xfrm) {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(o.name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm}${geometryXML(o)}${strokeXML(o)}</p:spPr></p:cxnSp>`;
}
export function patchVector(node, o, old, fragment) {
  const sp = child(node, 'spPr');
  if (!sp) return;
  const doc = sp.ownerDocument;
  if (
    vectorKinds.has(o.kind) &&
    (o.kind !== old.kind ||
      JSON.stringify(o.contours) !== JSON.stringify(old.contours))
  ) {
    const geometry = fragment(doc, geometryXML(o)),
      prev = child(sp, 'custGeom') || child(sp, 'prstGeom');
    if (prev) prev.replaceWith(geometry);
    else {
      const xfrm = child(sp, 'xfrm');
      sp.insertBefore(
        geometry,
        xfrm ? xfrm.nextElementSibling : sp.firstElementChild
      );
    }
  }
  if (
    !['stroke', 'strokeWidth', 'dash', 'startArrow', 'endArrow'].some(
      (k) => o[k] !== old[k]
    )
  )
    return;
  let ln = child(sp, 'ln');
  if (!ln) {
    ln = fragment(doc, strokeXML(o));
    sp.insertBefore(
      ln,
      children(sp).find((e) =>
        ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'].includes(
          e.localName
        )
      ) || null
    );
    return;
  }
  if (o.strokeWidth !== old.strokeWidth)
    ln.setAttribute('w', emu(o.strokeWidth));
  if (o.stroke !== old.stroke) {
    children(ln)
      .filter((e) =>
        ['noFill', 'solidFill', 'gradFill', 'pattFill'].includes(e.localName)
      )
      .forEach((e) => e.remove());
    ln.insertBefore(fragment(doc, solid(o.stroke)), ln.firstElementChild);
  }
  if (o.dash !== old.dash) {
    children(ln)
      .filter((e) => ['prstDash', 'custDash'].includes(e.localName))
      .forEach((e) => e.remove());
    ln.insertBefore(
      fragment(doc, `<a:prstDash val="${esc(o.dash || 'solid')}"/>`),
      children(ln).find((e) =>
        ['round', 'bevel', 'miter', 'headEnd', 'tailEnd', 'extLst'].includes(
          e.localName
        )
      ) || null
    );
  }
  for (const [tag, k] of [
    ['headEnd', 'startArrow'],
    ['tailEnd', 'endArrow'],
  ]) {
    if (o[k] === old[k]) continue;
    let end = child(ln, tag);
    if (!end) {
      end = fragment(doc, `<a:${tag}/>`);
      ln.insertBefore(
        end,
        (tag === 'headEnd' && child(ln, 'tailEnd')) ||
          child(ln, 'extLst') ||
          null
      );
    }
    end.setAttribute('type', o[k] || 'none');
  }
}
