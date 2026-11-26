import { el, icon, scene } from './view.js';
import { uid } from './model.js';

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
export function slideBrowser(host, { sorter = false } = {}) {
  let state,
    selected = new Set();
  const collapsed = new Set();
  const sizes = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      if (target.firstElementChild)
        target.firstElementChild.style.transform = `scale(${contentRect.width / state.deck.w})`;
    }
  });
  const lazy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const frame = entry.target;
        if (!frame.isConnected) continue;
        if (!entry.isIntersecting) {
          if (frame.firstElementChild) frame.replaceChildren();
          continue;
        }
        if (!frame.firstElementChild) {
          const index = Number(frame.dataset.preview);
          const s = state.deck.slides[index];
          if (s) {
            const n = scene(s, state.deck, state.assets);
            n.style.transform = `scale(${frame.clientWidth / state.deck.w})`;
            frame.append(n);
          }
        }
      }
    },
    { root: host, rootMargin: '240px' }
  );
  function highlight(index, ids) {
    selected = new Set(ids);
    for (const b of host.querySelectorAll('[data-slide]')) {
      const i = Number(b.dataset.slide);
      b.classList.toggle('active', i === index);
      b.classList.toggle('chosen', selected.has(state.deck.slides[i].id));
      b.setAttribute('aria-selected', selected.has(state.deck.slides[i].id));
    }
  }
  function render(deck, assets, index, ids) {
    const scroll = host.scrollTop;
    state = { deck, assets };
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
        b.title = 'Slide ' + (i + 1) + (s.hidden ? ' · Hidden' : '');
        b.setAttribute('aria-label', b.title);
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
        sizes.observe(frame);
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
      const { deck, assets } = state;
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
        const content = scene(cards[i], deck, assets);
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
      id = id || null;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
    },
    clear() {
      collapsed.clear();
      sizes.disconnect();
      lazy.disconnect();
      host.replaceChildren();
    },
    reveal(s) {
      collapsed.delete(s.sectionId || null);
    },
  };
}
