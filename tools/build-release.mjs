import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function git(...args){
 const result=spawnSync('git',['-c','core.longpaths=true',...args],{cwd:root,encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr||'Git operation failed');
 return result.stdout.trim();
}
if(git('status','--porcelain'))throw new Error('工作区有未提交修改；请先提交要发布的文件。');
const check=spawnSync(process.execPath,['tools/check-release.mjs'],{cwd:root,stdio:'inherit'});
if(check.status!==0)throw new Error('发布检查未通过。');
const {version,engines}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const tag=`v${version}`;
const prefix=`codex-usage-monitor-${tag}`;
const output=path.join(root,'dist','release',tag);
await fs.mkdir(output,{recursive:true});
const filename=`${prefix}-windows.zip`;
const archive=path.join(output,filename);
const checksum=path.join(output,'SHA256SUMS.txt');
// The runtime package has no npm dependencies. Keep development files and screenshots on GitHub.
const distribution=['package.json','src','scripts','LICENSE','INSTALL.md'];
git('archive','--format=zip',`--prefix=${prefix}/`,`--output=${archive}`,'HEAD','--',...distribution);
const sha256=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
await fs.writeFile(checksum,`${sha256}  ${filename}\n`,'utf8');
const manifest={version,tag,commit:git('rev-parse','HEAD'),archive:filename,sha256,node:engines.node};
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(JSON.stringify({archive,checksum,...manifest},null,2));
