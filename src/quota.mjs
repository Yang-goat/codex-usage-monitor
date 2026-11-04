import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { normalizeLimits } from './metrics.mjs';
// Ask the official local client; never read or copy authentication files ourselves.
export async function readQuota(executable = 'codex', { signal } = {}) {
  return new Promise(resolve => {
    let done=false, child, lines;
    const cancel=()=>finish(null);
    const finish = value => {
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);lines?.close();
      if(!child||child.exitCode!==null){resolve(value);return;}
      // Wait briefly for our own quota child to exit; do not leave it behind on shutdown.
      const cleanup=setTimeout(()=>resolve(value),1000);
      child.once('close',()=>{clearTimeout(cleanup);resolve(value);});
      child.stdin.end();child.kill();
    };
    const timer=setTimeout(()=>finish(null),15000);
    if(signal?.aborted){finish(null);return;}
    signal?.addEventListener('abort',cancel,{once:true});
    try { child=spawn(executable,['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','ignore']}); }
    catch { finish(null);return; }
    child.on('error',()=>finish(null));child.on('exit',()=>finish(null));
    child.stdin.on('error',()=>finish(null));
    const send=x=>{if(!done)child.stdin.write(JSON.stringify(x)+'\n');};
    lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{
      let r;try{r=JSON.parse(line);}catch{return;}
      if(r.id===1){if(r.error){finish(null);return;}send({method:'initialized'});send({id:2,method:'account/rateLimits/read'});}
      if(r.id===2) finish(r.error?null:normalizeLimits(r.result));
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'codex_composer_meter',title:'Codex 聊天用量状态条',version:'0.1.4'},capabilities:{experimentalApi:true}}});
  });
}
