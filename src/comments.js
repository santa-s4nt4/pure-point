import { el, icon } from './view.js';
import { uid } from './model.js';
export function renderComments(
  container,
  slide,
  { add, remove, focusPin, setPinMode, pinning, draft, onDraft }
) {
  container.replaceChildren();
  const section = el('section', 'section comments-panel'),
    head = el('div', 'section-heading'),
    title = el('h3');
  title.textContent = 'Slide comments';
  head.append(title);
  const locate = el('button', 'icon-btn' + (pinning ? ' on' : ''));
  locate.innerHTML = icon('comment', 16);
  locate.title = 'Place a comment pin';
  locate.setAttribute('aria-label', locate.title);
  locate.onclick = setPinMode;
  head.append(locate);
  section.append(head);
  const comments = slide.comments || [];
  if (!comments.length) {
    const n = el('p', 'empty-msg');
    n.textContent = 'No comments on this slide.';
    section.append(n);
  }
  comments.forEach((c, i) => {
    const card = el('article', 'comment-card'),
      top = el('div', 'comment-head'),
      jump = el('button', 'comment-number');
    jump.textContent = i + 1;
    jump.title = 'Locate comment';
    jump.onclick = () => focusPin(c);
    const author = el('strong');
    author.textContent = c.author || 'You';
    const date = el('time');
    if (!Number.isNaN(Date.parse(c.createdAt)))
      date.textContent = new Date(c.createdAt).toLocaleDateString('en', {
        month: 'short',
        day: 'numeric',
      });
    const del = el('button', 'icon-btn');
    del.innerHTML = icon('delete', 13);
    del.title = 'Delete comment';
    del.setAttribute('aria-label', del.title);
    del.onclick = () => remove(c);
    const body = el('p');
    body.textContent = c.text;
    top.append(jump, author, date, del);
    card.append(top, body);
    section.append(card);
  });
  const form = el('form', 'comment-form'),
    input = el('textarea');
  input.placeholder = pinning
    ? 'Click the slide to position your comment…'
    : 'Add a comment…';
  input.setAttribute('aria-label', 'Comment');
  input.required = true;
  input.value = draft || '';
  input.oninput = () => onDraft?.(input.value);
  input.rows = 3;
  input.maxLength = 32000;
  const button = el('button', 'top-action primary');
  button.textContent = 'Post';
  button.type = 'submit';
  form.append(input, button);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (input.value.trim())
      add({
        id: uid(),
        text: input.value.trim(),
        author: 'You',
        createdAt: new Date().toISOString(),
      });
  };
  input.onkeydown = (e) => {
    if (!e.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter')
      form.requestSubmit();
  };
  section.append(form);
  container.append(section);
}
