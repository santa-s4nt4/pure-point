// The system color panel can emit many change events during a single gesture.
export function chooseColor(label, initial, apply) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal color-dialog';
  dialog.innerHTML =
    '<form method="dialog"><h3></h3><div class="color-fields"><input type="color" aria-label="Pick color"><label>Hex<input type="text" aria-label="Hex color" maxlength="7" pattern="#?[0-9a-fA-F]{6}" required spellcheck="false"></label></div><div class="buttons"><button type="button" class="top-action">Cancel</button><button class="top-action primary" value="apply">Apply</button></div></form>';
  const picker = dialog.querySelector('[type=color]'),
    hex = dialog.querySelector('[type=text]');
  dialog.querySelector('h3').textContent = label;
  hex.value = picker.value = initial || '#ffffff';
  picker.oninput = picker.onchange = () => {
    hex.value = picker.value.toUpperCase();
  };
  hex.oninput = () => {
    if (hex.validity.valid) picker.value = '#' + hex.value.replace('#', '');
  };
  dialog.querySelector('[type=button]').onclick = () => dialog.close();
  dialog.onclose = () => {
    dialog.remove();
    if (dialog.returnValue === 'apply' && hex.validity.valid)
      apply(picker.value.toUpperCase());
  };
  document.body.append(dialog);
  dialog.showModal();
  hex.focus();
  hex.select();
}
