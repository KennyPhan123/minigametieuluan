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
 assert(m.stats.deadEnds>=10); assert(m.stats.cycles>0); deadEnds+=m.stats.deadEnds;
 const spawn=positions.spawn;
 const entry=queue.find(([x,y])=>x===Math.floor(spawn.x)&&y===Math.floor(spawn.y));
 assert(entry,'shared spawn connects to random treasure');
 assert(entry[2]>=30 && entry[2]<=70,'route distance is bounded for one-minute rounds');
 assert.equal(entry[2],positions.routeLength);
 assert(Math.hypot(spawn.x-center.x,spawn.y-center.y)>=12,'far apart spatially');
 maxDistance=Math.max(maxDistance,entry[2]);
 for(let i=0;i<m.W;i++)assert(m.grid[0][i]&&m.grid[m.H-1][i]);
}
assert(spawnLocations.size>30 && treasureLocations.size>30,'positions vary across seeds');
console.log('maze OK: 200 seeds, max shortest route',maxDistance,'tiles =', (maxDistance/5.5).toFixed(1),'seconds moving; average dead ends',deadEnds/200);
