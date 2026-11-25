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
  (deck.sections ??= []).push(section);
  // Keep the section at the selection's location when creating the first section.
  if (deck.sections.length === 1 && ids.size === deck.slides.length) {
    deck.slides.forEach((s) => (s.sectionId = section.id));
  } else {
    const unassigned = deck.slides.filter(
      (s) => !s.sectionId && !ids.has(s.id)
    );
    if (unassigned.length) {
      const base = { id: uid(), name: 'Default section' };
      deck.sections.unshift(base);
      unassigned.forEach((s) => (s.sectionId = base.id));
    }
    moveIntoSection(deck, ids, section.id);
  }
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
