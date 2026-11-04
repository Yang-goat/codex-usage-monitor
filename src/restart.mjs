// A short-lived supervisor. It never terminates another process.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { probeInstance } from './instance.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oldPid = Number(process.argv[2]);
const port = Number(process.env.CODEX_METER_PORT || 9339);
const ownerPid = Number(process.env.CODEX_METER_CLIENT_PID);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function record(state) {
  const file = path.join(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'), 'restart-status.json');
  const temporary = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ state, oldPid, time: new Date().toISOString() }, null, 2));
  await fs.rename(temporary, file);
}
if (!Number.isInteger(oldPid) || oldPid <= 0) process.exit(1);
await record('waiting-for-exit');
const deadline = Date.now() + 15000;
while (alive(oldPid)) {
  if (Date.now() >= deadline) { await record('old-instance-timeout'); process.exit(1); }
  await sleep(100);
}
const existing = await probeInstance(root);
if (existing) {
  await record(existing.debugPort === port ? 'reused-existing-instance' : 'different-port-instance');
  process.exit(existing.debugPort === port ? 0 : 1);
}
if (ownerPid > 0 && !alive(ownerPid)) { await record('client-exited'); process.exit(0); }
const child = spawn(process.execPath, [path.join(root, 'src', 'main.mjs')], {
  detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
});
let failed = false;
child.on('error', () => { failed = true; });
child.unref();
const started = Date.now();
while (!failed && Date.now() - started < 12000) {
  const info = await probeInstance(root);
  if (info?.state === 'running' && info.debugPort === port) { await record('restarted'); process.exit(0); }
  if (child.exitCode !== null) break;
  await sleep(150);
}
await record('start-failed');
process.exit(1);
