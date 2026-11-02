import { expect, it } from "vitest";
import { LOGO_BODY_PATH, LOGO_SNOW_PATH } from "./logo-avatar-art.js";

type Point = [number, number];
type Segment = [Point, Point, Point, Point];

it("keeps the mountain contour tangent-smooth and the peak a broad dome", () => {
  const numbers = (part: string) => [...part.matchAll(/-?\d+(?:\.\d+)?/g)].map(([n]) => Number(n));
  const point = (values: number[], offset = 0): Point => [
    values[offset] ?? NaN,
    values[offset + 1] ?? NaN,
  ];
  let start = point(numbers(LOGO_BODY_PATH.split("C")[0] ?? ""));
  const segments = [...LOGO_BODY_PATH.matchAll(/C([^CLHZ]+)/g)].map<Segment>(([, part]) => {
    const values = numbers(part ?? "");
    const points: Segment = [start, point(values), point(values, 2), point(values, 4)];
    start = points[3];
    return points;
  });
  expect(segments.length).toBeLessThanOrEqual(12);
  expect(LOGO_SNOW_PATH.startsWith("M")).toBe(true);
  for (const [index, segment] of segments.entries()) {
    for (const p of segment) expect(p.every(Number.isFinite)).toBe(true);
    const previous = segments[(index + segments.length - 1) % segments.length];
    if (!previous) continue;
    const [, , c, d] = previous;
    const [e, f] = segment;
    const incoming = [d[0] - c[0], d[1] - c[1]] as const;
    const outgoing = [f[0] - e[0], f[1] - e[1]] as const;
    const incomingLen = Math.hypot(incoming[0], incoming[1]);
    const outgoingLen = Math.hypot(outgoing[0], outgoing[1]);
    expect(incomingLen).toBeGreaterThan(0);
    expect(outgoingLen).toBeGreaterThan(0);
    const alignment =
      (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (incomingLen * outgoingLen);
    // Rounding the cubics must not leave a visible corner.
    expect(alignment).toBeGreaterThan(0.999);
  }
  // The dome is the only part of the contour that sits entirely in the crown.
  // The straight sides run down from it, so a y cutoff would include them too.
  const crown = segments.filter((segment) => segment.every((p) => p[1] < 8));
  expect(crown.length).toBeGreaterThan(0);
  for (const [a, b, c, d] of crown)
    for (let step = 0; step <= 50; step++) {
      const t = step / 50;
      const velocity = (i: 0 | 1) =>
        3 * (1 - t) ** 2 * (b[i] - a[i]) +
        6 * (1 - t) * t * (c[i] - b[i]) +
        3 * t ** 2 * (d[i] - c[i]);
      const acceleration = (i: 0 | 1) =>
        6 * (1 - t) * (c[i] - 2 * b[i] + a[i]) + 6 * t * (d[i] - 2 * c[i] + b[i]);
      const curvature =
        (velocity(0) * acceleration(1) - velocity(1) * acceleration(0)) /
        Math.hypot(velocity(0), velocity(1)) ** 3;
      // The agreed peak is a short dome, not a point and not a flat top.
      expect(curvature).toBeGreaterThan(0.12);
      expect(curvature).toBeLessThan(0.26);
    }
});
