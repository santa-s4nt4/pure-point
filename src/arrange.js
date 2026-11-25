import { layerBounds, localDelta, selectionBounds } from './layers.js';

export const alignments = [
  ['left', 'Align left'],
  ['hcenter', 'Align horizontal centers'],
  ['right', 'Align right'],
  ['top', 'Align top'],
  ['vcenter', 'Align vertical centers'],
  ['bottom', 'Align bottom'],
];

export function alignmentMoves(entries, direction, deck) {
  if (!entries.length || entries.some((entry) => entry.locked)) return [];
  const horizontal = ['left', 'hcenter', 'right'].includes(direction);
  const start = horizontal ? 'x' : 'y',
    length = horizontal ? 'w' : 'h';
  const fraction = ['right', 'bottom'].includes(direction)
    ? 1
    : ['hcenter', 'vcenter'].includes(direction)
      ? 0.5
      : 0;
  const frame =
    entries.length === 1
      ? { x: 0, y: 0, w: deck.w, h: deck.h }
      : selectionBounds(entries);
  return entries
    .map((entry) => {
      const box = layerBounds(entry);
      const distance =
        frame[start] - box[start] + (frame[length] - box[length]) * fraction;
      return {
        object: entry.object,
        delta: localDelta(
          entry.transform,
          horizontal ? distance : 0,
          horizontal ? 0 : distance
        ),
      };
    })
    .filter(({ delta }) => Math.abs(delta.x) + Math.abs(delta.y) > 0.000001);
}

// Layer rows run from front to back, the reverse of DrawingML paint order.
export function reorderLayers(entries, target, placement) {
  if (!entries.length || entries.some((entry) => entry.locked)) return null;
  const { siblings } = entries[0];
  if (entries.some((entry) => entry.siblings !== siblings)) return null;
  const selected = new Set(entries.map((entry) => entry.object));
  if (target && (target.siblings !== siblings || selected.has(target.object)))
    return null;
  const kept = siblings.filter((o) => !selected.has(o));
  const moving = siblings.filter((o) => selected.has(o));
  const index = target
    ? kept.indexOf(target.object) + Number(placement === 'above')
    : placement === 'front'
      ? kept.length
      : 0;
  kept.splice(index, 0, ...moving);
  return kept.some((o, i) => o !== siblings[i])
    ? () => siblings.splice(0, siblings.length, ...kept)
    : null;
}

export function bindLayerReordering(host, getEntries, getSelected, commit) {
  let dragged = [];
  const rowAt = (e) => e.target.closest('[data-layer-row]');
  const clearIndicator = () => {
    host
      .querySelector('.drop-above,.drop-below')
      ?.classList.remove('drop-above', 'drop-below');
  };
  function operation(row, e) {
    if (!row || !dragged.length) return null;
    const entries = getEntries(),
      target = entries.get(row.dataset.layerRow);
    const rect = row.getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    const apply = reorderLayers(
      dragged.map((id) => entries.get(id)).filter(Boolean),
      target,
      side
    );
    return apply && { apply, side };
  }
  host.addEventListener('dragstart', (e) => {
    const row = rowAt(e);
    if (!row || !row.draggable) return;
    const selected = getSelected();
    dragged = selected.includes(row.dataset.layerRow)
      ? selected
      : [row.dataset.layerRow];
    e.dataTransfer.setData(
      'application/x-pure-point-layers',
      JSON.stringify(dragged)
    );
    e.dataTransfer.effectAllowed = 'move';
  });
  host.addEventListener('dragover', (e) => {
    const row = rowAt(e),
      op = operation(row, e);
    clearIndicator();
    if (!op) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drop-' + op.side);
  });
  host.addEventListener('drop', (e) => {
    const op = operation(rowAt(e), e);
    clearIndicator();
    dragged = [];
    if (op) {
      e.preventDefault();
      commit(op.apply);
    }
  });
  host.addEventListener('dragleave', (e) => {
    if (!host.contains(e.relatedTarget)) clearIndicator();
  });
  host.addEventListener('dragend', () => {
    dragged = [];
    clearIndicator();
  });
}
