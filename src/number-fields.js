// Keep the native number input available for typing. A horizontal drag on
// either the label or its value scrubs in the units shown in the inspector.
export function bindNumberFields(panel, { begin, preview, finish, available }) {
  const numberAt = (target) =>
    target.closest('.field')?.querySelector('input[type=number]');
  const step = (input, shift) => {
    const fine = [
      'letterSpacing',
      'strokeWidth',
      'size',
      'cornerRadius',
    ].includes(input.dataset.field);
    return (fine ? 0.1 : 1) * (shift ? 10 : 1);
  };
  function adjust(input, value) {
    const next = +Math.min(+input.max, Math.max(+input.min, value)).toFixed(2);
    if (next === input.valueAsNumber) return;
    input.value = next;
    preview(input);
  }
  panel.addEventListener('keydown', (e) => {
    const input = numberAt(e.target);
    if (
      !available() ||
      input !== e.target ||
      !['ArrowUp', 'ArrowDown'].includes(e.key)
    )
      return;
    e.preventDefault();
    begin(input);
    adjust(
      input,
      (+input.value || 0) +
        (e.key === 'ArrowUp' ? 1 : -1) * step(input, e.shiftKey)
    );
    finish(input, true);
  });
  let drag;
  panel.addEventListener('pointerdown', (e) => {
    const input = numberAt(e.target);
    if (!available() || !input || e.button !== 0 || drag) return;
    drag = {
      input,
      x: e.clientX,
      value: +input.value || 0,
      id: e.pointerId,
      active: false,
    };
  });
  window.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (!drag.active) {
      if (Math.abs(dx) < 4) return;
      if (!drag.input.isConnected) {
        drag = null;
        return;
      }
      drag.active = true;
      panel.setPointerCapture(e.pointerId);
      begin(drag.input);
      panel.classList.add('scrubbing');
    }
    e.preventDefault();
    adjust(
      drag.input,
      drag.value + Math.trunc(dx / 3) * step(drag.input, e.shiftKey)
    );
  });
  function end(e, cancel) {
    if (drag?.id !== e.pointerId) return;
    const { active, input, value } = drag;
    drag = null;
    if (!active) return;
    if (cancel) adjust(input, value);
    if (panel.hasPointerCapture(e.pointerId))
      panel.releasePointerCapture(e.pointerId);
    panel.classList.remove('scrubbing');
    finish(input);
  }
  window.addEventListener('pointerup', (e) => end(e, false));
  window.addEventListener('pointercancel', (e) => end(e, true));
  panel.addEventListener('lostpointercapture', (e) => end(e, true));
}
