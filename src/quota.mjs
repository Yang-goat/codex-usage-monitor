import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { normalizeLimits } from './metrics.mjs';
// Ask the official local client; never read or copy authentication files ourselves.
export async function readQuota(executable = 'codex') {
  return new Promise(resolve => {
    let done=false, child;
    const finish = value => { if(done)return;done=true;clearTimeout(timer);child?.stdin.end();child?.kill();resolve(value); };
    const timer=setTimeout(()=>finish(null),15000);
    try { child=spawn(executable,['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','ignore']}); }
    catch { finish(null);return; }
    child.on('error',()=>finish(null));child.on('exit',()=>finish(null));
    child.stdin.on('error',()=>finish(null));
    const send=x=>{if(!done)child.stdin.write(JSON.stringify(x)+'\n');};
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let r;try{r=JSON.parse(line);}catch{return;}
      if(r.id===1){if(r.error){finish(null);return;}send({method:'initialized'});send({id:2,method:'account/rateLimits/read'});}
      if(r.id===2) finish(r.error?null:normalizeLimits(r.result));
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'codex_usage_monitor',title:'Codex 用量监控',version:'0.1.2'},capabilities:{experimentalApi:true}}});
  });
}
