import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('helper exits after its own simulated client closes, using isolated runtime', {timeout:25000}, async t=>{
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 await fs.mkdir(path.join(root,'runtime'),{recursive:true});
 const fixture=await fs.mkdtemp(path.join(root,'runtime','lifecycle-'));
 const runtime=path.join(fixture,'monitor'),home=path.join(fixture,'home');
 await fs.mkdir(path.join(home,'sessions'),{recursive:true});
 let observed;
 const seen=new Promise(resolve=>{observed=resolve;});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('[]');observed();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,[path.join(root,'src','main.mjs')],{windowsHide:true,stdio:'ignore',env:{...process.env,CODEX_HOME:home,CODEX_METER_RUNTIME:runtime,CODEX_METER_PORT:String(server.address().port)}});
 t.after(()=>{server.close();if(child.exitCode===null)child.kill();});
 const done=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 await seen;
 await new Promise(resolve=>setTimeout(resolve,500));
 await new Promise(resolve=>server.close(resolve));
 assert.equal(await done,0);
 const status=JSON.parse(await fs.readFile(path.join(runtime,'status.json'),'utf8'));
 assert.equal(status.state,'stopped');
 await assert.rejects(fs.stat(path.join(runtime,'meter.lock')),{code:'ENOENT'});
});
