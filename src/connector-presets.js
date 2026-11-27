const point = (x, y) => ({ x, y });
const middle = (a, b) => point((a.x + b.x) / 2, (a.y + b.y) / 2);

// DrawingML connector routes. A cubic passes around each bend of the
// corresponding orthogonal route and meets its neighbor halfway between bends.
// Preset definitions: https://github.com/apache/poi/blob/REL_5_5_1/poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml
export function connectorContour(name, adjustments) {
  const open = (nodes) => ({ closed: false, fillMode: 'none', nodes });
  if (name === 'lineInv') return open([point(0, 1000), point(1000, 0)]);
  const x = (adjustments.adj1 ?? 50000) / 100;
  const y = (adjustments.adj2 ?? 50000) / 100;
  const lastX = (adjustments.adj3 ?? 50000) / 100;
  let bends;
  switch (name.slice(-1)) {
    case '2':
      bends = [point(1000, 0)];
      break;
    case '3':
      bends = [point(x, 0), point(x, 1000)];
      break;
    case '4':
      bends = [point(x, 0), point(x, y), point(1000, y)];
      break;
    case '5':
      bends = [point(x, 0), point(x, y), point(lastX, y), point(lastX, 1000)];
      break;
    default:
      return;
  }
  const nodes = [point(0, 0)];
  if (name.startsWith('bent'))
    return open([...nodes, ...bends, point(1000, 1000)]);
  bends.forEach((bend, i) => {
    const start = nodes.at(-1);
    const end = bends[i + 1] ? middle(bend, bends[i + 1]) : point(1000, 1000);
    start.out = middle(start, bend);
    end.in = middle(end, bend);
    nodes.push(end);
  });
  return open(nodes);
}
