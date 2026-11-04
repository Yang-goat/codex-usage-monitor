import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Sessions } from './sessions.mjs';
import { CDP, targets } from './cdp.mjs';
import { readQuota } from './quota.mjs';
import { acquireInstance, legacyInstanceAlive } from './instance.mjs';
import { checkLatestRelease, isNewerRelease } from './releases.mjs';
import { loadPreferences } from './preferences.mjs';
import { readActiveUpdate, selectedApp, stageUpdate } from './updates.mjs';
import packageMetadata from '../package.json' with { type: 'json' };
const appRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=process.env.CODEX_METER_INSTALL_ROOT||appRoot;
const runtime=path.resolve(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'));
if(appRoot===root){
 const selected=await readActiveUpdate(runtime);
 const app=selected&&isNewerRelease(selected.tag,packageMetadata.version)&&await selectedApp(runtime,selected).catch(()=>null);
 if(app){
  process.env.CODEX_METER_INSTALL_ROOT=root;
  await import(pathToFileURL(path.join(app,'src','main.mjs')));
  process.exit(0);
 }
}
const port=Number(process.env.CODEX_METER_PORT||9339);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid meter port');
const clients=new Map();let stopping=false,firstSeen=false,lastSeen=Date.now(),lastQuota=0,quotaBusy=false,quota=null;
const abort=new AbortController();let quotaTask=null,ownerWatch=null,controlBusy=false;
let release={state:'idle'};
let preferences;
let failedUpdate;
const startedAt=new Date().toISOString();
const instance=await acquireInstance(root,port,action=>{void control(action);});
if(!instance)process.exit(0);
async function checkUpdates() {
 if(stopping||controlBusy||release.state==='checking')return;
 release={state:'checking'};
 try {
  release=await checkLatestRelease(packageMetadata.version,abort.signal);
  if(failedUpdate&&release.tag===failedUpdate)release={...release,state:'update-error'};
  failedUpdate=null;
 } catch {
  release={state:'error'};
 }
}

async function restart(selection) {
 const args=[path.join(appRoot,'src','restart.mjs'),String(process.pid)];
 if(selection)args.push(JSON.stringify(selection));
 const worker=spawn(process.execPath,args,{
  detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,CODEX_METER_INSTALL_ROOT:root},
 });
 await new Promise((resolve,reject)=>{worker.once('spawn',resolve);worker.once('error',reject);});
 worker.unref();
}

async function update() {
 if(stopping||controlBusy||!release.asset||!['available','update-error'].includes(release.state))return;
 let target=release;
 release={...target,state:'updating'};
 controlBusy=true;
 try{
  const latest=await checkLatestRelease(packageMetadata.version,abort.signal);
  if(latest.tag!==target.tag||!latest.asset){
   release=latest;
   controlBusy=false;
   return;
  }
  target=latest;
  const selection=await stageUpdate(runtime,target,abort.signal);
  if(stopping)return;
  await restart(selection);
 }catch{
  release={...target,state:'update-error'};
  controlBusy=false;
  return;
 }
 await stop();
}

async function setLocale(client, locale) {
 if(stopping)return;
 let saved=true;
 try{await preferences.setLocale(locale);}catch{saved=false;}
 await client.evaluate(`window.__codexComposerMeter?.localeResult?.(${JSON.stringify({locale:preferences.locale,saved})})`).catch(()=>{});
}

async function control(action){
 if(stopping||controlBusy||!['stop','restart'].includes(action))return;
 controlBusy=true;
 if(action==='restart'){
  try{
   await restart();
  }catch{
   controlBusy=false;
   for(const c of clients.values())void c.evaluate('window.__codexComposerMeter?.controlError("restartFailed")').catch(()=>{});
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
 return fs.writeFile(path.join(runtime,'status.json'),JSON.stringify({state,time:new Date().toISOString(),pid:process.pid,version:packageMetadata.version,...extra},null,2)).catch(()=>{});
}
async function stop(reason='stopped',code=0){
 if(stopping)return;stopping=true;instance.setState('stopping');abort.abort();clearInterval(ownerWatch);
 const deadline=setTimeout(()=>process.exit(1),5000);
 await Promise.allSettled([...clients.values()].map(async c=>{
  let timer;try{await Promise.race([(async()=>{await c.evaluate('window.__codexComposerMeter?.destroy()');await c.call('Runtime.removeBinding',{name:'__codexMeterControl'});})(),new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}finally{clearTimeout(timer);c.close();}
 }));
 await Promise.all([quotaTask,preferences?.flush()]);
 await status(reason,{port});await instance.close();clearTimeout(deadline);process.exit(code);
}
try{
await fs.mkdir(runtime,{recursive:true});
const lockPath=path.join(runtime,'meter.lock');
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
preferences=await loadPreferences(runtime);
const restartStatus=await fs.readFile(path.join(runtime,'restart-status.json'),'utf8').then(JSON.parse).catch(()=>null);
if(restartStatus?.state==='update-rolled-back')failedUpdate=restartStatus.tag;
const rendererPath=path.join(appRoot,'src','renderer.js');
let script=await fs.readFile(rendererPath,'utf8');
let rendererMtime=(await fs.stat(rendererPath)).mtimeMs;
await store.scan();
await status('waiting-for-codex',{port});
instance.setState('running');
void checkUpdates();
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
       else if(command.action==='update')void update();
       else if(command.action==='set-locale')void setLocale(c,command.locale);
       else void control(command.action);
      }catch{}
     };
     await c.call('Runtime.addBinding',{name:'__codexMeterControl'});
    }
    await c.evaluate(script);
    const state=await c.evaluate('window.__codexComposerMeter?.state()');
    const usage=state?.threadId?await store.read(state.threadId):null;
    const q=quota&&Date.now()-quota.observedAt<120000?quota:store.quota??quota;
    const processInfo={name:path.basename(process.execPath),pid:process.pid,port,clientPid:clientPid||null,startedAt,controlToken:instance.metadata.token};
    const updateInfo={state:release.state,tag:release.tag,installable:!!release.asset};
    await c.evaluate(`window.__codexComposerMeter?.update(${JSON.stringify({threadId:state?.threadId??null,usage,quota:q,process:processInfo,release:updateInfo,locale:preferences.locale})})`);
    await status('connected',{port,windows:pages.length,mounted:state?.mounted,visible:state?.visible,scope:state?.scope??null,hiddenReason:state?.hiddenReason??null,rendererVersion:state?.version??null,rendererRevision:state?.revision??null,updateState:release.state,hasUsage:!!usage,quotaSource:q?.source??null});
   }catch{clients.get(page.id)?.close();clients.delete(page.id);await status('reconnecting',{port});}
  }
 }
 await new Promise(resolve=>setTimeout(resolve,2000));
}
await stop();
}catch{await stop('error',1);}
