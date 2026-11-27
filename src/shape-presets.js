const point = (x, y) => ({ x, y });
const kappa = (4 * (Math.sqrt(2) - 1)) / 3;

export const calloutPresets = {
  ellipse: 'wedgeEllipseCallout',
  rect: 'wedgeRectCallout',
  roundRect: 'wedgeRoundRectCallout',
};

// DrawingML measures the radius as a fraction of the shorter side.
export const cornerPercent = (o) =>
  Math.max(
    0,
    Math.min(
      50,
      o.cornerRadius ??
        (o.kind === 'roundRect' || o.calloutShape === 'roundRect' ? 16.667 : 0)
    )
  );

function rectangleNodes(o, rounded) {
  const radius = rounded ? (Math.min(o.w, o.h) * cornerPercent(o)) / 100 : 0;
  if (!radius && o.kind !== 'callout')
    return [point(0, 0), point(1000, 0), point(1000, 1000), point(0, 1000)];
  const rx = (1000 * radius) / (o.w || 1),
    ry = (1000 * radius) / (o.h || 1);
  const corners = [
    [point(rx, 0), point(1000 - rx, 0)],
    [point(1000, ry), point(1000, 1000 - ry)],
    [point(1000 - rx, 1000), point(rx, 1000)],
    [point(0, 1000 - ry), point(0, ry)],
  ];
  if (radius) {
    const vertices = [
      point(1000, 0),
      point(1000, 1000),
      point(0, 1000),
      point(0, 0),
    ];
    corners.forEach((edge, i) => {
      const end = edge[1],
        start = corners[(i + 1) % 4][0],
        c = vertices[i];
      end.out = point(
        end.x + kappa * (c.x - end.x),
        end.y + kappa * (c.y - end.y)
      );
      start.in = point(
        start.x + kappa * (c.x - start.x),
        start.y + kappa * (c.y - start.y)
      );
    });
  }
  if (o.kind === 'callout') {
    const { x, y } = calloutTip(o);
    const horizontalEdge = Math.abs(y - 500) > Math.abs(x - 500);
    const edge = horizontalEdge ? (y < 500 ? 0 : 2) : x <= 500 ? 3 : 1;
    const low = (((horizontalEdge ? x : y) > 500 ? 7 : 2) * 1000) / 12;
    const high = low + 250;
    const bases = [
      [point(low, 0), point(high, 0)],
      [point(1000, low), point(1000, high)],
      [point(high, 1000), point(low, 1000)],
      [point(0, high), point(0, low)],
    ];
    corners[edge].splice(1, 0, bases[edge][0], point(x, y), bases[edge][1]);
  }
  // With square corners the end of each edge is the next edge's start.
  return corners.flatMap((edge) => (radius ? edge : edge.slice(0, -1)));
}

// Coordinates use the DrawingML adjustment handles, relative to the center.
export function calloutTip(o) {
  return point(
    500 + (o.calloutX ?? -20833) / 100,
    500 + (o.calloutY ?? 62500) / 100
  );
}

function ellipseCalloutNodes(o) {
  const tip = calloutTip(o);
  const direction = Math.atan2(tip.y - 500, tip.x - 500);
  const halfMouth = (11 * Math.PI) / 180;
  const startAngle = direction + halfMouth;
  const step = (2 * Math.PI - 2 * halfMouth) / 4;
  const tangent = (4 / 3) * Math.tan(step / 4) * 500;
  const nodes = [tip];
  for (let i = 0; i <= 4; i++) {
    const angle = startAngle + i * step,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const p = point(500 + 500 * c, 500 + 500 * s);
    if (i) p.in = point(p.x + s * tangent, p.y - c * tangent);
    if (i < 4) p.out = point(p.x - s * tangent, p.y + c * tangent);
    nodes.push(p);
  }
  return nodes;
}

export function presetContour(o) {
  const ellipse =
    o.kind === 'callout' && (o.calloutShape || 'ellipse') === 'ellipse';
  return {
    closed: true,
    nodes: ellipse
      ? ellipseCalloutNodes(o)
      : rectangleNodes(
          o,
          o.kind !== 'callout' || o.calloutShape === 'roundRect'
        ),
  };
}

export function presetTextInset(o) {
  if (o.kind === 'callout' && (o.calloutShape || 'ellipse') === 'ellipse') {
    const inset = (1 - Math.SQRT1_2) / 2;
    return [o.w * inset, o.h * inset];
  }
  if (!(
    o.kind === 'rect' ||
    o.kind === 'roundRect' ||
    (o.kind === 'callout' && o.calloutShape === 'roundRect')
  ))
    return [0, 0];
  const cornerInset =
    ((Math.min(o.w, o.h) * cornerPercent(o)) / 100) * (1 - Math.SQRT1_2);
  return [cornerInset, cornerInset];
}
