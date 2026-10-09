'use strict';

/* Perfect maze: a connected tree, no loops or reconnecting wrong branches.
 * Growing-tree generation mixes depth-first runs with randomized branching.
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

  // Prefer extending the latest corridor, occasionally branch from an older cell.
  const startC = Math.floor(rng() * cols), startR = Math.floor(rng() * rows);
  const active = [[startC, startR]];
  visited[startR][startC] = true;
  grid[2 * startR + 1][2 * startC + 1] = 0;
  while (active.length) {
    const i = rng() < 0.7 ? active.length - 1 : Math.floor(rng() * active.length);
    const [c, r] = active[i];
    const neighbors = DIRS4.map(([dc,dr]) => [c+dc,r+dr]).filter(([nc,nr]) =>
      nc>=0 && nc<cols && nr>=0 && nr<rows && !visited[nr][nc]);
    if (!neighbors.length) { active.splice(i,1); continue; }
    const [nc,nr] = neighbors[Math.floor(rng()*neighbors.length)];
    carveBetween(grid,c,r,nc,nr);
    grid[2*nr+1][2*nc+1] = 0;
    visited[nr][nc] = true;
    active.push([nc,nr]);
  }

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

  let deadEndsAfter = 0;
  for (let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
    if(cellNeighbors(c,r)===1) deadEndsAfter++;
  }

  // passages = cell tiles (always open) + carved wall tiles (tree edges).
  // cycles = edges - (cells - 1); 0 for a perfect tree, >0 when braided.
  let carvedEdges = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === 0) carvedEdges++;
  carvedEdges -= cols * rows; // remove cell tiles
  const cycles = carvedEdges - (cols * rows - 1);

  return { grid, W, H, stats: { deadEnds: deadEndsAfter, braided: 0, cycles } };
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

/** Random shared start and treasure, separated spatially and by walkable route. */
function pickRoundPositions(grid, rng) {
  const cells = [];
  for (let y = 1; y < grid.length; y += 2)
    for (let x = 1; x < grid[0].length; x += 2)
      if (grid[y][x] === 0) cells.push({ x, y });
  for (const goal of shuffle(cells.slice(), rng)) {
    const distance = grid.map(row => row.map(() => -1));
    distance[goal.y][goal.x] = 0;
    const queue = [goal];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const [dx, dy] of DIRS4) {
        const x = p.x + dx, y = p.y + dy;
        if (grid[y]?.[x] !== 0 || distance[y][x] !== -1) continue;
        distance[y][x] = distance[p.y][p.x] + 1;
        queue.push({ x, y });
      }
    }
    const distant = cells.filter(p => Math.hypot(p.x-goal.x, p.y-goal.y) >= 12 &&
      distance[p.y][p.x] >= 30 && distance[p.y][p.x] <= 70);
    // Reject easy routes: require at least three substantial wrong turns.
    const choices = distant.map(start => {
      const path = [start];
      let current = start;
      while (distance[current.y][current.x] > 0) {
        current = DIRS4.map(([dx,dy]) => ({x:current.x+dx,y:current.y+dy}))
          .find(p => distance[p.y]?.[p.x] === distance[current.y][current.x]-1);
        path.push(current);
      }
      const pathKeys = new Set(path.map(p => p.x+','+p.y));
      let wrongBranches = 0, deepestTrap = 0;
      for (const p of path.slice(0,-1)) for (const [dx,dy] of DIRS4) {
        const branch = {x:p.x+dx,y:p.y+dy,d:1};
        if (grid[branch.y]?.[branch.x]!==0 || pathKeys.has(branch.x+','+branch.y)) continue;
        const seen = new Set(pathKeys), queue=[branch];
        seen.add(branch.x+','+branch.y);
        let depth=0;
        for (let i=0;i<queue.length;i++) {
          const b=queue[i]; depth=Math.max(depth,b.d);
          for (const [dx,dy] of DIRS4) {
            const x=b.x+dx,y=b.y+dy,key=x+','+y;
            if(grid[y]?.[x]!==0 || seen.has(key)) continue;
            seen.add(key); queue.push({x,y,d:b.d+1});
          }
        }
        if (depth>=6) wrongBranches++;
        deepestTrap=Math.max(deepestTrap,depth);
      }
      return {...start,wrongBranches,deepestTrap};
    }).filter(p=>p.wrongBranches>=3 && p.deepestTrap>=8);
    if (choices.length) {
      const start = choices[Math.floor(rng() * choices.length)];
      return { spawn: {x:start.x+0.5,y:start.y+0.5},
        treasure: {x:goal.x+0.5,y:goal.y+0.5}, routeLength:distance[start.y][start.x], wrongBranches:start.wrongBranches, deepestTrap:start.deepestTrap };
    }
  }
  throw new Error('Maze cannot provide sufficiently separated round positions');
}
module.exports.pickRoundPositions = pickRoundPositions;
