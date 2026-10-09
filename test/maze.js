'use strict';
const assert = require('assert');
const {generateMaze,mulberry32,pickRoundPositions} = require('../maze');
let maxDistance=0, deadEnds=0;
const spawnLocations=new Set(), treasureLocations=new Set();
for(let seed=1;seed<=200;seed++) {
 const m=generateMaze(15,11,mulberry32(seed));
 assert.equal(m.W,31); assert.equal(m.H,23);
 const positions=pickRoundPositions(m.grid,mulberry32(seed+999));
 const center=positions.treasure, x=Math.floor(center.x),y=Math.floor(center.y);
 spawnLocations.add(JSON.stringify(positions.spawn)); treasureLocations.add(JSON.stringify(center));
 const queue=[[x,y,0]],seen=new Set([`${x},${y}`]);
 for(let i=0;i<queue.length;i++) {const [x,y,d]=queue[i]; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
 const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
 if(m.grid[ny]?.[nx]===0&&!seen.has(k)){seen.add(k);queue.push([nx,ny,d+1]);}
 }}
 assert.equal(seen.size,m.grid.flat().filter(v=>v===0).length);
 let edges=0;
 for(let y=0;y<m.H;y++) for(let x=0;x<m.W;x++) if(m.grid[y][x]===0) {
   if(m.grid[y]?.[x+1]===0) edges++;
   if(m.grid[y+1]?.[x]===0) edges++;
 }
 assert.equal(edges,seen.size-1,'connected graph has no loops: exactly one route between any pair');
 assert(m.stats.deadEnds>=10); assert.equal(m.stats.cycles,0,'no alternate loops'); assert.equal(m.stats.braided,0); assert(positions.wrongBranches>=3); assert(positions.deepestTrap>=8); deadEnds+=m.stats.deadEnds;
 const spawn=positions.spawn;
 const entry=queue.find(([x,y])=>x===Math.floor(spawn.x)&&y===Math.floor(spawn.y));
 assert(entry,'shared spawn connects to random treasure');
 assert(entry[2]>=30 && entry[2]<=70,'route distance is bounded for one-minute rounds');
 assert.equal(entry[2],positions.routeLength);
 assert(Math.hypot(spawn.x-center.x,spawn.y-center.y)>=12,'far apart spatially');
 // Independently inspect off-route components: a wrong turn cannot reconnect.
 const ds=new Map(queue.map(([x,y,d])=>[`${x},${y}`,d]));
 let at=[Math.floor(spawn.x),Math.floor(spawn.y)];
 const path=[];
 while(true){path.push(at);const d=ds.get(at.join(','));if(d===0)break;
 at=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[at[0]+dx,at[1]+dy]).find(p=>ds.get(p.join(','))===d-1);}
 const pathSet=new Set(path.map(p=>p.join(',')));
 let substantial=0, deepest=0;
 for(const [x,y] of path.slice(0,-1)) for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
   const root=[x+dx,y+dy,1];
   if(m.grid[root[1]]?.[root[0]]!==0 || pathSet.has(root.slice(0,2).join(',')))continue;
   const visited=new Set(pathSet), branch=[root];let depth=0;
   visited.add(root.slice(0,2).join(','));
   for(let i=0;i<branch.length;i++){const [bx,by,d]=branch[i];depth=Math.max(depth,d);
     for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]) {const nx=bx+ox,ny=by+oy,k=`${nx},${ny}`;
       if(m.grid[ny]?.[nx]!==0 || visited.has(k))continue;
       visited.add(k);branch.push([nx,ny,d+1]);
     }
   }
   if(depth>=6)substantial++;deepest=Math.max(deepest,depth);
 }
 assert(substantial>=3,'route offers at least 3 wrong turns extending >=6 tiles');
 assert(deepest>=8,'at least one deeper trap');
 maxDistance=Math.max(maxDistance,entry[2]);
 for(let i=0;i<m.W;i++)assert(m.grid[0][i]&&m.grid[m.H-1][i]);
}
assert(spawnLocations.size>30 && treasureLocations.size>30,'positions vary across seeds');
console.log('maze OK: 200 seeds, max shortest route',maxDistance,'tiles =', (maxDistance/5.5).toFixed(1),'seconds moving; average dead ends',deadEnds/200);
