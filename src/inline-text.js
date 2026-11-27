import { measureTextElement } from './text.js';
import { editableParagraphs, applyParagraphs, convertDash } from './bullets.js';
// Keep native selection and IME on the glyphs in the transformed slide.
function linesOf(input) {
  const lines = [...input.querySelectorAll('div,p,li')].filter(
    (line) => !line.querySelector('div,p,li')
  );
  return lines.length ? lines : [input];
}

function textNodes(line) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.length) nodes.push(walker.currentNode);
  }
  return nodes;
}

function edge(line, atEnd) {
  const nodes = textNodes(line);
  if (!nodes.length)
    return [line.querySelector('span > br')?.parentElement || line, 0];
  return atEnd ? [nodes.at(-1), nodes.at(-1).length] : [nodes[0], 0];
}

function caretAt(input, event) {
  const doc = input.ownerDocument;
  const selection = doc.getSelection();
  if (event) {
    const { clientX: x, clientY: y } = event;
    const hit = doc.caretPositionFromPoint?.(x, y);
    const range = hit ? null : doc.caretRangeFromPoint?.(x, y);
    const node = hit?.offsetNode || range?.startContainer;
    if (node?.nodeType === Node.TEXT_NODE && input.contains(node)) {
      selection.collapse(node, hit?.offset ?? range.startOffset);
      return;
    }
  }
  const lines = linesOf(input);
  if (!event) {
    selection.collapse(...edge(lines.at(-1), true));
    return;
  }
  // A click in a box's padding can hit a flex container or bullet marker.
  // Place the insertion point inside the nearest glyph run so its size and
  // typeface apply to the caret and to the next characters the user types.
  const distance = (line) => {
    const r = line.getBoundingClientRect();
    return Math.max(0, r.top - event.clientY, event.clientY - r.bottom);
  };
  const line = lines.reduce((a, b) => (distance(a) <= distance(b) ? a : b));
  const first = edge(line, false);
  const last = edge(line, true);
  const distanceTo = ([node, offset]) => {
    const r = doc.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    return Math.hypot(
      event.clientX - rect.x,
      event.clientY - (rect.top + rect.height / 2)
    );
  };
  selection.collapse(...(distanceTo(first) <= distanceTo(last) ? first : last));
}

function bookmarkPosition(lines, node, offset) {
  let index = lines.findIndex((line) => line.contains(node));
  if (index < 0) {
    const after = node.childNodes[offset];
    index = lines.findIndex((line) => after?.contains(line));
    return index < 0
      ? { index: lines.length - 1, offset: Infinity }
      : { index, offset: 0 };
  }
  const r = document.createRange();
  r.selectNodeContents(lines[index]);
  r.setEnd(node, offset);
  // A native soft break becomes a newline in a rendered text run.
  const part = r.cloneContents();
  return {
    index,
    offset: part.textContent.length + part.querySelectorAll('br').length,
    atRunStart: offset === 0,
  };
}

function restorePosition(lines, mark) {
  const line = lines[Math.min(mark.index, lines.length - 1)];
  let offset = mark.offset;
  for (const node of textNodes(line)) {
    if (offset < node.length || (offset === node.length && !mark.atRunStart))
      return [node, offset];
    offset -= node.length;
  }
  return edge(line, true);
}

export function inlineText({ item, object, event, finish, onInput, toLocal }) {
  const input = item.querySelector(':scope>.item-text');
  if (!input) return null;
  const controller = new AbortController(),
    options = { signal: controller.signal };
  item.classList.add('editing-text');
  input.setAttribute('role', 'textbox');
  input.setAttribute('aria-label', 'Slide text');
  input.setAttribute('aria-multiline', 'true');
  input.contentEditable = 'true';
  input.spellcheck = false;
  input.classList.add('text-edit');
  let composing = false,
    deferBlur = false,
    touched = false,
    bookmark;
  if (!object.paragraphs && object.text.includes('\n')) {
    input.replaceChildren(
      ...object.text.split('\n').map((value) => {
        const p = document.createElement('div');
        if (value) p.textContent = value;
        else p.append(document.createElement('br'));
        return p;
      })
    );
  }
  if (!input.firstChild) input.append(document.createElement('div'));
  if (input.firstElementChild && !input.firstElementChild.childNodes.length)
    input.firstElementChild.append(document.createElement('br'));
  // WebKit caches the preferred width of the active contenteditable during
  // typing. Measure fresh layout without disturbing its caret or IME range.
  const intrinsicSize = () => measureTextElement(input.cloneNode(true));
  const initial = object.autoWidth && intrinsicSize();
  // Imported AutoFit frames may have authored space around the glyphs.
  const extraWidth =
    object.source != null && initial ? object.w - initial.w : 0;
  const extraHeight =
    object.source != null && initial ? object.h - initial.h : 0;
  function adjust() {
    if (!initial || !touched) return;
    const size = intrinsicSize();
    item.style.width = Math.max(2, size.w + extraWidth) + 'px';
    item.style.height = Math.max(1, size.h + extraHeight) + 'px';
  }
  function indentSelection(direction) {
    const sel = document.getSelection();
    if (
      !sel.rangeCount ||
      !input.contains(sel.anchorNode) ||
      !input.contains(sel.focusNode)
    )
      return;
    const mark = remember();
    if (linesOf(input)[0] === input) {
      const line = document.createElement('div');
      line.append(...input.childNodes);
      input.append(line);
    }
    const lines = linesOf(input);
    const rows = editableParagraphs(input, object);
    const [first, last] = [...mark].sort(
      (a, b) => a.index - b.index || a.offset - b.offset
    );
    const end =
      last.index > first.index && !last.offset ? last.index - 1 : last.index;
    for (let i = first.index; i <= end; i++) {
      const line = lines[i],
        row = rows[i];
      const level = Math.max(0, Math.min(8, row.level + direction));
      if (row.level === level && (direction > 0 || row.bullet || !row.margin))
        continue;
      const margin = Math.max(0, row.margin + direction * object.size * 1.5);
      line.dataset.level = level;
      line.dataset.margin = margin;
      if (row.bullet) {
        line.style.setProperty('--bullet-margin', margin + 'px');
        line.style.setProperty('--bullet-position', margin + row.indent + 'px');
      } else line.style.paddingLeft = margin + 'px';
      touched = true;
    }
    if (touched) {
      adjust();
      onInput();
    }
    sel.setBaseAndExtent(
      ...restorePosition(lines, mark[0]),
      ...restorePosition(lines, mark[1])
    );
    paintCaret();
  }

  // A native editing caret can span WebKit's entire line box. Keep the
  // selection and IME native and paint the insertion mark at the run's size.
  const caret = document.createElement('i');
  caret.className = 'glyph-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  item.append(caret);
  function paintCaret() {
    const sel = document.getSelection();
    caret.hidden = true;
    input.classList.remove('glyph-caret-active');
    if (
      composing ||
      document.activeElement !== input ||
      !sel.isCollapsed ||
      !sel.rangeCount ||
      !input.contains(sel.anchorNode)
    )
      return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const run = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const style = getComputedStyle(run);
    const size = parseFloat(style.fontSize);
    if (!(parseFloat(style.lineHeight) > size * 1.25)) return;
    let rect = range.getBoundingClientRect();
    if (!rect.height) {
      const br = run.querySelector('br');
      if (!br) return;
      rect = br.getBoundingClientRect();
    }
    if (!rect.height) return;
    const center = toLocal({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    Object.assign(caret.style, {
      left: center.x + 'px',
      top: center.y - size / 2 + 'px',
      height: size + 'px',
      backgroundColor: style.color,
    });
    caret.hidden = false;
    input.classList.add('glyph-caret-active');
  }
  document.addEventListener('selectionchange', paintCaret, options);
  input.addEventListener(
    'beforeinput',
    (e) => {
      if (!composing) convertDash(e, input, object);
    },
    options
  );
  input.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      paintCaret();
    },
    options
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
      adjust();
      paintCaret();
      onInput();
      if (deferBlur) {
        deferBlur = false;
        queueMicrotask(() => {
          if (!controller.signal.aborted) finish(false, true);
        });
      }
    },
    options
  );
  input.addEventListener(
    'input',
    () => {
      touched = true;
      adjust();
      paintCaret();
      onInput();
    },
    options
  );
  input.addEventListener(
    'paste',
    (e) => {
      e.preventDefault();
      document.execCommand(
        'insertText',
        false,
        e.clipboardData?.getData('text/plain') || ''
      );
    },
    options
  );
  input.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || composing || e.keyCode === 229) return;
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        indentSelection(e.shiftKey ? -1 : 1);
        return;
      }
      if (
        e.key === 'Escape' ||
        ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
      ) {
        e.preventDefault();
        e.stopPropagation();
        finish(e.key === 'Escape', false);
      }
    },
    options
  );
  function remember() {
    const sel = document.getSelection();
    if (
      !sel.rangeCount ||
      !input.contains(sel.anchorNode) ||
      !input.contains(sel.focusNode)
    )
      return bookmark;
    const lines = linesOf(input);
    bookmark = [
      bookmarkPosition(lines, sel.anchorNode, sel.anchorOffset),
      bookmarkPosition(lines, sel.focusNode, sel.focusOffset),
    ];
    return bookmark;
  }
  document.addEventListener('selectionchange', remember, options);
  input.addEventListener(
    'blur',
    (e) => {
      caret.hidden = true;
      if (e.relatedTarget?.closest('#properties,dialog')) {
        remember();
        return;
      }
      if (composing) {
        deferBlur = true;
        return;
      }
      // The inspector can change typography while this text is selected.
      if (!controller.signal.aborted) finish(false, true);
    },
    options
  );
  input.focus({ preventScroll: true });
  caretAt(input, event);
  paintCaret();
  return {
    o: object,
    input,
    read: () =>
      touched
        ? editableParagraphs(input, object)
            .map((p) => p.text)
            .join('\n')
        : object.text,
    changed() {
      if (!touched) return false;
      const rows = editableParagraphs(input, object);
      return (
        rows.map((p) => p.text).join('\n') !== object.text ||
        rows.some((p, i) => {
          const prior = object.paragraphs?.[i];
          return (
            p.bullet !== (prior?.bullet || '') ||
            p.level !== (prior?.level || 0) ||
            p.margin !== (prior?.margin || 0)
          );
        })
      );
    },
    apply() {
      if (touched) applyParagraphs(object, editableParagraphs(input, object));
    },
    remember,
    restore(mark) {
      if (!mark) return;
      const lines = linesOf(input);
      document
        .getSelection()
        .setBaseAndExtent(
          ...restorePosition(lines, mark[0]),
          ...restorePosition(lines, mark[1])
        );
    },
    size() {
      adjust();
      return {
        w: parseFloat(item.style.width),
        h: parseFloat(item.style.height),
      };
    },
    get composing() {
      return composing;
    },
    close() {
      controller.abort();
      caret.remove();
      input.classList.remove('glyph-caret-active');
      input.removeAttribute('contenteditable');
      input.removeAttribute('role');
      input.removeAttribute('aria-label');
      input.removeAttribute('aria-multiline');
      input.classList.remove('text-edit');
      item.classList.remove('editing-text');
      const selection = document.getSelection();
      if (input.contains(selection.anchorNode)) selection.removeAllRanges();
    },
  };
}
