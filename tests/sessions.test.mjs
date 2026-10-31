import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Sessions } from '../src/sessions.mjs';
const base=path.resolve('runtime','test-sessions');
const id='00000000-0000-0000-0000-000000000001';
const row=n=>JSON.stringify({type:'event_msg',timestamp:'2026-10-31T00:00:00Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,total_tokens:n+20,output_tokens:20}},rate_limits:{primary:{used_percent:20,window_minutes:10080,resets_at:2000000000}}}})+'\n';
test('incremental append, partial line, truncation, missing session',async()=>{
 await fs.mkdir(base,{recursive:true});const file=path.join(base,'rollout-2026-10-31T00-00-00-'+id+'.jsonl');
 await fs.writeFile(file,row(10));const s=new Sessions(base);
 assert.equal((await s.read(id)).total,30);
 const next=row(100);await fs.appendFile(file,next.slice(0,-5));assert.equal((await s.read(id)).total,30);
 await fs.appendFile(file,next.slice(-5));assert.equal((await s.read(id)).total,120);
 await fs.writeFile(file,row(1));assert.equal((await s.read(id)).total,21);
 assert.equal(await s.read('00000000-0000-0000-0000-000000000099'),null);
 assert.equal(s.quota.windows[0].remaining,80);
});
