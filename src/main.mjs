import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Sessions } from './sessions.mjs';
import { CDP, targets } from './cdp.mjs';
import { readQuota } from './quota.mjs';
import { acquireInstance, legacyInstanceAlive } from './instance.mjs';
import { checkLatestRelease } from './releases.mjs';
import packageMetadata from '../package.json' with { type: 'json' };
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.CODEX_METER_PORT||9339);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid meter port');
const clients=new Map();let stopping=false,firstSeen=false,lastSeen=Date.now(),lastQuota=0,quotaBusy=false,quota=null;
const abort=new AbortController();let quotaTask=null,ownerWatch=null,controlBusy=false;
let release={state:'idle'};
const startedAt=new Date().toISOString();
const instance=await acquireInstance(root,port,action=>{void control(action);});
if(!instance)process.exit(0);
async function checkUpdates() {
 if(stopping||release.state==='checking')return;
 release={state:'checking'};
 try {
  release=await checkLatestRelease(packageMetadata.version,abort.signal);
 } catch {
  release={state:'error'};
 }
}

async function control(action){
 if(stopping||controlBusy||!['stop','restart'].includes(action))return;
 controlBusy=true;
 if(action==='restart'){
  try{
   const worker=spawn(process.execPath,[path.join(root,'src','restart.mjs'),String(process.pid)],{detached:true,windowsHide:true,stdio:'ignore',env:process.env});
   await new Promise((resolve,reject)=>{worker.once('spawn',resolve);worker.once('error',reject);});worker.unref();
  }catch{
   controlBusy=false;
   for(const c of clients.values())void c.evaluate('window.__codexComposerMeter?.controlError("重启进程创建失败，请稍后重试。")').catch(()=>{});
   return;
  }
 }
 await stop();
}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
process.on('uncaughtException',()=>{void stop('error',1);});
process.on('unhandledRejection',()=>{void stop('error',1);});
function status(state,extra={}) {
 if(stopping&&state!=='stopped'&&state!=='error')return Promise.resolve();
 return fs.writeFile(path.join(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'),'status.json'),JSON.stringify({state,time:new Date().toISOString(),pid:process.pid,...extra},null,2)).catch(()=>{});
}
async function stop(reason='stopped',code=0){
 if(stopping)return;stopping=true;instance.setState('stopping');abort.abort();clearInterval(ownerWatch);
 const deadline=setTimeout(()=>process.exit(1),5000);
 await Promise.allSettled([...clients.values()].map(async c=>{
  let timer;try{await Promise.race([(async()=>{await c.evaluate('window.__codexComposerMeter?.destroy()');await c.call('Runtime.removeBinding',{name:'__codexMeterControl'});})(),new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}finally{clearTimeout(timer);c.close();}
 }));
 await quotaTask;
 await status(reason,{port});await instance.close();clearTimeout(deadline);process.exit(code);
}
try{
await fs.mkdir(path.resolve(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime')),{recursive:true});
const lockPath=path.join(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'),'meter.lock');
// Allow an old helper its normal exit grace period during a local upgrade.
const legacyDeadline=Date.now()+16000;
while(await legacyInstanceAlive(root)){
 if(Date.now()>=legacyDeadline){await instance.close();process.exit(2);}
 await new Promise(resolve=>setTimeout(resolve,500));
}
await fs.writeFile(lockPath,JSON.stringify(instance.metadata));
const clientPid=Number(process.env.CODEX_METER_CLIENT_PID);
if(Number.isInteger(clientPid)&&clientPid>0){
 ownerWatch=setInterval(()=>{try{process.kill(clientPid,0);}catch(e){if(e.code==='ESRCH')void stop();}},1000);
}
const store=new Sessions(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions'));
const rendererPath=path.join(root,'src','renderer.js');
let script=await fs.readFile(rendererPath,'utf8');
let rendererMtime=(await fs.stat(rendererPath)).mtimeMs;
await store.scan();
await status('waiting-for-codex',{port});
instance.setState('running');
while(!stopping){
 const rendererStat=await fs.stat(rendererPath).catch(()=>null);
 if(rendererStat&&rendererStat.mtimeMs!==rendererMtime){script=await fs.readFile(rendererPath,'utf8');rendererMtime=rendererStat.mtimeMs;}
 let pages=[];try{pages=await targets(port);lastSeen=Date.now();firstSeen=true;}catch{}
 if(!pages.length){
  if(Date.now()-lastSeen>(firstSeen?12000:90000))break;
 }else{
  if(Date.now()-lastQuota>60000&&!quotaBusy){lastQuota=Date.now();quotaBusy=true;quotaTask=readQuota(process.env.CODEX_METER_CLI||'codex',{signal:abort.signal}).then(q=>{if(q)quota=q;}).finally(()=>{quotaBusy=false;});}
  const active=new Set(pages.map(p=>p.id));
  for(const [id,c]of clients)if(!active.has(id)){c.close();clients.delete(id);}
  for(const page of pages){
   if(stopping)break;
   try{
    let c=clients.get(page.id);if(!c){
     c=await CDP.connect(page.webSocketDebuggerUrl);clients.set(page.id,c);
     c.onBinding=event=>{
      if(event.name!=='__codexMeterControl')return;
      try{
       const command=JSON.parse(event.payload);
       if(command.token!==instance.metadata.token)return;
       if(command.action==='check-update')void checkUpdates();
       else void control(command.action);
      }catch{}
     };
     await c.call('Runtime.addBinding',{name:'__codexMeterControl'});
    }
    await c.evaluate(script);
    const state=await c.evaluate('window.__codexComposerMeter?.state()');
    const usage=state?.threadId?await store.read(state.threadId):null;
    const q=quota&&Date.now()-quota.observedAt<120000?quota:store.quota??quota;
    const processInfo={name:path.basename(process.execPath),pid:process.pid,port,clientPid:clientPid||null,startedAt,connection:'已连接',controlToken:instance.metadata.token};
    await c.evaluate(`window.__codexComposerMeter?.update(${JSON.stringify({threadId:state?.threadId??null,usage,quota:q,process:processInfo,release})})`);
    await status('connected',{port,windows:pages.length,mounted:state?.mounted,visible:state?.visible,scope:state?.scope??null,hiddenReason:state?.hiddenReason??null,rendererVersion:state?.version??null,hasUsage:!!usage,quotaSource:q?.source??null});
   }catch{clients.get(page.id)?.close();clients.delete(page.id);await status('reconnecting',{port});}
  }
 }
 await new Promise(resolve=>setTimeout(resolve,2000));
}
await stop();
}catch{await stop('error',1);}
