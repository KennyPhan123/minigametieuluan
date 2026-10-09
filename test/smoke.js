'use strict';
const assert=require('assert');
const {spawn}=require('child_process');
const WebSocket=require('ws');
const Q=require('../public/questions');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let clients=[];
async function until(fn,label,timeout=5000){let start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw Error('timeout '+label);await sleep(10);}return fn();}
async function connect(name,port){const ws=new WebSocket(`ws://127.0.0.1:${port}`),inbox=[];clients.push(ws);ws.on('message',d=>inbox.push(JSON.parse(d)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});const c={ws,inbox,send:o=>ws.send(JSON.stringify(o)),get:(t)=>inbox.filter(m=>m.t===t).at(-1)};c.send({t:'join',name});c.init=await until(()=>c.get('init'),'init');return c;}
async function run(port,roundMs,fn){const proc=spawn(process.execPath,['server.js'],{cwd:require('path').join(__dirname,'..'),env:{...process.env,PORT:String(port),ROUND_MS:String(roundMs),FREEZE_MS:'120'},stdio:['ignore','pipe','pipe']});let log='';proc.stdout.on('data',d=>log+=d);proc.stderr.on('data',d=>log+=d);try{await until(()=>log.includes('server v2'),'boot');await fn(port);}catch(e){console.error(log);throw e;}finally{for(const ws of clients)ws.terminate();clients=[];proc.kill();await new Promise(r=>proc.once('exit',r));}}
function route(round){const g=round.maze,start=[Math.floor(round.spawn.x),Math.floor(round.spawn.y)],target=[Math.floor(round.treasure.x),Math.floor(round.treasure.y)],queue=[start],prev=new Map([[start.join(),null]]);for(let i=0;i<queue.length;i++){let [x,y]=queue[i];for(let [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){let n=[x+dx,y+dy];if(g[n[1]]?.[n[0]]==='.'&&!prev.has(n.join())){prev.set(n.join(),[x,y]);queue.push(n);}}}let r=[],at=target;while(at){r.unshift(at);at=prev.get(at.join());}return r;}
async function walk(c,round){let path=route(round);for(let i=1;i<path.length;i++){await sleep(160);const [x,y]=path[i];c.send({t:'state',x:x+.5,y:y+.5});}await sleep(20);c.send({t:'touch'});return until(()=>c.get('touchAck'),'touch');}
(async()=>{
 await run(3111,18000,async port=>{
  const host=await connect('Teacher',port);assert.equal(host.init.role,'host');const ps=[];for(let i=0;i<5;i++)ps.push(await connect('P'+i,port));
  ps[0].send({t:'host',action:'start'});await sleep(40);assert(!host.get('round'),'only host starts');host.send({t:'host',action:'start'});await until(()=>host.get('round'),'round');assert(!host.get('round').players.find(p=>p.id===host.init.id).spawned);
  const rounds=await Promise.all(ps.map(c=>until(()=>c.get('round'),'spawn')));
  for(const r of rounds){assert.deepEqual(r.spawn,rounds[0].spawn,'one shared spawn');assert.deepEqual(r.treasure,rounds[0].treasure,'one shared treasure');assert(Math.hypot(r.spawn.x-r.treasure.x,r.spawn.y-r.treasure.y)>=12);assert(route(r).length>=31 && route(r).length<=71);}
  ps[0].send({t:'state',x:rounds[0].treasure.x,y:rounds[0].treasure.y});ps[0].send({t:'touch'});assert.equal((await until(()=>ps[0].get('touchAck'),'invalid touch')).ok,false);ps[0].inbox=ps[0].inbox; // consume rejected ack
  ps[0].inbox.splice(ps[0].inbox.findIndex(m=>m.t==='touchAck'),1);
  const acks=await Promise.all(ps.map((c,i)=>walk(c,rounds[i])));assert(acks.every(a=>a.ok));assert.equal(acks.filter(a=>a.first).length,1);
  const first=acks.findIndex(a=>a.first);assert.equal(acks[first].eliminations.length,2);const other=acks.findIndex(a=>!a.first);assert.equal(acks[other].eliminations.length,0);
  const wrong=[0,1,2,3].find(i=>i!==Q[0].answer&&!acks[first].eliminations.includes(i));ps[first].send({t:'answer',idx:wrong});await until(()=>ps[first].get('wrong'),'wrong');ps[first].send({t:'answer',idx:Q[0].answer});await until(()=>ps[first].get('answerAck')?.reason==='frozen','freeze rejects');await sleep(140);
  ps[first].send({t:'answer',idx:Q[0].answer});await until(()=>ps[first].get('correct'),'correct');assert(!host.get('roundEnd'),'one correct does not end round');
  for(let i=0;i<5;i++)if(i!==first)ps[i].send({t:'answer',idx:Q[0].answer});const end=await until(()=>host.get('roundEnd'),'5 correct end');assert.equal(end.correctCount,5);assert.equal(end.phase,'review');assert.equal(end.leaderboard.length,5);
  host.send({t:'host',action:'next'});const second=await until(()=>host.get('round')?.round===2&&host.get('round'),'new maze');assert.notDeepEqual(second.maze,rounds[0].maze);const active=second.players.filter(p=>p.spawned);for(const player of active){assert.equal(player.x,active[0].x);assert.equal(player.y,active[0].y);assert(Math.hypot(player.x-second.treasure.x,player.y-second.treasure.y)>=12);}
  const late=await connect('Late',port);assert(!late.init.me.touched);assert(!late.init.players.find(p=>p.id===late.init.id).spawned,'late joins wait');
 });
 await run(3112,100,async port=>{
  const host=await connect('Teacher',port),p=await connect('Student',port);host.send({t:'host',action:'min',value:1});host.send({t:'host',action:'start'});
  for(let n=1;n<=10;n++){
   const end=await until(()=>host.get('roundEnd')?.round===n&&host.get('roundEnd'),'timeout round '+n);assert.equal(end.phase,'classroom');host.send({t:'host',action:'next'});await sleep(15);assert.equal(host.get('round').round,n,'must reveal first');host.send({t:'host',action:'reveal',value:0});await until(()=>host.inbox.filter(m=>m.t==='reveal').length===n,'reveal');host.send({t:'host',action:'next'});
  }
  const final=await until(()=>host.get('gameover'),'final');assert.equal(final.leaderboard.length,1);assert.equal(final.leaderboard[0].score,0);host.send({t:'host',action:'again'});await until(()=>host.get('room')?.phase==='lobby','reset');
 });
 console.log('server OK: roles, movement validation, first arrival, personal hints, freeze, five correct, new maze, late join, 10 rounds, reveal gating, final and reset');
})().catch(e=>{console.error(e);process.exitCode=1});
