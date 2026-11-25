import { replaceRunText } from './text.js';

// Leave the marker outside the editing range. The list item's content edge is
// PowerPoint's marL; the marker starts at marL + the signed hanging indent.
export function bulletList(paragraph, size) {
  const list = document.createElement('ul');
  const margin = paragraph?.margin ?? 1.5 * size;
  const indent = paragraph?.indent ?? -size;
  list.dataset.bullet = paragraph?.bullet || '•';
  list.dataset.margin = margin;
  list.dataset.indent = indent;
  list.style.setProperty('--bullet-margin', margin + 'px');
  list.style.setProperty('--bullet-position', margin + indent + 'px');
  list.style.setProperty(
    '--bullet-character',
    '"' + CSS.escape(list.dataset.bullet) + '"'
  );
  return list;
}
const paragraphTags = new Set(['DIV', 'P', 'UL', 'OL', 'LI']);
const block = (node) =>
  node.nodeType === Node.ELEMENT_NODE && paragraphTags.has(node.tagName);

export function editableParagraphs(root, object) {
  const rows = [];
  function scan(parent, source, list) {
    if (parent.hasAttribute('data-paragraph'))
      source = Number(parent.dataset.paragraph);
    if (parent.tagName === 'UL' || parent.tagName === 'OL') list = parent;
    let value = '',
      fragments = [],
      inline = false,
      blocks = false;
    function flush() {
      rows.push({
        text: value.replace(/\u00a0/g, ' '),
        source,
        list,
        fragments,
      });
      value = '';
      fragments = [];
      inline = false;
    }
    function append(n, text) {
      value += text;
      // A native edit inside a styled span keeps its original run identity,
      // including when Japanese and Latin glyphs are rendered separately.
      if (object.paragraphs && text) {
        const marker = n.parentElement?.closest('[data-run-index]');
        fragments.push({
          run: marker ? Number(marker.dataset.runIndex) : -1,
          text,
        });
      }
      inline = true;
    }
    function inlineNode(n) {
      if (n.nodeType === Node.TEXT_NODE) {
        append(n, n.data);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      if (n.tagName === 'BR') {
        // A final <br> is the native caret stop for an empty paragraph.
        append(n, n.nextSibling ? '\n' : '');
        return;
      }
      for (const c of n.childNodes) inlineNode(c);
    }
    for (const n of parent.childNodes) {
      if (block(n)) {
        if (inline) flush();
        blocks = true;
        scan(n, source, list);
      } else inlineNode(n);
    }
    if (inline || (!blocks && !['UL', 'OL'].includes(parent.tagName))) flush();
  }
  scan(root, undefined, null);
  return rows.map(({ text, source, list, fragments }, i) => {
    const index = source ?? Math.min(i, (object.paragraphs?.length || 1) - 1);
    const prior = object.paragraphs?.[index];
    const bullet = list ? list.dataset.bullet || '•' : '';
    const points = (key, defaultValue) =>
      list?.dataset[key] !== undefined
        ? Number(list.dataset[key])
        : defaultValue;
    let runTexts;
    if (
      prior &&
      fragments.length &&
      fragments.every(
        ({ run }, j) => prior.runs[run] && (!j || fragments[j - 1].run <= run)
      )
    ) {
      runTexts = prior.runs.map(() => '');
      for (const { run, text } of fragments)
        runTexts[run] += text.replace(/\u00a0/g, ' ');
    }
    return {
      text,
      runTexts,
      index,
      bullet,
      margin: bullet
        ? points('margin', 1.5 * object.size)
        : prior?.bullet
          ? 0
          : prior?.margin || 0,
      indent: bullet
        ? points('indent', -object.size)
        : prior?.bullet
          ? 0
          : prior?.indent || 0,
    };
  });
}
export function applyParagraphs(object, rows) {
  if (object.paragraphs || rows.some((p) => p.bullet)) {
    const originals = object.paragraphs || [];
    const { font, size, bold, italic, color, letterSpacing, eastAsianFont } =
      object;
    const standard = {
      font,
      size,
      bold,
      italic,
      color,
      letterSpacing,
      eastAsianFont,
    };
    object.paragraphs = rows.map(
      ({ text, runTexts, index, bullet, margin, indent }) => {
        const prior = originals[index];
        const base = prior?.base || standard;
        const previous = prior?.runs || [];
        const values =
          runTexts ||
          replaceRunText(
            previous.map((r) => r.text),
            text
          );
        const runs = previous.length
          ? previous.map((r, i) => ({ ...r, text: values[i] }))
          : [{ ...base, text }];
        return {
          align: object.align,
          lineHeight: object.lineHeight,
          ...prior,
          base,
          runs,
          bullet,
          margin,
          indent,
        };
      }
    );
  }
  object.text = rows.map((p) => p.text).join('\n');
}
export function convertDash(event, input, object) {
  if (
    event.inputType !== 'insertText' ||
    event.data !== ' ' ||
    event.isComposing
  )
    return;
  const selection = document.getSelection();
  if (
    !selection.isCollapsed ||
    !selection.rangeCount ||
    !input.contains(selection.anchorNode)
  )
    return;
  const anchor = selection.anchorNode;
  const target =
    anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
  const line = target.closest('li,div,p');
  if (!line || line.textContent !== '-') return;
  const range = selection.getRangeAt(0).cloneRange();
  range.setStart(line, 0);
  if (range.toString() !== '-') return;
  event.preventDefault();
  selection.removeAllRanges();
  selection.addRange(range);
  if (line.closest('li')) {
    document.execCommand('delete');
    return;
  }
  const list = bulletList(null, object.size),
    entry = document.createElement('li');
  if (line.dataset.paragraph !== undefined)
    entry.dataset.paragraph = line.dataset.paragraph;
  entry.append(document.createElement('br'));
  list.append(entry);
  // This single native edit restores the literal dash on Command-Z.
  document.execCommand('insertHTML', false, list.outerHTML);
}
