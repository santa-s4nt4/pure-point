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

export function inlineText({ item, object, event, finish, onInput }) {
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
  function intrinsicSize() {
    // Measure without changing the visible frame or its vertical alignment.
    const width = input.style.width,
      height = input.style.height;
    input.style.width = 'max-content';
    input.style.height = 'max-content';
    const style = getComputedStyle(input);
    const size = { w: parseFloat(style.width), h: parseFloat(style.height) };
    input.style.width = width;
    input.style.height = height;
    return size;
  }
  const initial = object.autoWidth && intrinsicSize();
  function adjust() {
    if (!initial || !touched) return;
    // Office's auto-fit box can include extra space around the text. Keep its
    // authored dimensions on entry and resize by the change caused by typing.
    const size = intrinsicSize();
    item.style.width = Math.max(2, object.w + size.w - initial.w) + 'px';
    item.style.height = Math.max(1, object.h + size.h - initial.h) + 'px';
  }
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
    },
    options
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
      adjust();
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
        rows.some((p, i) => p.bullet !== (object.paragraphs?.[i]?.bullet || ''))
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
