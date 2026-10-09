'use strict';
const assert = require('assert');
const {generateMaze,mulberry32,cellCenter} = require('../maze');
let maxDistance=0, deadEnds=0;
for(let seed=1;seed<=200;seed++) {
 const m=generateMaze(15,11,mulberry32(seed));
 assert.equal(m.W,31); assert.equal(m.H,23);
 const center=cellCenter(7,0), x=Math.floor(center.x),y=Math.floor(center.y);
 const queue=[[x,y,0]],seen=new Set([`${x},${y}`]);
 for(let i=0;i<queue.length;i++) {const [x,y,d]=queue[i]; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
 const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
 if(m.grid[ny]?.[nx]===0&&!seen.has(k)){seen.add(k);queue.push([nx,ny,d+1]);}
 }}
 assert.equal(seen.size,m.grid.flat().filter(v=>v===0).length);
 assert(m.stats.deadEnds>=10); assert(m.stats.cycles>0); deadEnds+=m.stats.deadEnds;
 const spawn=cellCenter(7,10);
 const entry=queue.find(([x,y])=>x===Math.floor(spawn.x)&&y===Math.floor(spawn.y));
 assert(entry,'bottom entrance connects to top goal');
 assert.equal(spawn.x,center.x);
 assert(Math.hypot(spawn.x-center.x,spawn.y-center.y)>4.5,'goal hidden at spawn');
 maxDistance=Math.max(maxDistance,entry[2]);
 for(let i=0;i<m.W;i++)assert(m.grid[0][i]&&m.grid[m.H-1][i]);
}
console.log('maze OK: 200 seeds, max shortest route',maxDistance,'tiles =', (maxDistance/5.5).toFixed(1),'seconds moving; average dead ends',deadEnds/200);
