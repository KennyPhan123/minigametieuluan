'use strict';

/* Maze generation utilities shared by the server (and tests). */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Recursive-backtracker maze.
 * Returns { grid, W, H } where grid[y][x] is 1 for wall, 0 for passage.
 * Grid size is (cols*2+1) x (rows*2+1); cell (c,r) lives at grid[2r+1][2c+1].
 */
function generateMaze(cols, rows, rng) {
  const W = cols * 2 + 1;
  const H = rows * 2 + 1;
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill(1));

  const visited = [];
  for (let r = 0; r < rows; r++) visited.push(new Array(cols).fill(false));

  visited[0][0] = true;
  grid[1][1] = 0;
  const stack = [[0, 0]];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of dirs) {
      const nc = c + dx;
      const nr = r + dy;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc]) {
        options.push([nc, nr, dx, dy]);
      }
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nc, nr, dx, dy] = options[Math.floor(rng() * options.length)];
    grid[r * 2 + 1 + dy][c * 2 + 1 + dx] = 0; // knock down wall between
    grid[nr * 2 + 1][nc * 2 + 1] = 0;
    visited[nr][nc] = true;
    stack.push([nc, nr]);
  }
  return { grid, W, H };
}

/** BFS distances (in tiles) over passage tiles from (sx, sy). */
function bfsDistances(grid, sx, sy) {
  const H = grid.length;
  const W = grid[0].length;
  const dist = [];
  for (let y = 0; y < H; y++) dist.push(new Array(W).fill(-1));
  if (grid[sy][sx] !== 0) return dist;
  const queue = [[sx, sy]];
  dist[sy][sx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    const d = dist[y][x] + 1;
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && grid[ny][nx] === 0 && dist[ny][nx] < 0) {
        dist[ny][nx] = d;
        queue.push([nx, ny]);
      }
    }
  }
  return dist;
}

function countOpenNeighbors(grid, x, y) {
  let n = 0;
  const H = grid.length;
  const W = grid[0].length;
  const neighbors = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  for (const [nx, ny] of neighbors) {
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && grid[ny][nx] === 0) n++;
  }
  return n;
}

/**
 * Pick `count` treasure spots on passage tiles: prefer dead-ends ("corners"
 * of the maze) that are far from the start, spread apart with farthest-point
 * sampling. Returns [{ x, y, d }] with tile-center coordinates.
 */
function pickTreasures(grid, rng, count) {
  const H = grid.length;
  const W = grid[0].length;
  const dist = bfsDistances(grid, 1, 1);

  const open = [];
  let maxD = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] === 0) {
        const d = dist[y][x];
        if (d > maxD) maxD = d;
        open.push({ x, y, d });
      }
    }
  }

  const deadEnds = open.filter((t) => countOpenNeighbors(grid, t.x, t.y) === 1);
  const euclidFromStart = (t) => Math.hypot(t.x - 1, t.y - 1); // start tile is (1,1)

  // Progressive filters: prefer dead-ends that are far (BFS + euclidean) from start.
  const MIN_EUCLID = 8;
  let candidates = deadEnds.filter((t) => t.d >= maxD * 0.2 && euclidFromStart(t) >= MIN_EUCLID);
  if (candidates.length < count) candidates = deadEnds.filter((t) => t.d >= maxD * 0.2);
  if (candidates.length < count) candidates = open.filter((t) => t.d >= maxD * 0.2 && euclidFromStart(t) >= MIN_EUCLID);
  if (candidates.length < count) candidates = open.filter((t) => t.d >= maxD * 0.2);
  if (candidates.length < count) candidates = open.slice();

  // First spot: farthest dead-end (or farthest open tile) from the start,
  // preferring one that is also comfortably away in a straight line.
  const firstPool = deadEnds.length ? deadEnds : open;
  const firstFar = firstPool.filter((t) => euclidFromStart(t) >= MIN_EUCLID);
  const seedPool = firstFar.length ? firstFar : firstPool;
  let first = seedPool[0];
  for (const t of seedPool) if (t.d > first.d) first = t;

  const chosen = [first];
  const chosenIdx = new Set();
  const firstIdx = candidates.indexOf(first);
  if (firstIdx >= 0) chosenIdx.add(firstIdx);
  // minDist[i] = euclidean distance from candidates[i] to the nearest chosen spot
  const minDist = candidates.map((t) => Math.hypot(t.x - first.x, t.y - first.y));

  while (chosen.length < count) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (chosenIdx.has(i)) continue;
      // farthest-point sampling; BFS distance only breaks near-ties
      const score = minDist[i] * 10000 + candidates[i].d;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    chosenIdx.add(best);
    chosen.push(candidates[best]);
    for (let i = 0; i < candidates.length; i++) {
      const d = Math.hypot(candidates[i].x - candidates[best].x, candidates[i].y - candidates[best].y);
      if (d < minDist[i]) minDist[i] = d;
    }
  }

  return chosen.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5, d: t.d }));
}

module.exports = { mulberry32, generateMaze, bfsDistances, pickTreasures };
