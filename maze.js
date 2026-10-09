'use strict';

/* Maze generation: randomized Prim (branchy, lots of dead ends) plus light
 * braiding (open a fraction of dead ends => loops, multiple routes).
 * The result is NOT a single-winding-path maze: many branches, many cul-de-sacs.
 */

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

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Wall tile index between two adjacent cells (cell grid coords). */
function carveBetween(grid, ca, ra, cb, rb) {
  if (ra === rb) {
    grid[2 * ra + 1][Math.min(ca, cb) * 2 + 2] = 0;
  } else {
    grid[Math.min(ra, rb) * 2 + 2][2 * ca + 1] = 0;
  }
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Generate a branchy maze.
 * Returns { grid, W, H, stats: { deadEnds, braided, cycles } }.
 * grid[y][x] = 1 wall / 0 passage. Cell (c,r) center tile = (2c+1, 2r+1).
 */
function generateMaze(cols, rows, rng) {
  const W = cols * 2 + 1;
  const H = rows * 2 + 1;
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill(1));

  const visited = [];
  for (let r = 0; r < rows; r++) visited.push(new Array(cols).fill(false));

  // --- randomized Prim: bushy tree with many short branches ---
  const startC = Math.floor(rng() * cols);
  const startR = Math.floor(rng() * rows);
  visited[startR][startC] = true;
  grid[2 * startR + 1][2 * startC + 1] = 0;

  const frontier = [];
  const addEdges = (c, r) => {
    for (const [dc, dr] of DIRS4) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc]) {
        frontier.push([c, r, nc, nr]);
      }
    }
  };
  addEdges(startC, startR);

  while (frontier.length) {
    const i = Math.floor(rng() * frontier.length);
    const edge = frontier[i];
    frontier[i] = frontier[frontier.length - 1];
    frontier.pop();
    const [ca, ra, cb, rb] = edge;
    if (visited[rb][cb]) continue;
    carveBetween(grid, ca, ra, cb, rb);
    grid[2 * rb + 1][2 * cb + 1] = 0;
    visited[rb][cb] = true;
    addEdges(cb, rb);
  }

  // --- braid: open one wall of a fraction of dead ends => loops ---
  const isOpenSide = (c, r, nc, nr) => {
    // wall tile between cell (c,r) and neighbour (nc,nr)
    if (nr === r) return grid[2 * r + 1][Math.min(c, nc) * 2 + 2] === 0;
    return grid[Math.min(r, nr) * 2 + 2][2 * c + 1] === 0;
  };
  const cellNeighbors = (c, r) => {
    let open = 0;
    for (const [dc, dr] of DIRS4) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (isOpenSide(c, r, nc, nr)) open++;
    }
    return open;
  };

  const deadEnds = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellNeighbors(c, r) === 1) deadEnds.push([c, r]);
    }
  }

  shuffle(deadEnds, rng);
  const target = Math.max(2, Math.floor(deadEnds.length * 0.22));
  let braided = 0;
  for (const [c, r] of deadEnds) {
    if (braided >= target) break;
  const closed = [];
      for (const [dc, dr] of DIRS4) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        if (!isOpenSide(c, r, nc, nr)) closed.push([nc, nr]);
      }
    if (!closed.length) continue;
    const [nc, nr] = closed[Math.floor(rng() * closed.length)];
    carveBetween(grid, c, r, nc, nr);
    braided++;
  }

  // recount dead ends after braiding
  let deadEndsAfter = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellNeighbors(c, r) === 1) deadEndsAfter++;
    }
  }

  // passages = cell tiles (always open) + carved wall tiles (tree edges).
  // cycles = edges - (cells - 1); 0 for a perfect tree, >0 when braided.
  let carvedEdges = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === 0) carvedEdges++;
  carvedEdges -= cols * rows; // remove cell tiles
  const cycles = carvedEdges - (cols * rows - 1);

  return { grid, W, H, stats: { deadEnds: deadEndsAfter, braided, cycles } };
}

/** All cell centers on the border ring of the cell grid. */
function edgeCells(cols, rows) {
  const out = [];
  for (let c = 0; c < cols; c++) {
    out.push([c, 0]);
    if (rows > 1) out.push([c, rows - 1]);
  }
  for (let r = 1; r < rows - 1; r++) {
    out.push([0, r]);
    if (cols > 1) out.push([cols - 1, r]);
  }
  return out;
}

/** Tile-center coordinates of a cell. */
function cellCenter(c, r) {
  return { x: 2 * c + 1.5, y: 2 * r + 1.5 };
}

/** Convert tile-center coordinates to cell coords. */
function tileToCell(x, y) {
  return [Math.floor((x - 1.5) / 2 + 0.5), Math.floor((y - 1.5) / 2 + 0.5)];
}

module.exports = { mulberry32, shuffle, generateMaze, edgeCells, cellCenter, tileToCell };
