import { el, icon, scene } from './view.js';
import { uid } from './model.js';
import { pageNumbers } from './page-numbers.js';

export function sectionRuns(deck) {
  const runs = [];
  deck.slides.forEach((slide, index) => {
    const id = slide.sectionId || null;
    let run = runs.at(-1);
    if (!run || run.id !== id) {
      run = {
        id,
        name: deck.sections?.find((s) => s.id === id)?.name || 'Unsectioned',
        slides: [],
      };
      runs.push(run);
    }
    run.slides.push({ slide, index });
  });
  for (const section of deck.sections || [])
    if (!runs.some((r) => r.id === section.id))
      runs.push({ ...section, slides: [] });
  return runs;
}
export function moveIntoSection(deck, ids, sectionId, beforeId = null) {
  const moving = deck.slides.filter((s) => ids.has(s.id));
  const rest = deck.slides.filter((s) => !ids.has(s.id));
  let at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  if (at < 0) {
    const inSection = rest.filter((s) => (s.sectionId || null) === sectionId);
    if (inSection.length) at = rest.indexOf(inSection.at(-1)) + 1;
    else {
      const order = [null, ...(deck.sections || []).map((s) => s.id)];
      at = rest.findIndex(
        (s) => order.indexOf(s.sectionId || null) > order.indexOf(sectionId)
      );
      if (at < 0) at = rest.length;
    }
  }
  moving.forEach((s) => {
    s.sectionId = sectionId;
  });
  rest.splice(at, 0, ...moving);
  deck.slides = rest;
}
export function addSection(deck, name, ids) {
  const section = { id: uid(), name };
  const earlier = deck.sections || [];
  const first = deck.slides.findIndex((s) => ids.has(s.id));
  if (first < 0) return;
  const chosen = deck.slides.filter((s) => ids.has(s.id));
  const rest = deck.slides.filter((s) => !ids.has(s.id));
  rest.splice(first, 0, ...chosen);
  const unassigned = { id: uid(), name: 'Default section' };
  const byId = new Map([...earlier, section, unassigned].map((s) => [s.id, s]));
  const ordered = [],
    seen = new Set();
  let previous, run;
  for (const slide of rest) {
    const id = ids.has(slide.id)
      ? section.id
      : slide.sectionId || unassigned.id;
    if (previous !== id) {
      const original = byId.get(id);
      run = seen.has(id) ? { id: uid(), name: original.name } : original;
      seen.add(id);
      ordered.push(run);
      previous = id;
    }
    slide.sectionId = run.id;
  }
  deck.sections = [
    ...ordered,
    ...earlier.filter(
      (s) =>
        !seen.has(s.id) &&
        !deck.slides.some((slide) => slide.sectionId === s.id)
    ),
  ];
  deck.slides = rest;
  return section;
}
export function slideBrowser(host, { sorter = false, prepareSlide } = {}) {
  let state,
    layout,
    activeId,
    selected = new Set();
  const collapsed = new Set();
  const buttons = new Map();
  function preview(frame, width) {
    const slide = state.deck.slides[Number(frame.dataset.preview)];
    prepareSlide?.(slide);
    const node = scene(slide, state.deck, state.assets, false, false, state.numbers);
    node.style.transform = `scale(${width / state.deck.w})`;
    frame.replaceChildren(node);
  }
  const sizes = new ResizeObserver((entries) => {
    if (!state) return;
    for (const { target, contentRect } of entries) {
      if (target.isConnected && target.firstElementChild)
        target.firstElementChild.style.transform = `scale(${contentRect.width / state.deck.w})`;
    }
  });
  const lazy = new IntersectionObserver(
    (entries) => {
      if (!state) return;
      const entering = [];
      for (const entry of entries) {
        const frame = entry.target;
        if (!frame.isConnected) continue;
        if (!entry.isIntersecting) {
          sizes.unobserve(frame);
          if (frame.firstElementChild) frame.replaceChildren();
          continue;
        }
        if (!frame.firstElementChild) entering.push(frame);
      }
      const widths = entering.map((frame) => frame.clientWidth);
      for (const [i, frame] of entering.entries()) {
        preview(frame, widths[i]);
        sizes.observe(frame);
      }
    },
    { root: host, rootMargin: '240px' }
  );
  function highlight(index, ids) {
    const next = state.deck.slides[index].id;
    if (activeId !== next) {
      buttons.get(activeId)?.classList.remove('active');
      buttons.get(next)?.classList.add('active');
      activeId = next;
    }
    for (const id of new Set([...selected, ...ids])) {
      const b = buttons.get(id);
      if (b && selected.has(id) !== ids.has(id)) {
        b.classList.toggle('chosen', ids.has(id));
        b.setAttribute('aria-selected', ids.has(id));
      }
    }
    selected = new Set(ids);
  }
  function render(deck, assets, index, ids, refreshPreview = true) {
    const nextLayout = JSON.stringify([
      deck.w,
      deck.h,
      deck.sections,
      deck.slides.map((s) => [s.id, s.sectionId, s.hidden, s.showPageNumber]),
    ]);
    if (
      state?.deck === deck &&
      state.assets === assets &&
      layout === nextLayout
    ) {
      highlight(index, ids);
      if (refreshPreview) {
        const frame = buttons.get(activeId)?.firstElementChild;
        if (frame?.firstElementChild) preview(frame, frame.clientWidth);
      }
      return;
    }
    const scroll = host.scrollTop;
    state = { deck, assets, numbers: pageNumbers(deck) };
    layout = nextLayout;
    activeId = null;
    selected.clear();
    buttons.clear();
    sizes.disconnect();
    lazy.disconnect();
    host.replaceChildren();
    const runs = sectionRuns(deck);
    for (const run of runs) {
      if (deck.sections?.length) {
        const header = el('button', 'section-label');
        header.dataset.section = run.id || '';
        header.draggable = false;
        const closed = collapsed.has(run.id);
        header.setAttribute('aria-expanded', !closed);
        header.innerHTML = icon(closed ? 'right' : 'down', 12);
        const title = el('span');
        title.textContent = run.name;
        header.append(title);
        const count = el('small');
        count.textContent = run.slides.length;
        header.append(count);
        host.append(header);
      }
      if (collapsed.has(run.id)) continue;
      const cards = el('div', sorter ? 'sorter-grid' : 'rail-list');
      for (const { slide: s, index: i } of run.slides) {
        const tile = el(
            'div',
            'slide-tile' + (s.hidden ? ' slide-hidden' : '')
          ),
          b = el('button', 'select-slide');
        b.type = 'button';
        b.dataset.slide = i;
        buttons.set(s.id, b);
        b.title = 'Slide ' + (i + 1) + (s.hidden ? ' · Hidden' : '');
        b.setAttribute('aria-label', b.title);
        b.setAttribute('aria-selected', 'false');
        b.draggable = true;
        const frame = el('div', 'thumb-frame');
        frame.style.aspectRatio = deck.w + '/' + deck.h;
        frame.dataset.preview = i;
        const number = el('span', 'thumb-num');
        number.textContent = i + 1;
        b.append(frame, number);
        tile.append(b);
        const hide = el('button', 'slide-eye');
        hide.type = 'button';
        hide.dataset.hideSlide = i;
        hide.innerHTML = icon(s.hidden ? 'hidden' : 'eye', 13);
        hide.title = (s.hidden ? 'Show' : 'Hide') + ' slide ' + (i + 1);
        hide.setAttribute('aria-label', hide.title);
        tile.append(hide);
        cards.append(tile);
        lazy.observe(frame);
      }
      host.append(cards);
    }
    highlight(index, ids);
    host.scrollTop = scroll;
  }
  return {
    render,
    highlight,
    dragPreview(event, tile, ids) {
      const { deck, assets, numbers } = state;
      const front = deck.slides[Number(tile.dataset.slide)];
      const selectedIds = new Set(ids);
      const cards = [
        front,
        ...deck.slides
          .filter((s) => s !== front && selectedIds.has(s.id))
          .slice(0, 2),
      ];
      const rect = tile.querySelector('.thumb-frame').getBoundingClientRect();
      const width = Math.min(160, rect.width);
      const height = (width * deck.h) / deck.w;
      const offset = (cards.length - 1) * 5;
      const preview = el('div', 'slide-drag-preview');
      preview.setAttribute('aria-hidden', 'true');
      Object.assign(preview.style, {
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: width + offset + 'px',
        height: height + offset + 'px',
      });
      for (let i = cards.length - 1; i >= 0; i--) {
        const card = el('div', 'drag-card');
        Object.assign(card.style, {
          width: width + 'px',
          height: height + 'px',
          left: i * 5 + 'px',
          top: i * 5 + 'px',
        });
        prepareSlide?.(cards[i]);
        const content = scene(cards[i], deck, assets, false, false, numbers);
        content.style.transform = `scale(${width / deck.w})`;
        card.append(content);
        preview.append(card);
      }
      if (ids.length > 1) {
        const count = el('span', 'drag-count');
        count.textContent = ids.length;
        preview.append(count);
      }
      document.body.append(preview);
      event.dataTransfer.setDragImage(
        preview,
        Math.max(
          0,
          Math.min(width, ((event.clientX - rect.left) * width) / rect.width)
        ),
        Math.max(
          0,
          Math.min(height, ((event.clientY - rect.top) * height) / rect.height)
        )
      );
      requestAnimationFrame(() => preview.remove());
    },
    toggleSection(id) {
      layout = null;
      id = id || null;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
    },
    clear() {
      state = null;
      layout = null;
      activeId = null;
      selected.clear();
      buttons.clear();
      collapsed.clear();
      sizes.disconnect();
      lazy.disconnect();
      host.replaceChildren();
    },
    reveal(s) {
      if (collapsed.delete(s.sectionId || null)) layout = null;
    },
  };
}
