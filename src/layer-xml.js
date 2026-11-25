import { A, attr, child, children, emu, esc } from './xml.js';

const lockTypes = {
  nvSpPr: ['cNvSpPr', 'spLocks'],
  nvPicPr: ['cNvPicPr', 'picLocks'],
  nvGrpSpPr: ['cNvGrpSpPr', 'grpSpLocks'],
  nvCxnSpPr: ['cNvCxnSpPr', 'cxnSpLocks'],
  nvGraphicFramePr: ['cNvGraphicFramePr', 'graphicFrameLocks'],
};
const enabled = (value) => value === '1' || value === 'true';
function layerProperties(node) {
  const nv = children(node).find((n) => Object.hasOwn(lockTypes, n.localName));
  if (!nv) return {};
  const [ownerName, lockName] = lockTypes[nv.localName];
  const owner = child(nv, ownerName);
  return {
    info: child(nv, 'cNvPr'),
    owner,
    lockName,
    locks: child(owner, lockName),
  };
}
export function readLayerFlags(node) {
  const { info, locks } = layerProperties(node);
  const result = {};
  if (enabled(attr(info, 'hidden'))) result.hidden = true;
  if (enabled(attr(locks, 'noSelect'))) result.locked = true;
  return result;
}
export function writeLayerFlags(node, o, old = {}) {
  if (!!old.hidden === !!o.hidden && !!old.locked === !!o.locked) return;
  const { info, owner, locks, lockName } = layerProperties(node);
  if (info && !!old.hidden !== !!o.hidden) {
    if (o.hidden) info.setAttribute('hidden', '1');
    else info.removeAttribute('hidden');
  }
  if (!owner || !!old.locked === !!o.locked) return;
  if (o.locked) {
    const target =
      locks || owner.ownerDocument.createElementNS(A, 'a:' + lockName);
    if (!locks) owner.insertBefore(target, owner.firstElementChild);
    target.setAttribute('noSelect', '1');
  } else if (locks) {
    locks.removeAttribute('noSelect');
    if (!locks.attributes.length && !locks.children.length) locks.remove();
  }
}
export function groupXML(o, id) {
  const [x, y, w, h] = o.childBox;
  const rotation = o.rotation
    ? ' rot="' + Math.round(o.rotation * 60000) + '"'
    : '';
  const flip = (o.flipH ? ' flipH="1"' : '') + (o.flipV ? ' flipV="1"' : '');
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(o.name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${rotation}${flip}><a:off x="${emu(o.x)}" y="${emu(o.y)}"/><a:ext cx="${emu(o.w)}" cy="${emu(o.h)}"/><a:chOff x="${emu(x)}" y="${emu(y)}"/><a:chExt cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm></p:grpSpPr></p:grpSp>`;
}

// Reparent the original XML element, including extension lists, object IDs,
// chart relationships and animations attached by PowerPoint. Only recreate
// objects inserted by the editor. source is relative to the original parent.
export function syncLayerTree(tree, original, edited, create, patch, visit) {
  const known = new Map(),
    nodes = new Set(),
    retained = new Set();
  function index(parent, items) {
    const elements = children(parent);
    for (const o of items) {
      const node = elements[o.source];
      if (!node) continue;
      known.set(o.id, { node, object: o, parent });
      nodes.add(node);
      if (o.kind === 'group') index(node, o.items);
    }
  }
  function reconcile(parent, items) {
    const desired = items.map((o) => {
      const prior = known.get(o.id);
      const node = prior?.node || create(o);
      nodes.add(node);
      retained.add(node);
      visit?.(o, node);
      if (
        prior &&
        (prior.parent !== parent ||
          JSON.stringify(o) !== JSON.stringify(prior.object))
      )
        patch(node, o, prior.object, prior.parent !== parent);
      writeLayerFlags(node, o, prior?.object);
      if (o.kind === 'group') reconcile(node, o.items);
      return node;
    });
    const current = children(parent).filter((n) => nodes.has(n));
    if (
      current.length !== desired.length ||
      current.some((n, i) => n !== desired[i])
    ) {
      const end = child(parent, 'extLst') || null;
      for (const n of desired) parent.insertBefore(n, end);
    }
  }
  index(tree, original);
  reconcile(tree, edited);
  for (const { node } of known.values()) if (!retained.has(node)) node.remove();
}
