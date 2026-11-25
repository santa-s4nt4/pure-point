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
  if (!candidate) {
    range.selectNodeContents(input.lastElementChild || input);
    range.collapse(false);
  } else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function editableText(root) {
  // Browsers use a trailing <br> to support a caret in an empty block; it
  // isn't a second paragraph. Avoid innerText's layout-dependent flex breaks.
  function contents(node) {
    let text = '',
      previousBlock = false,
      started = false;
    const children = [...node.childNodes];
    for (const [i, child] of children.entries()) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (previousBlock) text += '\n';
        text += child.data;
        previousBlock = false;
        started = true;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === 'BR') {
        if (
          i < children.length - 1 ||
          (children.length === 1 && node === root && started)
        )
          text += '\n';
        previousBlock = false;
        started = true;
        continue;
      }
      const block = ['DIV', 'P'].includes(child.tagName);
      if (started && (previousBlock || block)) text += '\n';
      text += contents(child);
      started = true;
      previousBlock = block;
    }
    return text;
  }
  return contents(root).replace(/\u00a0/g, ' ');
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
    read: () => (touched ? editableText(input) : object.text),
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
