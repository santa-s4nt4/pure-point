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
        const { font, size, bold, italic, color, align } = object;
        const base = { font, size, bold, italic, color };
        return { base, align, runs: [{ ...base, text: line }] };
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
