import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignored=new Set(['.git','node_modules','runtime','coverage','dist','.playwright-mcp']);
const failures=[];
let count=0;
async function walk(dir){
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  if(ignored.has(entry.name))continue;
  const file=path.join(dir,entry.name),rel=path.relative(root,file);
  if(entry.isSymbolicLink()){failures.push(`${rel}: 发布目录不应包含外部链接`);continue;}
  if(entry.isDirectory()){await walk(file);continue;}
  count++;
  if(/\.(lnk|sqlite|db|pem|key|jsonl|log)$/i.test(entry.name)||/^\.env(?:\.|$)/.test(entry.name)||entry.name==='auth.json')failures.push(`${rel}: 不应发布本机资料`);
  if(!/\.(md|js|mjs|json|ps1|yml|svg)$/.test(entry.name))continue;
  const buffer=await fs.readFile(file),text=buffer.toString('utf8');
  if(/\b[A-Z]:[\\/]Users[\\/](?:admin|Administrator)[\\/]/i.test(text)||/\bE:[\\/]project[\\/]00_Inbox/i.test(text))failures.push(`${rel}: 包含开发机路径`);
  if(/\bgh[pousr]_[A-Za-z0-9]{25,}\b/.test(text)||/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(text))failures.push(`${rel}: 可能包含凭据`);
  if(entry.name.endsWith('.ps1')&&!(buffer[0]===0xef&&buffer[1]===0xbb&&buffer[2]===0xbf))failures.push(`${rel}: PowerShell 脚本需要 UTF-8 BOM`);
 }
}
await walk(root);
const metadata=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const lockfile=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const renderer=await fs.readFile(path.join(root,'src','renderer.js'),'utf8');
const quota=await fs.readFile(path.join(root,'src','quota.mjs'),'utf8');
if(lockfile.version!==metadata.version||lockfile.packages?.['']?.version!==metadata.version)failures.push('package-lock.json: 版本与 package.json 不一致');
if(renderer.match(/const version='([^']+)'/)?.[1]!==metadata.version)failures.push('src/renderer.js: 注入版本与 package.json 不一致');
if(quota.match(/version:'([^']+)'/)?.[1]!==metadata.version)failures.push('src/quota.mjs: CLI 客户端版本与 package.json 不一致');
const tracked=spawnSync('git',['-c','core.longpaths=true','ls-files','-z'],{cwd:root,encoding:'utf8'});
if(tracked.status===0)for(const file of tracked.stdout.split('\0').filter(Boolean))if(/^(runtime|node_modules|\.codex|\.agents)\//.test(file))failures.push(`${file}: 本机目录已被 Git 跟踪`);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`发布检查通过：${count} 个源文件；没有匹配到开发机路径、凭据或本机资料。`);
