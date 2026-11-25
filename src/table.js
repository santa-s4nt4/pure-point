import { attr, child, children } from './xml.js';
export function readTable(table, theme, readColor, readStyle) {
  const cols = children(child(table, 'tblGrid'), 'gridCol').map((c) =>
    Number(attr(c, 'w', 1))
  );
  const rows = children(table, 'tr').map((row) => ({
    height: Number(attr(row, 'h', 1)),
    cells: children(row, 'tc').map((cell) => {
      const props = child(cell, 'tcPr'),
        body = child(cell, 'txBody'),
        bp = child(body, 'bodyPr');
      const paragraphs = children(body, 'p').map((p) => {
        const pp = child(p, 'pPr');
        const base = readStyle(
          child(pp, 'defRPr'),
          {
            font: theme.minor,
            size: 16,
            bold: false,
            italic: false,
            color: '#222222',
          },
          theme
        );
        return {
          align: { ctr: 'center', r: 'right' }[attr(pp, 'algn')] || 'left',
          runs: children(p)
            .filter((r) => ['r', 'fld', 'br'].includes(r.localName))
            .map((r) => ({
              ...readStyle(child(r, 'rPr'), base, theme),
              text:
                r.localName === 'br' ? '\n' : child(r, 't')?.textContent || '',
            })),
        };
      });
      return {
        skip:
          ['1', 'true'].includes(attr(cell, 'hMerge')) ||
          ['1', 'true'].includes(attr(cell, 'vMerge')),
        spanX: Number(attr(cell, 'gridSpan', 1)),
        spanY: Number(attr(cell, 'rowSpan', 1)),
        paragraphs,
        fill: readColor(child(props, 'solidFill'), theme),
        align: attr(props, 'anchor', attr(bp, 'anchor', 'ctr')),
        insets: ['marL', 'marT', 'marR', 'marB'].map(
          (key, i) =>
            Number(attr(props, key, [91440, 45720, 91440, 45720][i])) / 12700
        ),
      };
    }),
  }));
  return { cols, rows };
}
export function tableNode(o, typeStyle, el) {
  const n = el('div', 'ppt-table'),
    { cols, rows } = o.table;
  Object.assign(n.style, {
    gridTemplateColumns: cols.map((v) => v + 'fr').join(' '),
    gridTemplateRows: rows.map((r) => r.height + 'fr').join(' '),
  });
  rows.forEach((row, i) =>
    row.cells.forEach((c, j) => {
      if (c.skip) return;
      const cell = el('div', 'ppt-cell'),
        [l, t, r, b] = c.insets;
      Object.assign(cell.style, {
        gridColumn: j + 1 + ' / span ' + c.spanX,
        gridRow: i + 1 + ' / span ' + c.spanY,
        background: c.fill || '#ffffff',
        padding: `${t}px ${r}px ${b}px ${l}px`,
        justifyContent:
          { ctr: 'center', b: 'flex-end' }[c.align] || 'flex-start',
      });
      for (const p of c.paragraphs) {
        const line = el('div');
        line.style.textAlign = p.align;
        for (const run of p.runs) {
          const span = el('span');
          typeStyle(span, run);
          span.textContent = run.text;
          line.append(span);
        }
        cell.append(line);
      }
      n.append(cell);
    })
  );
  return n;
}
