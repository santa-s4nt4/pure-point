import { createElement, Pipette, X } from 'lucide';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  hsvFromRgb,
  rgbFromHsv,
  hslFromHsv,
  hsvFromHsl,
  parseHex,
  rgbaHex,
} from './paint.js';
import './color-picker.css';

let openPicker;
export function closeColorPicker() {
  openPicker?.();
}

const clamp = (value, max = 1) => Math.max(0, Math.min(max, value));
const percent = (n) => Math.round(n * 100);
function recentColors() {
  try {
    return JSON.parse(
      localStorage.getItem('pure-point.recent-colors') || '[]'
    ).filter((x) => typeof x === 'string' && parseHex(x));
  } catch {
    return [];
  }
}
function cssColor(value) {
  if (
    !value.trim() ||
    !CSS.supports('color', value) ||
    /var\(|currentcolor|inherit|initial|unset|revert/i.test(value)
  )
    return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = value;
  const normalized = ctx.fillStyle;
  if (normalized.startsWith('#')) return parseHex(normalized);
  const match = normalized.match(
    /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/
  );
  if (match)
    return { rgb: match.slice(1, 4).map(Number), alpha: Number(match[4] ?? 1) };
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { rgb: [r, g, b], alpha: a / 255 };
}

export function chooseColor(
  anchor,
  { colors, allowNone, onPreview, onCommit, onUndo }
) {
  if (openPicker?.anchor === anchor) {
    closeColorPicker();
    return;
  }
  closeColorPicker();
  const label = anchor.getAttribute('aria-label'),
    initial = anchor.dataset.value;
  const start = parseHex(initial || '#FFFFFF');
  let hsv = hsvFromRgb(start.rgb),
    alpha = start.alpha ?? 1,
    paint = initial || null,
    pending = false,
    sampling = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'color-dialog';
  dialog.setAttribute('aria-label', label + ' color picker');
  dialog.innerHTML = `
    <div class="paint-header"><strong class="paint-type">Solid</strong>
      <button type="button" class="paint-close" aria-label="Close color picker"></button></div>
    <div class="paint-sv" role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100"><i></i></div>
    <div class="paint-adjust"><button class="paint-dropper" aria-label="Pick a color from the screen" title="Pick a color from the screen"></button>
      <div class="paint-sliders"><input aria-label="Hue" class="paint-hue" type="range" min="0" max="360" step="1">
      <div class="paint-checks"><input aria-label="Opacity slider" class="paint-alpha" type="range" min="0" max="100" step="1"></div></div></div>
    <div class="paint-values"><select aria-label="Color format"><option>Hex</option><option>HSB</option><option>HSL</option><option>CSS</option><option>RGB</option></select>
      <div class="paint-channels"></div><label class="paint-percent"><input type="text" inputmode="decimal" aria-label="Opacity" spellcheck="false"><span>%</span></label></div>
    <div class="paint-palette"><select aria-label="Color palette"><option>Document colors</option><option>Recent colors</option></select><div class="paint-swatches"></div></div>`;
  const $ = (s) => dialog.querySelector(s),
    sv = $('.paint-sv'),
    hue = $('.paint-hue'),
    opacity = $('.paint-alpha'),
    alphaInput = $('.paint-percent input'),
    channels = $('.paint-channels'),
    format = $('[aria-label="Color format"]'),
    palette = $('[aria-label="Color palette"]'),
    dropper = $('.paint-dropper');
  const lifetime = new AbortController(),
    options = { signal: lifetime.signal };
  $('.paint-close').append(createElement(X, { width: 15, height: 15 }));
  dropper.append(createElement(Pipette, { width: 16, height: 16 }));
  dropper.hidden = !isTauri() && !window.EyeDropper;
  if (allowNone) {
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'Paint type');
    type.innerHTML =
      '<option value="solid">Solid</option><option value="none">No paint</option>';
    $('.paint-type').replaceWith(type);
    type.onchange = () => {
      if (type.value === 'none') {
        pending = true;
        paint = null;
        onPreview(null);
        sync();
      } else publish();
      commit();
    };
  }
  function current() {
    return rgbaHex(rgbFromHsv(hsv), alpha);
  }
  function publish(edited) {
    const next = current();
    if (next !== paint) {
      paint = next;
      pending = true;
      onPreview(paint);
    }
    sync(edited);
  }
  function commit() {
    if (!pending) return;
    pending = false;
    onCommit();
    if (paint) {
      const recent = [
        paint,
        ...recentColors().filter((v) => v !== paint),
      ].slice(0, 18);
      localStorage.setItem('pure-point.recent-colors', JSON.stringify(recent));
      if (palette.selectedIndex === 1) paintPalette();
    }
  }
  function updateRgb(rgb, a, edited) {
    hsv = hsvFromRgb(rgb, hsv.h);
    if (a != null) alpha = a;
    publish(edited);
  }
  function paintPalette() {
    const box = $('.paint-swatches');
    box.replaceChildren();
    for (const value of palette.selectedIndex === 0 ? colors : recentColors()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'paint-sample';
      button.title = button.ariaLabel = value;
      button.style.setProperty('--sample', value);
      button.onclick = () => {
        const parsed = parseHex(value);
        updateRgb(parsed.rgb, parsed.alpha ?? 1);
        commit();
      };
      box.append(button);
    }
    if (!box.children.length) {
      const empty = document.createElement('small');
      empty.textContent = 'No recent colors';
      box.append(empty);
    }
  }
  function inputs() {
    const fieldFormat = format.value;
    const names = {
      Hex: ['Hex color'],
      CSS: ['CSS color'],
      RGB: ['Red', 'Green', 'Blue'],
      HSB: ['Hue degrees', 'Saturation', 'Brightness'],
      HSL: ['Hue degrees', 'Saturation', 'Lightness'],
    }[format.value];
    channels.replaceChildren();
    for (const name of names) {
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (names.length === 3) input.inputMode = 'decimal';
      input.setAttribute('aria-label', name);
      input.title = name;
      input.oninput = () => read(input);
      input.onblur = () => {
        if (format.value !== fieldFormat || !input.isConnected) return;
        if (
          fieldFormat === 'Hex' &&
          /^#?[a-f\d]{3,4}$/i.test(input.value.trim())
        )
          read(input, true);
        sync();
        commit();
      };
      channels.append(input);
    }
    sync();
  }
  function read(edited, final = false) {
    const fields = [...channels.children],
      values = fields.map((i) => i.value.trim());
    if (format.value === 'Hex') {
      if (
        !final &&
        !/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(values[0].replace(/^#/, ''))
      )
        return;
      const result = parseHex(values[0]);
      if (result) updateRgb(result.rgb, result.alpha, edited);
    } else if (format.value === 'CSS') {
      const c = cssColor(values[0]);
      if (c) updateRgb(c.rgb, c.alpha ?? 1, edited);
    } else {
      if (values.some((v) => !v || !Number.isFinite(Number(v)))) return;
      const n = values.map(Number);
      if (format.value === 'RGB')
        updateRgb(
          n.map((v) => clamp(v, 255)),
          null,
          edited
        );
      else {
        const h = clamp(n[0], 360),
          s = clamp(n[1], 100) / 100,
          v = clamp(n[2], 100) / 100;
        hsv = format.value === 'HSB' ? { h, s, v } : hsvFromHsl(h, s, v);
        publish(edited);
      }
    }
  }
  function sync(edited) {
    const rgb = rgbFromHsv(hsv),
      hex = rgbaHex(rgb),
      hsl = hslFromHsv(hsv);
    const values = {
      Hex: [hex.slice(1)],
      CSS: [alpha === 1 ? hex : `rgb(${rgb.join(' ')} / ${percent(alpha)}%)`],
      RGB: rgb,
      HSB: [Math.round(hsv.h), percent(hsv.s), percent(hsv.v)],
      HSL: [Math.round(hsl[0]), percent(hsl[1]), percent(hsl[2])],
    }[format.value];
    [...channels.children].forEach((i, j) => {
      if (i !== edited) i.value = values[j];
    });
    if (alphaInput !== edited) alphaInput.value = percent(alpha);
    hue.value = hsv.h;
    opacity.value = percent(alpha);
    dialog.style.setProperty('--hue', hsv.h);
    dialog.style.setProperty('--rgb', hex);
    sv.firstElementChild.style.left = percent(hsv.s) + '%';
    sv.firstElementChild.style.top = percent(1 - hsv.v) + '%';
    sv.setAttribute('aria-valuenow', String(percent(hsv.s)));
    sv.setAttribute(
      'aria-valuetext',
      `Saturation ${percent(hsv.s)}%, brightness ${percent(hsv.v)}%`
    );
    const type = $('[aria-label="Paint type"]');
    if (type) type.value = paint ? 'solid' : 'none';
  }
  const fromPoint = (e) => {
    const r = sv.getBoundingClientRect();
    hsv.s = clamp((e.clientX - r.left) / r.width);
    hsv.v = 1 - clamp((e.clientY - r.top) / r.height);
    publish();
  };
  sv.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sv.focus();
    sv.setPointerCapture(e.pointerId);
    fromPoint(e);
  };
  sv.onpointermove = (e) => {
    if (sv.hasPointerCapture(e.pointerId)) fromPoint(e);
  };
  sv.onlostpointercapture = commit;
  sv.onkeydown = (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'].includes(e.key))
      return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      hsv.v = clamp(hsv.v + (e.key === 'ArrowUp' ? step : -step));
    else hsv.s = clamp(hsv.s + (e.key === 'ArrowRight' ? step : -step));
    publish();
    commit();
  };
  hue.oninput = () => {
    hsv.h = Number(hue.value);
    publish();
  };
  opacity.oninput = () => {
    alpha = Number(opacity.value) / 100;
    publish();
  };
  hue.onchange = opacity.onchange = commit;
  alphaInput.oninput = () => {
    const v = alphaInput.value.trim().replace(/%$/, '');
    if (v !== '' && Number.isFinite(Number(v))) {
      alpha = clamp(Number(v), 100) / 100;
      publish(alphaInput);
    }
  };
  alphaInput.onblur = () => {
    sync();
    commit();
  };
  format.onchange = () => {
    commit();
    inputs();
  };
  palette.onchange = paintPalette;
  dropper.onclick = async () => {
    sampling = true;
    try {
      const value = isTauri()
        ? await invoke('sample_screen_color')
        : (await new window.EyeDropper().open()).sRGBHex;
      if (value && dialog.isConnected) {
        updateRgb(parseHex(value).rgb, null);
        commit();
      }
    } catch (error) {
      if (error.name !== 'AbortError')
        console.warn('Screen color sampler:', error);
    } finally {
      sampling = false;
    }
  };
  function close(focus = false) {
    if (!dialog.isConnected) return;
    if (
      dialog.contains(document.activeElement) &&
      document.activeElement.matches('input[type="text"]')
    )
      document.activeElement.blur();
    commit();
    lifetime.abort();
    openPicker = null;
    dialog.close();
    dialog.remove();
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  openPicker = () => close(false);
  openPicker.anchor = anchor;
  $('.paint-close').onclick = () => close(true);
  dialog.onkeydown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Enter' && e.target.matches('input[type=text]')) {
      e.preventDefault();
      e.target.blur();
      close(true);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
      onUndo(e.shiftKey);
    }
  };
  // Commit before canvas selection or inspector changes can switch the target.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!sampling && !dialog.contains(e.target) && !anchor.contains(e.target))
        close(false);
    },
    { capture: true, ...options }
  );
  window.addEventListener('resize', () => position(), options);
  function position() {
    const r = anchor.getBoundingClientRect(),
      box = dialog.getBoundingClientRect(),
      left =
        anchor.closest('.inspector')?.getBoundingClientRect().left ?? r.left;
    dialog.style.left =
      Math.max(
        8,
        Math.min(
          left - box.width - 8 > 0 ? left - box.width - 8 : r.right + 8,
          innerWidth - box.width - 8
        )
      ) + 'px';
    dialog.style.top =
      Math.max(8, Math.min(r.top - 8, innerHeight - box.height - 8)) + 'px';
  }
  document.body.append(dialog);
  dialog.show();
  inputs();
  paintPalette();
  position();
  dialog.focus({ preventScroll: true });
}
