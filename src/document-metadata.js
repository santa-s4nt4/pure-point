import { readCommentAnchor, writeCommentAnchor } from './comment-anchors.js';
import { layerEntries } from './layers.js';
import {
  A,
  P,
  R,
  PKG,
  TYPES,
  attr,
  child,
  children,
  parse,
  relative,
  relfile,
  resolve,
  rid,
  serialize,
} from './xml.js';

const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const MODERN = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
const REVIEW = 'http://schemas.microsoft.com/office/2018/10/relationships/';
const SECTION_EXTENSION = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
const COMMENT_EXTENSION = '{6950BFC3-D8DA-4A85-94F7-54DA5524770B}';
const XMLTYPE = 'application/vnd.openxmlformats-officedocument.presentationml.';
const normalId = (id) => String(id).replace(/[{}]/g, '').toLowerCase();
const officeGuid = (id) => '{' + normalId(id).toUpperCase() + '}';
const equivalent = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const authorIds = new Map();

function append(parent, space, tag, attrs = {}) {
  const n = parent.ownerDocument.createElementNS(space, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n);
  return n;
}
function extension(root, uri) {
  const list = child(root, 'extLst') || append(root, P, 'p:extLst');
  return (
    children(list, 'ext').find((n) => attr(n, 'uri') === uri) ||
    append(list, P, 'p:ext', { uri })
  );
}
function relationshipNodes(xml, part) {
  return xml[relfile(part)]
    ? children(parse(xml[relfile(part)]).documentElement)
    : [];
}
function commentParts(xml, owner) {
  return relationshipNodes(xml, owner)
    .filter(
      (n) =>
        attr(n, 'Type').endsWith('/comments') &&
        attr(n, 'TargetMode') !== 'External'
    )
    .map((n) => resolve(owner, attr(n, 'Target')));
}
function authorPart(xml, presPath, modern) {
  const type = modern ? REVIEW + 'authors' : R + '/commentAuthors';
  const rel = relationshipNodes(xml, presPath).find(
    (n) => attr(n, 'Type') === type
  );
  return rel && resolve(presPath, attr(rel, 'Target'));
}
function commentKey(n, modern) {
  return modern
    ? normalId(attr(n, 'id'))
    : 'classic:' + attr(n, 'authorId') + ':' + attr(n, 'idx');
}
function readThreadText(n) {
  return children(child(n, 'txBody'), 'p')
    .map((p) =>
      children(p)
        .map((r) =>
          r.localName === 'br' ? '\n' : child(r, 't')?.textContent || ''
        )
        .join('')
    )
    .join('\n');
}
export function readDocumentMetadata(deck, xml, presPath, doc) {
  const pres = doc(presPath);
  const list = pres.getElementsByTagNameNS(P14, 'sectionLst')[0];
  const bySlideId = new Map(deck.slides.map((s) => [s.slideId, s]));
  deck.sections = children(list, 'section').map((n) => {
    const id = normalId(attr(n, 'id'));
    for (const link of children(child(n, 'sldIdLst'), 'sldId')) {
      const slide = bySlideId.get(attr(link, 'id'));
      if (slide) slide.sectionId = id;
    }
    return { id, name: attr(n, 'name') };
  });
  const authors = new Map();
  for (const modern of [false, true]) {
    const path = authorPart(xml, presPath, modern);
    if (path && xml[path]) {
      for (const author of children(doc(path).documentElement))
        authors.set(attr(author, 'id'), attr(author, 'name'));
    }
  }
  for (const s of deck.slides) {
    s.sectionId ??= null;
    s.hidden = ['0', 'false'].includes(
      attr(doc(s.source).documentElement, 'show')
    );
    s.comments = [];
    let byOfficeId;
    for (const path of commentParts(xml, s.source)) {
      if (!xml[path]) continue;
      const cm = doc(path).documentElement,
        modern = cm.namespaceURI === MODERN,
        units = modern ? 12700 : 8;
      for (const n of children(cm, 'cm')) {
        const pos = child(n, 'pos');
        const comment = {
          id: commentKey(n, modern),
          author: authors.get(attr(n, 'authorId')) || 'Unknown',
          text: modern
            ? readThreadText(n)
            : child(n, 'text')?.textContent || '',
          x: Number(attr(pos, 'x', 0)) / units,
          y: Number(attr(pos, 'y', 0)) / units,
          createdAt: attr(n, modern ? 'created' : 'dt'),
          sourcePart: path,
        };
        if (modern && child(n, 'deMkLst')) {
          byOfficeId ??= new Map(
            [...layerEntries(s.items).values()].map((e) => [
              e.object.officeId,
              e,
            ])
          );
          readCommentAnchor(n, byOfficeId, comment);
        }
        s.comments.push(comment);
      }
    }
  }
  return deck;
}

function updateSections(pres, deck, base, slideIds) {
  const summary = (d) => ({
    sections: d?.sections || [],
    members: (d?.slides || []).map((s) => [s.id, s.sectionId || null]),
  });
  if (!deck.sections?.length && !base?.deck.sections?.length) return;
  if (equivalent(summary(deck), summary(base?.deck))) return;
  const ext = extension(pres.documentElement, SECTION_EXTENSION);
  const list = child(ext, 'sectionLst') || append(ext, P14, 'p14:sectionLst');
  const original = new Map(
    children(list, 'section').map((el) => [normalId(attr(el, 'id')), el])
  );
  for (const n of original.values()) n.remove();
  for (const section of deck.sections || []) {
    const n = original.get(section.id) || append(list, P14, 'p14:section');
    n.setAttribute('name', section.name);
    n.setAttribute('id', officeGuid(section.id));
    const links = child(n, 'sldIdLst') || append(n, P14, 'p14:sldIdLst');
    children(links, 'sldId').forEach((node) => node.remove());
    for (const slide of deck.slides.filter((s) => s.sectionId === section.id))
      append(links, P14, 'p14:sldId', { id: slideIds.get(slide.id) });
    list.appendChild(n);
  }
  if (!deck.sections?.length) ext.remove();
}

function addRelation(doc, type, target) {
  const existing = children(doc.documentElement);
  let i = 1;
  while (existing.some((n) => attr(n, 'Id') === 'rId' + i)) i++;
  const id = 'rId' + i;
  append(doc.documentElement, PKG, 'Relationship', {
    Id: id,
    Type: type,
    Target: target,
  });
  return id;
}
function setText(n, modern, text) {
  if (!modern) {
    (child(n, 'text') || append(n, P, 'p:text')).textContent = text;
    return;
  }
  let body = child(n, 'txBody');
  if (!body) {
    body = append(n, MODERN, 'p188:txBody');
    n.insertBefore(body, child(n, 'extLst') || null);
    append(body, A, 'a:bodyPr');
    append(body, A, 'a:lstStyle');
  }
  for (const p of children(body, 'p')) p.remove();
  for (const line of text.split('\n'))
    append(append(append(body, A, 'a:p'), A, 'a:r'), A, 'a:t').textContent =
      line;
}
function writeReview(state, slide, previous, path) {
  const { xml, docs, part, types, ensureType, presPath } = state;
  const old = previous?.comments || [],
    next = slide.comments || [];
  if (equivalent(old, next)) return;
  const paths = commentParts(xml, path);
  const modernByDefault =
    Boolean(authorPart(xml, presPath, true)) ||
    !authorPart(xml, presPath, false);
  const defaultPath =
    paths.find(
      (p) => xml[p] && parse(xml[p]).documentElement.namespaceURI === MODERN
    ) || paths[0];
  const grouped = new Map(paths.map((p) => [p, []]));
  for (const comment of next) {
    const owner =
      comment.sourcePart && paths.includes(comment.sourcePart)
        ? comment.sourcePart
        : comment.objectId
          ? paths.find(
              (p) =>
                xml[p] && parse(xml[p]).documentElement.namespaceURI === MODERN
            ) || 'new-modern'
          : defaultPath || (modernByDefault ? 'new-modern' : '');
    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner).push(comment);
  }
  for (const [existing, comments] of grouped) {
    const oldComments = old.filter((c) => c.sourcePart === existing);
    if (equivalent(oldComments, comments)) continue;
    const modern =
      existing === 'new-modern' ||
      (existing
        ? parse(xml[existing]).documentElement.namespaceURI === MODERN
        : modernByDefault);
    let commentPath = existing === 'new-modern' ? '' : existing;
    if (!commentPath) {
      const dir =
        presPath.slice(0, presPath.lastIndexOf('/') + 1) + 'comments/';
      let i = 1;
      do {
        commentPath = dir + (modern ? 'modernComment' : 'comment') + i + '.xml';
        i++;
      } while (xml[commentPath] || docs.has(commentPath));
      const relationships = part(
        relfile(path),
        '<Relationships xmlns="' + PKG + '"/>'
      );
      const relationship = addRelation(
        relationships,
        modern ? REVIEW + 'comments' : R + '/comments',
        relative(path, commentPath)
      );
      if (modern) {
        const m = append(
          extension(part(path).documentElement, COMMENT_EXTENSION),
          MODERN,
          'p188:commentRel'
        );
        m.setAttributeNS(R, 'r:id', relationship);
      }
      ensureType(
        commentPath,
        modern
          ? 'application/vnd.ms-powerpoint.comments+xml'
          : XMLTYPE + 'comments+xml'
      );
    }
    const commentDoc = part(
      commentPath,
      modern
        ? '<p188:cmLst xmlns:p188="' + MODERN + '"/>'
        : '<p:cmLst xmlns:p="' + P + '"/>'
    );
    const byId = new Map(
      children(commentDoc.documentElement, 'cm').map((n) => [
        commentKey(n, modern),
        n,
      ])
    );
    for (const [id, n] of byId)
      if (!comments.some((c) => c.id === id)) n.remove();
    for (const c of comments) {
      const prior = oldComments.find((v) => v.id === c.id);
      if (equivalent(prior, c)) continue;
      let node = byId.get(c.id);
      if (!node) {
        const type = modern ? 'authors' : 'commentAuthors';
        let authorPath = authorPart(xml, presPath, modern);
        if (!authorPath) {
          authorPath = presPath.replace(/[^/]+$/, type + '.xml');
          const prs = part(relfile(presPath));
          if (
            !children(prs.documentElement).some(
              (n) => attr(n, 'Type') === (modern ? REVIEW : R + '/') + type
            )
          )
            addRelation(
              prs,
              (modern ? REVIEW : R + '/') + type,
              relative(presPath, authorPath)
            );
          ensureType(
            authorPath,
            modern
              ? 'application/vnd.ms-powerpoint.authors+xml'
              : XMLTYPE + 'commentAuthors+xml'
          );
        }
        const authors = part(
          authorPath,
          modern
            ? '<p188:authorLst xmlns:p188="' + MODERN + '"/>'
            : '<p:cmAuthorLst xmlns:p="' + P + '"/>'
        );
        let author = children(authors.documentElement).find(
          (n) => attr(n, 'name') === c.author
        );
        if (!author) {
          const initials = c.author
            .split(/\s+/)
            .map((s) => [...s][0])
            .join('')
            .slice(0, 4);
          if (modern) {
            if (!authorIds.has(c.author))
              authorIds.set(c.author, officeGuid(crypto.randomUUID()));
            const id = authorIds.get(c.author);
            author = append(authors.documentElement, MODERN, 'p188:author', {
              id,
              name: c.author,
              initials,
              userId: id,
              providerId: 'None',
            });
          } else {
            const id =
              Math.max(
                -1,
                ...children(authors.documentElement).map((n) =>
                  Number(attr(n, 'id'))
                )
              ) + 1;
            author = append(authors.documentElement, P, 'p:cmAuthor', {
              id,
              name: c.author,
              initials,
              lastIdx: 0,
              clrIdx: id,
            });
          }
        }
        if (modern) {
          node = append(commentDoc.documentElement, MODERN, 'p188:cm', {
            id: officeGuid(c.id),
            authorId: attr(author, 'id'),
            created: c.createdAt,
          });
        } else {
          const idx = Number(attr(author, 'lastIdx', 0)) + 1;
          author.setAttribute('lastIdx', idx);
          node = append(commentDoc.documentElement, P, 'p:cm', {
            idx,
            authorId: attr(author, 'id'),
            dt: c.createdAt,
          });
        }
      }
      if (modern && (!prior || prior.objectId !== c.objectId))
        writeCommentAnchor(
          node,
          state.commentNodes.get(c.objectId),
          state.slideId
        );
      if (
        !prior ||
        prior.x !== c.x ||
        prior.y !== c.y ||
        prior.objectId !== c.objectId
      ) {
        const pos =
          child(node, 'pos') ||
          append(node, modern ? MODERN : P, modern ? 'p188:pos' : 'p:pos');
        if (modern)
          node.insertBefore(
            pos,
            child(node, 'replyLst') ||
              child(node, 'txBody') ||
              child(node, 'extLst') ||
              null
          );
        const units = modern ? 12700 : 8;
        pos.setAttribute(
          'x',
          Math.round(((modern && c.objectId ? c.offsetX : c.x) || 0) * units)
        );
        pos.setAttribute(
          'y',
          Math.round(((modern && c.objectId ? c.offsetY : c.y) || 0) * units)
        );
      }
      if (!prior || prior.text !== c.text) setText(node, modern, c.text);
    }
  }
}

// Apply metadata after slide allocation/reordering so section references always
// point to the actual PowerPoint slide IDs, including newly created slides.
export function writeDocumentMetadata(
  deck,
  base,
  changes,
  source,
  presPath,
  commentNodes
) {
  const xml = { ...source, ...changes.xml },
    docs = new Map();
  const part = (path, empty) => {
    if (!docs.has(path)) docs.set(path, parse(xml[path] || empty));
    return docs.get(path);
  };
  const types = part('[Content_Types].xml');
  const ensureType = (path, type) => {
    let n = children(types.documentElement, 'Override').find(
      (el) => attr(el, 'PartName') === '/' + path
    );
    if (!n)
      n = append(types.documentElement, TYPES, 'Override', {
        PartName: '/' + path,
      });
    n.setAttribute('ContentType', type);
  };
  const mainType = children(types.documentElement, 'Override').find(
    (n) => attr(n, 'PartName') === '/' + presPath
  );
  if (attr(mainType, 'ContentType') === XMLTYPE + 'template.main+xml')
    ensureType(presPath, XMLTYPE + 'presentation.main+xml');
  const pres = part(presPath),
    list = children(child(pres.documentElement, 'sldIdLst'), 'sldId');
  const pathsByRel = new Map(
    relationshipNodes(xml, presPath).map((n) => [
      attr(n, 'Id'),
      resolve(presPath, attr(n, 'Target')),
    ])
  );
  const priorSlides = new Map((base?.deck.slides || []).map((s) => [s.id, s]));
  const slideIds = new Map();
  for (const [i, slide] of deck.slides.entries()) {
    slideIds.set(slide.id, attr(list[i], 'id'));
    const old = priorSlides.get(slide.id);
    const path = pathsByRel.get(rid(list[i]));
    if (!path) continue;
    if (Boolean(slide.hidden) !== Boolean(old?.hidden)) {
      const root = part(path).documentElement;
      if (slide.hidden) root.setAttribute('show', '0');
      else root.removeAttribute('show');
    }
    writeReview(
      {
        xml,
        docs,
        part,
        types,
        ensureType,
        presPath,
        commentNodes,
        slideId: slideIds.get(slide.id),
      },
      slide,
      old,
      path
    );
  }
  updateSections(pres, deck, base, slideIds);
  for (const [path, doc] of docs) {
    const data = serialize(doc);
    if (data !== serialize(parse(xml[path] || '<empty/>')))
      changes.xml[path] = data;
  }
}
