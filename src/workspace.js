import { icon } from './view.js';

export const zoomStops = [
  0.0625, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16,
];
export function workspace(action) {
  const tools = [
    ['pointer', 'Select (V)'],
    ['text', 'Text (T)'],
    ['rect', 'Rectangle (R)'],
    ['ellipse', 'Ellipse (O)'],
    ['line', 'Line (L)'],
    ['callout', 'Callout'],
    ['image', 'Insert image…'],
    ['video', 'Insert video…'],
    ['embed', 'Embed YouTube or Vimeo…'],
  ];
  return `<header class="document-bar" data-tauri-drag-region="deep">
    <div class="document-name">
      <button type="button" class="p-menu" data-action="fileMenu" aria-label="Document menu" aria-haspopup="menu" title="Document menu"><canvas id="floating-p" width="150" height="150" aria-hidden="true"></canvas><span class="doc-name">untitled.pptx</span>${icon('down', 11)}</button>
      <span id="status" role="status"></span>
    </div>
    <div class="header-actions">
      <button type="button" class="share-link" data-action="copyShareLink" hidden>${icon('embed', 14)}<span>Share…</span></button>
      <div class="panel-toggles" role="group" aria-label="Workspace panels">${action('navigator', 'Toggle slide navigator', 'sidebar')}${action('script', 'Toggle script', 'script')}${action('inspector', 'Toggle inspector', 'panel')}</div>
      <div class="appearance-control">
        <select id="appearance" aria-label="Appearance" title="Appearance">
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>${icon('down', 11)}
      </div>
    </div>
  </header>
  <main class="work">
    <aside id="slide-navigator" class="rail" aria-label="Slide navigator">
      <div class="section-heading rail-head"><span class="head-title">Slides <span class="head-count"></span></span><div class="rail-actions">${action('overview', 'Slide overview', 'overview')}${action('addSlide', 'Add slide', 'plus')}</div></div>
      <div class="thumbs"></div>
      <div class="rail-foot">${action('newSection', 'New section', 'section', 'row-button', true)}</div>
    </aside>
    <div class="rail-resizer" role="separator" tabindex="0" aria-label="Resize slide navigator" aria-orientation="vertical" aria-valuemin="140" aria-valuemax="460"></div>
    <div class="stage-column"><section class="stage" aria-label="Slide canvas"><div class="ruler-corner"></div><canvas class="ruler-top"></canvas><canvas class="ruler-left"></canvas><div class="viewport"><div class="world"><div class="paper-frame"><div class="page-label"></div><div class="artboard"></div></div></div></div>
      <div class="floating-tools" role="toolbar" aria-label="Canvas tools">${tools.map(([id, label]) => action('tool-' + id, label, id, 'tool')).join('')}<i class="divider"></i>${action('gridVisible', 'Layout grid (G)', 'grid', 'tool')}</div>
      <div class="sorter" aria-label="Slide overview" hidden></div>
    </section><section id="script-panel" class="script-panel" aria-label="Speaker notes" hidden>
      <div class="script-resizer" role="separator" tabindex="0" aria-label="Resize script panel" aria-orientation="horizontal" aria-controls="slide-script"></div>
      <div class="script-header"><label for="slide-script">Script</label><div class="script-font-controls" role="group" aria-label="Script font size">
        <button type="button" class="icon-btn" data-font-step="-1" aria-label="Decrease script font size" title="Decrease script font size">${icon('minus', 13)}</button>
        <output aria-label="Script font size"></output>
        <button type="button" class="icon-btn" data-font-step="1" aria-label="Increase script font size" title="Increase script font size">${icon('plus', 13)}</button>
      </div></div>
      <textarea id="slide-script" aria-label="Slide script" placeholder="Add speaker notes…"></textarea>
    </section></div>
    <aside id="slide-inspector" class="inspector" aria-label="Inspector"><div class="inspect-tabs"><button class="tab active" data-action="design">Design</button><button class="tab" data-action="layers">Layers</button><button class="tab" data-action="comments">Comments</button></div><div id="properties"></div></aside>
  </main><footer class="footer"><div class="foot-left"><span id="slide-counter"></span><button type="button" class="icon-btn" data-action="pageNumber" aria-label="Show page number on this slide" title="Show page number on this slide" aria-pressed="false">P</button></div><div class="foot-right">${action('present', 'Open presentation window', 'play')}${action('canvasView', 'Slide view', 'slide')}${action('overview', 'Slide overview', 'overview')}<i class="divider"></i>${action('zoomOut', 'Zoom out', 'minus')}<select id="zoom" aria-label="Zoom"><option value="fit">Fit</option><option value="custom" hidden></option>${zoomStops.map((v) => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('')}</select>${action('zoomIn', 'Zoom in', 'plus')}${action('fit', 'Zoom to fit', 'fit')}</div></footer>`;
}

export function bindAppearance(select) {
  const key = 'pure-point.appearance';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const saved = localStorage.getItem(key);
  select.value = ['light', 'dark'].includes(saved) ? saved : 'system';
  function apply() {
    document.documentElement.dataset.theme =
      select.value === 'system'
        ? system.matches
          ? 'dark'
          : 'light'
        : select.value;
  }
  select.addEventListener('change', () => {
    localStorage.setItem(key, select.value);
    apply();
  });
  system.addEventListener('change', apply);
  apply();
}

export function animateLogo(canvas) {
  const count = 80,
    speed = 0.8,
    spread = 0.095 * 1.3,
    amplitude = 0.024,
    stem = 0.67 / 1.67;
  const rand = () => Math.random(),
    points = Array.from({ length: count }, (_, i) => {
      const u = (i + 0.5) / count,
        a = ((u - stem) / (1 - stem)) * Math.PI;
      return {
        x:
          (u < stem ? 0.365 : 0.365 + Math.sin(a) * 0.29) +
          (rand() - 0.5) * spread,
        y:
          (u < stem ? 0.81 - (u / stem) * 0.58 : 0.395 - Math.cos(a) * 0.165) +
          (rand() - 0.5) * spread,
        r: (0.007 + rand() * 0.024) * 1.2,
        fx: 0.5 + rand() * 0.7,
        fy: 0.5 + rand() * 0.7,
        px: rand() * Math.PI * 2,
        py: rand() * Math.PI * 2,
      };
    });
  const ctx = canvas.getContext('2d'),
    reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let frame,
    last = 0,
    t = 0;
  function draw(now) {
    t += Math.min(now - last, 50) * 0.001 * speed;
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(28,27,216,.9)';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(
        (p.x + Math.sin(t * p.fx + p.px) * amplitude) * canvas.width,
        (p.y + Math.cos(t * p.fy + p.py) * amplitude) * canvas.height,
        p.r * canvas.width,
        0,
        2 * Math.PI
      );
      ctx.fill();
    }
    if (!document.hidden && !reduce.matches)
      frame = requestAnimationFrame(draw);
  }
  function restart() {
    cancelAnimationFrame(frame);
    draw(performance.now());
  }
  document.addEventListener('visibilitychange', restart);
  reduce.addEventListener('change', restart);
  restart();
}

export function bindRailResize(handle) {
  let width = Number(localStorage.getItem('pure-point.rail-width')) || 191;
  function set(v) {
    width = Math.round(Math.min(460, innerWidth * 0.42, Math.max(140, v)));
    document.documentElement.style.setProperty('--rail-width', width + 'px');
    handle.setAttribute('aria-valuenow', width);
  }
  set(width);
  let origin;
  handle.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    origin = { x: e.clientX, width };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  };
  handle.onpointermove = (e) => {
    if (origin) set(origin.width + e.clientX - origin.x);
  };
  handle.onlostpointercapture = () => {
    origin = null;
    handle.classList.remove('dragging');
    localStorage.setItem('pure-point.rail-width', width);
  };
  handle.onkeydown = (e) => {
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      set(width + (e.key === 'ArrowLeft' ? -10 : 10));
      localStorage.setItem('pure-point.rail-width', width);
    }
  };
}

export function bindScriptPanel(panel) {
  const handle = panel.querySelector('.script-resizer');
  const notes = panel.querySelector('textarea');
  const sizeLabel = panel.querySelector('output');
  const buttons = [...panel.querySelectorAll('[data-font-step]')];
  const heightKey = 'pure-point.script-height';
  const fontKey = 'pure-point.script-font-size';
  const minHeight = 80;
  const maxHeight = () => Math.floor(panel.parentElement.clientHeight * 0.7);
  let fontSize = Number(localStorage.getItem(fontKey)) || 13;
  const savedHeight = Number(localStorage.getItem(heightKey));
  if (savedHeight >= minHeight)
    panel.style.setProperty('--script-height', savedHeight + 'px');

  function setFontSize(value) {
    fontSize = Math.max(9, Math.min(36, value));
    notes.style.fontSize = fontSize + 'px';
    sizeLabel.value = fontSize + ' px';
    buttons[0].disabled = fontSize === 9;
    buttons[1].disabled = fontSize === 36;
  }
  setFontSize(fontSize);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      setFontSize(fontSize + Number(button.dataset.fontStep));
      localStorage.setItem(fontKey, fontSize);
    });
  }

  const height = () => Math.round(panel.getBoundingClientRect().height);
  function setHeight(value) {
    const limit = Math.max(minHeight, maxHeight());
    const next = Math.max(minHeight, Math.min(limit, Math.round(value)));
    panel.style.setProperty('--script-height', next + 'px');
    return next;
  }
  handle.setAttribute('aria-valuemin', minHeight);
  const observer = new ResizeObserver(() => {
    if (panel.hidden) return;
    handle.setAttribute('aria-valuenow', height());
    handle.setAttribute('aria-valuemax', Math.max(minHeight, maxHeight()));
  });
  observer.observe(panel);
  observer.observe(panel.parentElement);

  let drag;
  handle.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, y: e.clientY, height: height() };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (drag?.id === e.pointerId) setHeight(drag.height + drag.y - e.clientY);
  });
  handle.addEventListener('lostpointercapture', (e) => {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    handle.classList.remove('dragging');
    if (!panel.hidden) localStorage.setItem(heightKey, height());
  });
  handle.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const next = setHeight(height() + (e.key === 'ArrowUp' ? 12 : -12));
    localStorage.setItem(heightKey, next);
  });
}

// Handle WebKit gesture events, Chromium trackpad wheel events and two touch pointers.
export function bindPinch(element, apply) {
  let gesture = 0;
  const touches = new Map();
  let distance = 0;
  element.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        apply(
          Math.exp(-Math.min(120, Math.max(-120, e.deltaY)) * 0.012),
          e.clientX,
          e.clientY
        );
      }
    },
    { passive: false }
  );
  element.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
      gesture = e.scale || 1;
    },
    { passive: false }
  );
  element.addEventListener(
    'gesturechange',
    (e) => {
      e.preventDefault();
      if (gesture && e.scale > 0)
        apply(e.scale / gesture, e.clientX, e.clientY);
      gesture = e.scale;
    },
    { passive: false }
  );
  element.addEventListener(
    'gestureend',
    (e) => {
      e.preventDefault();
      gesture = 0;
    },
    { passive: false }
  );
  const measure = () => {
    const [a, b] = touches.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      distance = measure();
    }
  });
  element.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = measure();
    if (!gesture && distance && next) {
      const [a, b] = touches.values();
      apply(next / distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    distance = next;
  });
  for (const type of ['pointerup', 'pointercancel'])
    window.addEventListener(type, (e) => {
      touches.delete(e.pointerId);
      distance = measure();
    });
}
