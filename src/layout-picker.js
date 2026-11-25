import { el, scene } from './view.js';

export function chooseLayout(options, deck, assets) {
  const dialog = el('dialog', 'layout-picker');
  dialog.setAttribute('aria-label', 'Choose slide layout');
  const heading = el('h2');
  heading.textContent = 'Choose a layout';
  const buttons = el('div', 'layout-options');
  dialog.append(heading, buttons);
  const observers = [];
  for (const { label, slide } of options) {
    const button = el('button'),
      thumb = el('div', 'layout-preview'),
      name = el('span');
    name.textContent = label;
    button.dataset.layout = label;
    const preview = scene(slide, deck, assets, true);
    thumb.setAttribute('aria-hidden', 'true');
    thumb.style.aspectRatio = String(deck.w / deck.h);
    thumb.append(preview);
    button.append(thumb, name);
    buttons.append(button);
    const observer = new ResizeObserver(() => {
      preview.style.transform = 'scale(' + thumb.clientWidth / deck.w + ')';
    });
    observer.observe(thumb);
    observers.push(observer);
    button.onclick = () => dialog.close(label);
  }
  const cancel = el('button', 'layout-cancel');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => dialog.close();
  dialog.append(cancel);
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        observers.forEach((o) => o.disconnect());
        resolve(options.find((o) => o.label === dialog.returnValue)?.slide);
        dialog.remove();
      },
      { once: true }
    )
  );
}
