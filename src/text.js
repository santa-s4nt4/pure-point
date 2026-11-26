export const defaultTextSize = 16;

// PowerPoint advances a single-spaced line by approximately 1.2 em. Store
// percentages as native multiples and keep exact point leading as CSS pixels
// in the slide's one-logical-pixel-per-point coordinate system.
export const singleLine = 1.2;
export const lineBox = (value) =>
  typeof value === 'string' ? value : (value || 1) * singleLine;

// The caller supplies a detached text element carrying its runs and insets.
export function measureTextElement(text, maxWidth) {
  text.removeAttribute('contenteditable');
  text.removeAttribute('role');
  text.classList.remove('text-edit');
  Object.assign(text.style, {
    position: 'fixed',
    visibility: 'hidden',
    inset: '0 auto auto -100000px',
    width: 'max-content',
    height: 'max-content',
  });
  if (maxWidth !== undefined) text.style.maxWidth = maxWidth + 'px';
  document.body.append(text);
  const box = text.getBoundingClientRect();
  text.remove();
  return { w: box.width, h: box.height };
}

export function lineAdvance(value, size) {
  const height = lineBox(value);
  return typeof height === 'string' ? parseFloat(height) : height * size;
}

// PowerPoint puts roughly three quarters of extra line spacing above the
// baseline. CSS splits it evenly. The last line keeps its unscaled descent,
// which also affects the vertical position of centered and bottom anchors.
export function leadingOffset(value, size) {
  return (lineAdvance(value, size) - singleLine * size) / 4;
}

export function paragraphMetrics({ runs, base, lineHeight }) {
  // An unused large master font must not enlarge the browser's implicit
  // line box (and caret) when all visible runs are smaller.
  let strut,
    largest = 0,
    lineSize = 0,
    height = 0;
  for (const run of runs) {
    if (!run.text) continue;
    if (!strut || run.size < strut.size) strut = run;
    largest = Math.max(largest, run.size);
    const segments = run.text.split('\n');
    for (let i = 0; i < segments.length; i++) {
      if (i) {
        height += lineAdvance(lineHeight, lineSize || run.size);
        lineSize = 0;
      }
      if (segments[i]) lineSize = Math.max(lineSize, run.size);
    }
  }
  return {
    strut,
    offset: leadingOffset(lineHeight, largest || base.size),
    minHeight:
      height + lineAdvance(lineHeight, lineSize || strut?.size || base.size),
  };
}

// Retain formatting and hyperlinks on the unchanged prefix and suffix of a paragraph.
export function replaceRunText(runs, next) {
  const prior = runs.join('');
  let prefix = 0,
    suffix = 0;
  const common = Math.min(prior.length, next.length);
  while (prefix < common && prior[prefix] === next[prefix]) prefix++;
  while (
    suffix < common - prefix &&
    prior[prior.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  const inserted = next.slice(prefix, next.length - suffix);
  let cursor = 0,
    assigned = false;
  return runs.map((run) => {
    const end = cursor + run.length;
    let text = run.slice(0, Math.max(0, prefix - cursor));
    if (!assigned && end >= prefix) {
      text += inserted;
      assigned = true;
    }
    text += run.slice(Math.max(0, prior.length - suffix - cursor));
    cursor = end;
    return text;
  });
}

export function updateText(object, text) {
  if (object.paragraphs) {
    const original = object.paragraphs;
    object.paragraphs = text.split('\n').map((line, i) => {
      const p = original[i];
      if (!p || !p.runs.length || p.runs.some((r) => r.text.includes('\n'))) {
        const style = p || original[i - 1] || original[0] || {};
        const { font, size, bold, italic, color, letterSpacing } = object;
        const base = style.base || {
          font,
          size,
          bold,
          italic,
          color,
          letterSpacing,
        };
        return {
          align: object.align,
          lineHeight: object.lineHeight,
          ...style,
          base,
          runs: [{ ...base, text: line }],
        };
      }
      const values = replaceRunText(
        p.runs.map((r) => r.text),
        line
      );
      return { ...p, runs: p.runs.map((r, j) => ({ ...r, text: values[j] })) };
    });
  }
  object.text = text;
}
