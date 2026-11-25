import { editableParagraphs, applyParagraphs, convertDash } from './bullets.js';
import { singleLine } from './text.js';
// Activate the actual rendered glyphs rather than painting an input over them.
// Using the canvas DOM also preserves nested group transforms and native IME.
function caretAt(input, event) {
  const selection = input.ownerDocument.getSelection();
  const range = input.ownerDocument.createRange();
  let candidate;
  if (event) {
    const { clientX: x, clientY: y } = event;
    const position = document.caretPositionFromPoint?.(x, y);
    if (position && input.contains(position.offsetNode)) {
      range.setStart(position.offsetNode, position.offset);
      candidate = true;
    } else {
      const located = document.caretRangeFromPoint?.(x, y);
      if (located && input.contains(located.startContainer)) {
        range.setStart(located.startContainer, located.startOffset);
        candidate = true;
      }
    }
  }
  const leaves = [...input.querySelectorAll('li,div,p')].filter(
    (n) => !n.querySelector('div,p,li')
  );
  const empty = !range.startContainer.textContent || !candidate;
  if (
    empty ||
    range.startContainer === input ||
    range.startContainer.tagName === 'UL'
  ) {
    const distance = (n) => {
      const r = n.getBoundingClientRect();
      return Math.max(0, r.top - event.clientY, event.clientY - r.bottom);
    };
    const line =
      (event
        ? leaves.sort((a, b) => distance(a) - distance(b))[0]
        : leaves.at(-1)) || input;
    range.selectNodeContents(line);
    if (!line.textContent) range.setStart(line, 0);
    range.collapse(!line.textContent);
  } else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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
  function adjust() {
    if (!object.autoWidth) return;
    // Intrinsic layout measures logical slide units independently of zoom.
    input.style.right = 'auto';
    input.style.bottom = 'auto';
    input.style.minWidth = '2px';
    input.style.width = 'max-content';
    input.style.height = 'auto';
    item.style.width = Math.max(2, input.offsetWidth) + 'px';
    item.style.height =
      Math.max(object.size * singleLine, input.offsetHeight) + 'px';
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
  input.addEventListener(
    'blur',
    (e) => {
      if (e.relatedTarget?.closest('#properties,dialog')) return;
      if (composing) {
        deferBlur = true;
        return;
      }
      // The inspector can change typography while this text is selected.
      if (!controller.signal.aborted) finish(false, true);
    },
    options
  );
  const observer = new ResizeObserver(adjust);
  if (object.autoWidth) observer.observe(input);
  adjust();
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
    remember() {
      const sel = document.getSelection();
      if (!sel.rangeCount || !input.contains(sel.anchorNode)) return bookmark;
      const start = sel.getRangeAt(0),
        r = document.createRange();
      r.selectNodeContents(input);
      r.setEnd(start.startContainer, start.startOffset);
      const a = r.toString().length;
      r.setEnd(start.endContainer, start.endOffset);
      bookmark = [a, r.toString().length];
      return bookmark;
    },
    restore(mark) {
      if (!mark) return;
      const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      if (!nodes.length) return;
      function locate(index) {
        for (const node of nodes) {
          if (index <= node.length) return [node, index];
          index -= node.length;
        }
        return [nodes.at(-1), nodes.at(-1).length];
      }
      const r = document.createRange();
      r.setStart(...locate(mark[0]));
      r.setEnd(...locate(mark[1]));
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
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
      observer.disconnect();
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
