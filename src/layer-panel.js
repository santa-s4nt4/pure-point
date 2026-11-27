import { shortcutLabel } from './platform.js';
import { esc } from './xml.js';
import { icon } from './view.js';

const expanded = new Set();
export function toggleExpanded(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}
export function layerPanel(
  items,
  selectedIds,
  canGroup,
  canUngroup,
  alignment = ''
) {
  function rows(children, depth, inheritedHidden, inheritedLocked) {
    return children
      .slice()
      .reverse()
      .map((o) => {
        const hidden = inheritedHidden || o.hidden,
          locked = inheritedLocked || o.locked;
        const isGroup = o.kind === 'group',
          open = expanded.has(o.id);
        const disclosure = isGroup
          ? `<button class="layer-disclosure" data-disclose="${o.id}" aria-label="${open ? 'Collapse' : 'Expand'} group" aria-expanded="${open}">${icon(open ? 'down' : 'right', 12)}</button>`
          : '<span class="layer-disclosure"></span>';
        const toggle = (key, on, label, glyph, disabled) =>
          `<button class="layer-toggle ${on ? 'set' : ''}" data-layer-toggle="${key}" data-target="${o.id}" title="${label}" aria-label="${label} ${esc(o.name)}" aria-pressed="${!!on}" ${disabled ? 'disabled' : ''}>${icon(glyph, 13)}</button>`;
        const row = `<div class="layer-row ${selectedIds.has(o.id) ? 'active' : ''} ${hidden ? 'invisible-layer' : ''}" draggable="${!locked}" data-layer-row="${esc(o.id)}" style="--depth:${depth}">${disclosure}<button class="layer" data-layer="${o.id}" aria-pressed="${selectedIds.has(o.id)}">${icon(o.kind === 'image' ? 'picture' : o.kind, 14)}<span>${esc(o.name)}</span></button>${toggle('hidden', hidden, o.hidden ? 'Show' : 'Hide', hidden ? 'hidden' : 'eye', inheritedHidden)}${toggle('locked', locked, o.locked ? 'Unlock' : 'Lock', locked ? 'lock' : 'unlock', inheritedLocked)}</div>`;
        return (
          row +
          (isGroup && open ? rows(o.items, depth + 1, hidden, locked) : '')
        );
      })
      .join('');
  }
  const groupButton = (id, enabled, label, glyph, shortcut) =>
    `<button class="icon-btn" data-action="${id}" aria-label="${label}" title="${label} (${shortcutLabel(shortcut)})" ${enabled ? '' : 'disabled'}>${icon(glyph, 15)}</button>`;
  return `<section class="layer-panel"><div class="section-heading"><h3>Layers</h3><div class="layer-actions">${groupButton('group', canGroup, 'Group selection', 'group', '⌘G')}${groupButton('ungroup', canUngroup, 'Ungroup selection', 'ungroup', '⇧⌘G')}</div></div>${alignment}${rows(items, 0, false, false) || '<p class="empty-msg">No layers</p>'}</section>`;
}
