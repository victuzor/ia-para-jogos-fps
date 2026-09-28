export const SIZE = 21;

const blocks = new Set();
for (let i = 0; i < SIZE; i++) {
  blocks.add(`${i},0`);
  blocks.add(`${i},${SIZE - 1}`);
  blocks.add(`0,${i}`);
  blocks.add(`${SIZE - 1},${i}`);
}

function wall(x, y) { blocks.add(`${x},${y}`); }
for (let y = 2; y <= 7; y++) if (y !== 5) wall(4, y);
for (let y = 3; y <= 10; y++) if (y !== 6) wall(8, y);
for (let y = 2; y <= 8; y++) if (y !== 4) wall(12, y);
for (let y = 4; y <= 10; y++) if (y !== 7) wall(16, y);
for (let x = 3; x <= 7; x++) if (x !== 5) wall(x, 12);
for (let x = 9; x <= 14; x++) if (x !== 11) wall(x, 13);
for (let x = 15; x <= 18; x++) if (x !== 17) wall(x, 15);
for (let y = 15; y <= 18; y++) if (y !== 17) wall(6, y);
for (let y = 16; y <= 18; y++) wall(12, y);

export function isWall(x, y) {
  return x < 0 || y < 0 || x >= SIZE || y >= SIZE || blocks.has(`${Math.floor(x)},${Math.floor(y)}`);
}

export function canOccupy(x, y, radius = 0.22) {
  for (const dx of [-radius, radius]) {
    for (const dy of [-radius, radius]) {
      if (isWall(x + dx, y + dy)) return false;
    }
  }
  return true;
}

export function moveWithCollision(entity, dx, dy) {
  if (canOccupy(entity.x + dx, entity.y)) entity.x += dx;
  if (canOccupy(entity.x, entity.y + dy)) entity.y += dy;
}

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function angleTo(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
export function angleDelta(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function clearLine(a, b) {
  const length = distance(a, b);
  const steps = Math.ceil(length / 0.04);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

export function rayWall(origin, angle, maxDistance = 30) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let cellX = Math.floor(origin.x);
  let cellY = Math.floor(origin.y);
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let sideX = dx < 0 ? (origin.x - cellX) * deltaX : (cellX + 1 - origin.x) * deltaX;
  let sideY = dy < 0 ? (origin.y - cellY) * deltaY : (cellY + 1 - origin.y) * deltaY;
  let side = 0;
  let traveled = 0;
  while (traveled < maxDistance) {
    if (sideX < sideY) {
      traveled = sideX;
      sideX += deltaX;
      cellX += stepX;
      side = 0;
    } else {
      traveled = sideY;
      sideY += deltaY;
      cellY += stepY;
      side = 1;
    }
    if (isWall(cellX, cellY)) return { distance: traveled, side, x: origin.x + dx * traveled, y: origin.y + dy * traveled };
  }
  return { distance: maxDistance, side, x: origin.x + dx * maxDistance, y: origin.y + dy * maxDistance };
}

export function findPath(from, to) {
  const start = [Math.floor(from.x), Math.floor(from.y)];
  const goal = [Math.floor(to.x), Math.floor(to.y)];
  if (isWall(...start) || isWall(...goal)) return [];
  const key = ([x, y]) => `${x},${y}`;
  const startKey = key(start);
  const goalKey = key(goal);
  if (startKey === goalKey) return [{ x: to.x, y: to.y }];
  const open = [{ point: start, score: 0 }];
  const cost = new Map([[startKey, 0]]);
  const previous = new Map();
  const seen = new Set();
  while (open.length) {
    open.sort((a, b) => a.score - b.score);
    const current = open.shift().point;
    const currentKey = key(current);
    if (seen.has(currentKey)) continue;
    if (currentKey === goalKey) {
      const points = [];
      let step = currentKey;
      while (step !== startKey) {
        const [x, y] = step.split(',').map(Number);
        points.push({ x: x + 0.5, y: y + 0.5 });
        step = previous.get(step);
      }
      points.reverse();
      points[points.length - 1] = { x: to.x, y: to.y };
      return points;
    }
    seen.add(currentKey);
    for (const next of [[current[0] + 1, current[1]], [current[0] - 1, current[1]], [current[0], current[1] + 1], [current[0], current[1] - 1]]) {
      if (isWall(...next)) continue;
      const nextKey = key(next);
      const nextCost = cost.get(currentKey) + 1;
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      open.push({ point: next, score: nextCost + Math.abs(next[0] - goal[0]) + Math.abs(next[1] - goal[1]) });
    }
  }
  return [];
}

export const PATROL = [
  { x: 18.5, y: 18.5 }, { x: 17.5, y: 11.5 },
  { x: 10.5, y: 10.5 }, { x: 3.5, y: 9.5 },
  { x: 2.5, y: 17.5 }, { x: 14.5, y: 18.5 },
];
