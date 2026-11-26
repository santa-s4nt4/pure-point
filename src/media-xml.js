import {
  A,
  P,
  R,
  PKG,
  TYPES,
  ns,
  attr,
  child,
  children,
  desc,
  esc,
  parse,
  relative,
  resolve,
} from './xml.js';
import { onlineVideo } from './media-format.js';

const mediaType =
  'http://schemas.microsoft.com/office/2007/relationships/media';
const mediaNS = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const mediaExtension = '{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}';
function reference(element, key) {
  return element?.getAttributeNS(R, key) || attr(element, 'r:' + key);
}
export function readPictureMedia(pic, obj, relations) {
  const video = desc(pic, 'videoFile'),
    media = desc(pic, 'media');
  const web = desc(pic, 'webVideoPr');
  if (!video && !web) return;
  const resolve = (id) => relations.find((r) => r.id === id);
  const link = resolve(reference(video, 'link'));
  const source = resolve(reference(media, 'embed')) || link;
  const external =
    onlineVideo(attr(web, 'embeddedHtml')) ||
    onlineVideo(link?.external) ||
    onlineVideo(resolve(reference(media, 'link'))?.external);
  obj.kind = 'video';
  obj.poster = obj.asset;
  obj.asset = source?.target || null;
  obj.embed = external?.embed || null;
  // An imported linked movie might be a file:// or UNC path on another PC.
  // Its picture and original relationships stay in the package.
}

export function createPictureWriter({
  path,
  sr,
  doc,
  types,
  changes,
  assets,
  source,
  onRelationsChanged,
  onTypesChanged,
}) {
  const originals = new Set(),
    pending = new Set();
  const oldMediaRefs = new Set();
  let id = 1;
  const used = new Set(children(sr.documentElement).map((n) => attr(n, 'Id')));
  function rel(type, target, external = false) {
    const same = children(sr.documentElement).find(
      (n) =>
        attr(n, 'Target') === target &&
        attr(n, 'Type') === type &&
        (attr(n, 'TargetMode') === 'External') === external
    );
    if (same) return attr(same, 'Id');
    while (used.has('rId' + id)) id++;
    const key = 'rId' + id++;
    used.add(key);
    const n = sr.createElementNS(PKG, 'Relationship');
    n.setAttribute('Id', key);
    n.setAttribute('Type', type);
    n.setAttribute('Target', target);
    if (external) n.setAttribute('TargetMode', 'External');
    sr.documentElement.append(n);
    onRelationsChanged();
    return key;
  }
  function writeAsset(asset) {
    if (!asset) throw Error('The media asset is missing.');
    const data = assets[asset] || source.media[asset];
    if (!data) throw Error('Unable to find media: ' + asset);
    if (!source.media[asset]) {
      if (data.token) (changes.videoFiles ??= {})[asset] = data.token;
      else changes.media[asset] = data.slice(data.indexOf(',') + 1);
    }
    const mime = data.mime || data.slice(5, data.indexOf(';')),
      ext = asset.split('.').pop(),
      root = types.documentElement;
    const existing = children(root, 'Default').find(
      (n) => attr(n, 'Extension').toLowerCase() === ext.toLowerCase()
    );
    if (!existing) {
      const d = types.createElementNS(TYPES, 'Default');
      d.setAttribute('Extension', ext);
      d.setAttribute('ContentType', mime);
      root.insertBefore(d, root.firstChild);
      onTypesChanged();
    } else if (
      attr(existing, 'ContentType') !== mime &&
      !source.media[asset] &&
      !children(root, 'Override').some(
        (n) => attr(n, 'PartName') === '/' + asset
      )
    ) {
      const o = types.createElementNS(TYPES, 'Override');
      o.setAttribute('PartName', '/' + asset);
      o.setAttribute('ContentType', mime);
      root.append(o);
      onTypesChanged();
    }
    return relative(path, asset);
  }
  function videoProps(o) {
    const online = o.embed && onlineVideo(o.embed);
    if (o.embed && !online) throw Error('The video URL is not supported.');
    const target = online ? online.embed : writeAsset(o.asset);
    const video = rel(R + '/video', target, !!online);
    if (online) return '<a:videoFile r:link="' + video + '"/>';
    const embedded = rel(mediaType, target);
    return (
      '<a:videoFile r:link="' +
      video +
      '"/><p:extLst><p:ext uri="' +
      mediaExtension +
      '"><p14:media xmlns:p14="' +
      mediaNS +
      '" r:embed="' +
      embedded +
      '"/></p:ext></p:extLst>'
    );
  }
  const makeNode = (xml) =>
    doc.importNode(
      parse('<p:root ' + ns + '>' + xml + '</p:root>').documentElement
        .firstElementChild,
      true
    );
  function cropXML(crop) {
    if (!crop?.some((v) => v)) return '';
    const sides = ['l', 't', 'r', 'b'].map(
      (side, i) => side + '="' + Math.round(crop[i] * 100000) + '"'
    );
    return '<a:srcRect ' + sides.join(' ') + '/>';
  }
  function create(o, shapeId, xfrm) {
    const isVideo = o.kind === 'video',
      poster = rel(R + '/image', writeAsset(isVideo ? o.poster : o.asset));
    const props = isVideo ? videoProps(o) : '';
    if (isVideo) pending.add(String(shapeId));
    const link = isVideo
      ? '<a:hlinkClick r:id="" action="ppaction://media"/>'
      : '';
    return (
      '<p:pic><p:nvPicPr><p:cNvPr id="' +
      shapeId +
      '" name="' +
      esc(o.name) +
      '">' +
      link +
      '</p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>' +
      props +
      '</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="' +
      poster +
      '"/>' +
      cropXML(o.crop) +
      '<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
      xfrm +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    );
  }
  function patch(n, o, old) {
    if (!['image', 'video'].includes(o.kind)) return;
    const crop = cropXML(o.crop);
    if (crop !== cropXML(old.crop)) {
      const fill = child(n, 'blipFill');
      child(fill, 'srcRect')?.remove();
      if (crop && fill)
        fill.insertBefore(
          makeNode(crop),
          child(fill, 'blip')?.nextSibling || null
        );
    }
    if (
      o.asset === old.asset &&
      o.poster === old.poster &&
      o.embed === old.embed
    )
      return;
    const blip = desc(n, 'blip'),
      isVideo = o.kind === 'video';
    if (!blip) return;
    oldMediaRefs.add(reference(blip, 'embed'));
    blip.setAttributeNS(
      R,
      'r:embed',
      rel(R + '/image', writeAsset(isVideo ? o.poster : o.asset))
    );
    for (const ext of children(child(blip, 'extLst'), 'ext'))
      if (desc(ext, 'svgBlip') || desc(ext, 'webVideoPr')) ext.remove();
    if (!isVideo) return;
    const info = desc(n, 'cNvPr'),
      shapeId = attr(info, 'id'),
      nv = desc(n, 'nvPr');
    for (const v of children(nv, 'videoFile')) {
      oldMediaRefs.add(reference(v, 'link'));
      v.remove();
    }
    for (const ext of children(child(nv, 'extLst'), 'ext')) {
      const m = desc(ext, 'media');
      if (m) {
        oldMediaRefs.add(reference(m, 'embed'));
        oldMediaRefs.add(reference(m, 'link'));
        ext.remove();
      }
    }
    const newProps = makeNode('<p:nvPr>' + videoProps(o) + '</p:nvPr>');
    const video = child(newProps, 'videoFile');
    const appData = children(nv).find((el) =>
      ['custDataLst', 'extLst'].includes(el.localName)
    );
    nv.insertBefore(video, appData || null);
    const ext = desc(newProps, 'ext');
    if (ext) {
      let list = child(nv, 'extLst');
      if (!list) {
        list = makeNode('<p:extLst/>');
        nv.append(list);
      }
      list.append(ext);
    }
    const click = child(info, 'hlinkClick');
    if (!click)
      info.insertBefore(
        makeNode('<a:hlinkClick r:id="" action="ppaction://media"/>'),
        info.firstChild
      );
    pending.add(shapeId);
  }
  const sourceSlides = doc ? [...doc.getElementsByTagNameNS(P, 'pic')] : [];
  for (const pic of sourceSlides) {
    if (desc(pic, 'videoFile')) originals.add(attr(desc(pic, 'cNvPr'), 'id'));
    for (const node of [
      desc(pic, 'blip'),
      desc(pic, 'videoFile'),
      desc(pic, 'media'),
      desc(pic, 'svgBlip'),
    ]) {
      if (!node) continue;
      for (const key of ['embed', 'link']) {
        const id = reference(node, key);
        if (id) oldMediaRefs.add(id);
      }
    }
  }
  function finish(detached = new Set()) {
    const pictures = [...doc.getElementsByTagNameNS(P, 'pic')];
    const live = new Set(
      pictures
        .filter((p) => desc(p, 'media') || desc(p, 'videoFile'))
        .map((p) => attr(desc(p, 'cNvPr'), 'id'))
    );
    const timingIds = new Set();
    for (const video of [...doc.getElementsByTagNameNS(P, 'video')]) {
      const id = attr(desc(video, 'spTgt'), 'spid');
      if (originals.has(id) && !live.has(id)) video.remove();
      else timingIds.add(id);
    }
    for (const seq of [...doc.getElementsByTagNameNS(P, 'seq')]) {
      const timeline = child(seq, 'cTn');
      if (attr(timeline, 'nodeType') !== 'interactiveSeq') continue;
      const targets = [...seq.getElementsByTagNameNS(P, 'spTgt')].map((t) =>
        attr(t, 'spid')
      );
      if (
        targets.length &&
        targets.every((id) => originals.has(id) && !live.has(id))
      )
        seq.remove();
    }
    for (const shapeId of pending) {
      if (timingIds.has(shapeId)) continue;
      const root = doc.documentElement;
      const add = (p, k, attrs = {}, before = null) => {
        const e = doc.createElementNS(P, 'p:' + k);
        for (const [key, val] of Object.entries(attrs))
          e.setAttribute(key, val);
        p.insertBefore(e, before);
        return e;
      };
      let timing = child(root, 'timing');
      if (!timing)
        timing = add(root, 'timing', {}, child(root, 'extLst') || null);
      let times = child(timing, 'tnLst');
      if (!times) times = add(timing, 'tnLst', {}, timing.firstElementChild);
      let nextId = 1;
      for (const node of doc.getElementsByTagNameNS(P, 'cTn'))
        nextId = Math.max(nextId, Number(attr(node, 'id')) + 1);
      let timeline = [...times.getElementsByTagNameNS(P, 'cTn')].find(
        (n) => attr(n, 'nodeType') === 'tmRoot'
      );
      if (!timeline)
        timeline = add(add(times, 'par'), 'cTn', {
          id: nextId++,
          dur: 'indefinite',
          restart: 'never',
          nodeType: 'tmRoot',
        });
      const list =
        child(timeline, 'childTnLst') ||
        add(timeline, 'childTnLst', {}, child(timeline, 'subTnLst') || null);
      list.append(
        makeNode(
          '<p:video><p:cMediaNode vol="80000"><p:cTn id="' +
            nextId +
            '" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="' +
            shapeId +
            '"/></p:tgtEl></p:cMediaNode></p:video>'
        )
      );
      // PowerPoint uses a click-triggered media command alongside the video
      // time node. Keep unrelated animations and their original IDs intact.
      const trigger =
        '<p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="' +
        shapeId +
        '"/></p:tgtEl></p:cond>';
      const command =
        '<p:cmd type="call" cmd="togglePause"><p:cBhvr><p:cTn id="' +
        (nextId + 3) +
        '" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="' +
        shapeId +
        '"/></p:tgtEl></p:cBhvr></p:cmd>';
      const effect =
        '<p:par><p:cTn id="' +
        (nextId + 2) +
        '" presetID="2" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
        command +
        '</p:childTnLst></p:cTn></p:par>';
      list.append(
        makeNode(
          '<p:seq concurrent="1" nextAc="seek"><p:cTn id="' +
            (nextId + 1) +
            '" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst>' +
            trigger +
            '</p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>' +
            effect +
            '</p:childTnLst></p:cTn><p:nextCondLst>' +
            trigger +
            '</p:nextCondLst></p:seq>'
        )
      );
    }
    if (oldMediaRefs.size) {
      const liveIds = new Set();
      for (const e of doc.getElementsByTagName('*'))
        for (const a of e.attributes)
          if (a.namespaceURI === R) liveIds.add(a.value);
      for (const r of children(sr.documentElement))
        if (oldMediaRefs.has(attr(r, 'Id')) && !liveIds.has(attr(r, 'Id'))) {
          if (attr(r, 'TargetMode') !== 'External')
            detached.add(resolve(path, attr(r, 'Target')));
          r.remove();
          onRelationsChanged();
        }
    }
  }
  return { create, patch, finish };
}

// A media file can also be shared by slides, layouts or notes. Remove it only
// after its last relationship has disappeared from the resulting package.
export function discardUnlinkedMedia(xml, changes, types, candidates) {
  if (!candidates.size) return false;
  const removed = new Set(changes.removed || []);
  for (const [file, content] of Object.entries({ ...xml, ...changes.xml })) {
    if (!file.endsWith('.rels') || removed.has(file)) continue;
    const owner =
      file === '_rels/.rels' ? '' : file.replace('/_rels/', '/').slice(0, -5);
    for (const r of children(parse(content).documentElement)) {
      if (attr(r, 'TargetMode') !== 'External')
        candidates.delete(resolve(owner, attr(r, 'Target')));
    }
    if (!candidates.size) return false;
  }
  let altered = false;
  for (const file of candidates) {
    removed.add(file);
    const type = children(types.documentElement, 'Override').find(
      (el) => attr(el, 'PartName') === '/' + file
    );
    if (type) {
      type.remove();
      altered = true;
    }
  }
  changes.removed = [...removed];
  return altered;
}
