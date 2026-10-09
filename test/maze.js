'use strict';

/* Maze invariants: connectivity, treasures on passages, spread. */

const assert = require('assert');
const { mulberry32, generateMaze, bfsDistances, pickTreasures } = require('../maze');

const COLS = 20;
const ROWS = 15;
const rng = mulberry32(123456789);
const { grid, W, H } = generateMaze(COLS, ROWS, rng);

assert.strictEqual(W, COLS * 2 + 1, 'grid width');
assert.strictEqual(H, ROWS * 2 + 1, 'grid height');

// border must be all walls
for (let x = 0; x < W; x++) {
  assert.strictEqual(grid[0][x], 1, 'top border wall');
  assert.strictEqual(grid[H - 1][x], 1, 'bottom border wall');
}
for (let y = 0; y < H; y++) {
  assert.strictEqual(grid[y][0], 1, 'left border wall');
  assert.strictEqual(grid[y][W - 1], 1, 'right border wall');
}

// start is open
assert.strictEqual(grid[1][1], 0, 'start tile open');

// full connectivity: BFS from start reaches every passage tile
const dist = bfsDistances(grid, 1, 1);
let openCount = 0;
let reached = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (grid[y][x] === 0) {
      openCount++;
      if (dist[y][x] >= 0) reached++;
    }
  }
}
assert.strictEqual(openCount, reached, `all passages reachable (${reached}/${openCount})`);
assert.ok(openCount >= COLS * ROWS, 'at least one passage per cell');

// every cell (odd, odd) must be a passage
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    assert.strictEqual(grid[r * 2 + 1][c * 2 + 1], 0, `cell ${c},${r} open`);
  }
}

// treasures
const treasures = pickTreasures(grid, rng, 10);
assert.strictEqual(treasures.length, 10, '10 treasures picked');

const seen = new Set();
for (const t of treasures) {
  const gx = Math.floor(t.x);
  const gy = Math.floor(t.y);
  assert.strictEqual(grid[gy][gx], 0, `treasure on passage at ${gx},${gy}`);
  const key = gx + ',' + gy;
  assert(!seen.has(key), 'treasure tiles unique');
  seen.add(key);
}

// pairwise spread: no two treasures adjacent
for (let i = 0; i < treasures.length; i++) {
  for (let j = i + 1; j < treasures.length; j++) {
    const d = Math.hypot(treasures[i].x - treasures[j].x, treasures[i].y - treasures[j].y);
    assert.ok(d >= 2, `treasures ${i} and ${j} too close: ${d.toFixed(2)}`);
  }
}

// far from start
const minStartDist = Math.min(
  ...treasures.map((t) => Math.hypot(t.x - 1.5, t.y - 1.5))
);
assert.ok(minStartDist >= 6, `treasures far from start (min=${minStartDist.toFixed(1)})`);

console.log('maze test OK:', { W, H, openCount, minStartDist: minStartDist.toFixed(1) });
