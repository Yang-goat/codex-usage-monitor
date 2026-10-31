import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Sessions } from './sessions.mjs';
import { CDP, targets } from './cdp.mjs';
import { readQuota } from './quota.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeRoot=path.resolve(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'));
const port=Number(process.env.CODEX_METER_PORT||9339);
const lock=net.createServer();
lock.on('error',()=>process.exit(0));
await new Promise(resolve=>lock.listen(0,'127.0.0.1',resolve));
await fs.mkdir(runtimeRoot,{recursive:true});
const lockPath=path.join(runtimeRoot,'meter.lock');
try{
  const prev=JSON.parse(await fs.readFile(lockPath,'utf8'));
  const alive=await new Promise(resolve=>{const s=net.connect(prev.port,'127.0.0.1');s.on('connect',()=>{s.end();resolve(true);});s.on('error',()=>resolve(false));s.setTimeout(500,()=>{s.destroy();resolve(false);});});
  if(alive){lock.close();process.exit(0);}
}catch{}
await fs.writeFile(lockPath,JSON.stringify({pid:process.pid,port:lock.address().port}));
const store=new Sessions(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions'));
const rendererPath=path.join(root,'src','renderer.js');
let script=await fs.readFile(rendererPath,'utf8');
let rendererMtime=(await fs.stat(rendererPath)).mtimeMs;
const clients=new Map();let stopping=false,firstSeen=false,lastSeen=Date.now(),lastQuota=0,quotaBusy=false,quota=null;
function status(state,extra={}) { return fs.writeFile(path.join(runtimeRoot,'status.json'),JSON.stringify({state,time:new Date().toISOString(),pid:process.pid,...extra},null,2)).catch(()=>{}); }
async function stop(){if(stopping)return;stopping=true;for(const c of clients.values()){try{await c.evaluate('window.__codexComposerMeter?.destroy()');}catch{}c.close();}await status('stopped');lock.close();await fs.unlink(lockPath).catch(()=>{});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
await store.scan();
await status('waiting-for-codex',{port});
while(!stopping){
 const rendererStat=await fs.stat(rendererPath).catch(()=>null);
 if(rendererStat&&rendererStat.mtimeMs!==rendererMtime){script=await fs.readFile(rendererPath,'utf8');rendererMtime=rendererStat.mtimeMs;}
 let pages=[];try{pages=await targets(port);lastSeen=Date.now();firstSeen=true;}catch{}
 if(!pages.length){
  if(Date.now()-lastSeen>(firstSeen?12000:90000))break;
 }else{
  if(Date.now()-lastQuota>60000&&!quotaBusy){lastQuota=Date.now();quotaBusy=true;readQuota(process.env.CODEX_METER_CLI||'codex').then(q=>{if(q)quota=q;}).finally(()=>{quotaBusy=false;});}
  const active=new Set(pages.map(p=>p.id));
  for(const [id,c]of clients)if(!active.has(id)){c.close();clients.delete(id);}
  for(const page of pages){
   try{
    let c=clients.get(page.id);if(!c){c=await CDP.connect(page.webSocketDebuggerUrl);clients.set(page.id,c);}
    await c.evaluate(script);
    const state=await c.evaluate('window.__codexComposerMeter?.state()');
    const usage=state?.threadId?await store.read(state.threadId):null;
    const q=quota&&Date.now()-quota.observedAt<120000?quota:store.quota??quota;
    await c.evaluate(`window.__codexComposerMeter?.update(${JSON.stringify({threadId:state?.threadId??null,usage,quota:q})})`);
    await status('connected',{port,windows:pages.length,mounted:state?.mounted,visible:state?.visible,scope:state?.scope??null,hiddenReason:state?.hiddenReason??null,rendererVersion:state?.version??null,hasUsage:!!usage,quotaSource:q?.source??null});
   }catch{clients.get(page.id)?.close();clients.delete(page.id);await status('reconnecting',{port});}
  }
 }
 await new Promise(resolve=>setTimeout(resolve,2000));
}
await stop();
