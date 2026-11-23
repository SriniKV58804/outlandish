export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }

export const origin: Point = { x: 0, y: 0 };
export function limitCamera(point: Point, viewport: Viewport): Point {
  const xLimit = Math.max(330, viewport.width * 0.45);
  const yLimit = Math.min(210, viewport.height * 0.25);
  return {
    x: Math.max(-xLimit, Math.min(xLimit, point.x)),
    y: Math.max(-yLimit, Math.min(yLimit, point.y)),
  };
}

// Each arrangement describes physical placement, shared by every topic assigned to that depth.
const groups = [
  { x: 0.014, y: 0.522, scale: 1.12 },
  { x: -0.338, y: 0.495, scale: 0.80 },
  { x: 0.337, y: 0.385, scale: 0.67 },
];

const fan = [
  { width: 1, depth: 1.10, layer: 8 },
  { width: 0.76, depth: 0.74, layer: 4 },
  { width: 0.69, depth: 0.58, layer: 2 },
  { width: 0.48, depth: 0.42, layer: 1 },
  { width: 0.49, depth: 0.45, layer: 1 },
];

// Secondary groups follow different arcs; their footprints stay recognizable after panning.
const arc = [
  [[0,.01,-6], [-.60,-.15,-15], [.66,-.17,11], [.99,.28,17], [-.90,.27,-10]],
  [[0,.01,7], [-.78,.11,-12], [.56,-.46,9], [.84,-.66,15], [-.96,.36,-16]],
  [[0,.01,-5], [-.69,-.40,-13], [.67,.15,11], [.98,.52,19], [-.93,-.61,-18]],
];

export function anchor(index: number, viewport: Viewport, count: number) {
  const group = groups[index % groups.length];
  const width = Math.max(740, viewport.width);
  const offset = count === 2 ? [0.12, -0.26][index] ?? group.x : group.x;
  const size = Math.min(217, Math.max(131, viewport.width * 0.138), viewport.height * 0.235);
  return {
    x: viewport.width * 0.5 + offset * width,
    y: viewport.height * group.y,
    size: size * group.scale,
    depth: group.scale,
  };
}

export function clipPlacement(topic: number, clip: number, count: number, viewport: Viewport, camera: Point, focusedIndex: number | null, centerClip: number, totalClips: number) {
  const group = anchor(topic, viewport, count);
  const card = fan[clip % fan.length];
  const active = topic === focusedIndex;
  const focused = focusedIndex !== null;
  const [offsetX, offsetY, angle] = arc[topic % arc.length][clip % fan.length];
  let offset = (clip - centerClip + totalClips) % totalClips;
  if (offset > totalClips / 2) offset -= totalClips;
  const focussedWidth = Math.min(245, viewport.height * 0.285, viewport.width * 0.36);
  const separation = viewport.width < 650 ? 0.88 : 1.03;
  const width = active ? focussedWidth * (offset === 0 ? 1 : 0.82) : group.size * card.width;
  const depth = group.depth * card.depth;
  const x = active
    ? viewport.width * 0.5 + offset * focussedWidth * separation
    : group.x + group.size * offsetX + camera.x * depth;
  const y = active
    ? viewport.height * 0.485 + (Math.abs(offset) % 2 ? -0.1 : 0.05) * focussedWidth
    : group.y + group.size * offsetY + camera.y * depth;
  return { x, y, width, depth, angle: active ? offset * 3.1 : angle,
    z: (active ? 100 + (offset === 0 ? 15 : 0) : focused ? 0 : (3 - topic) * 10) + card.layer };
}

export function cameraForTopic(index: number, viewport: Viewport, count: number): Point {
  const group = anchor(index, viewport, count);
  return limitCamera({ x: (viewport.width * 0.5 - group.x) / group.depth, y: (viewport.height * 0.49 - group.y) / group.depth }, viewport);
}
