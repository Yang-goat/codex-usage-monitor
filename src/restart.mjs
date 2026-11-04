// A short-lived supervisor. It never terminates another process.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { probeInstance } from './instance.mjs';
import { activateUpdate, selectedApp } from './updates.mjs';
const root = process.env.CODEX_METER_INSTALL_ROOT||path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = process.env.CODEX_METER_RUNTIME||path.join(root, 'runtime');
const oldPid = Number(process.argv[2]);
const update = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const port = Number(process.env.CODEX_METER_PORT || 9339);
const ownerPid = Number(process.env.CODEX_METER_CLIENT_PID);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function record(state) {
  const file = path.join(runtime, 'restart-status.json');
  const temporary = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ state, oldPid, tag: update?.tag, time: new Date().toISOString() }, null, 2));
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
async function stopCandidate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Only terminate the helper created by this supervisor.
  child.kill();
  const deadline = Date.now() + 2000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(80);
}

async function startHelper(app = root) {
  const child = spawn(process.execPath, [path.join(app, 'src', 'main.mjs')], {
    detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, CODEX_METER_INSTALL_ROOT: root },
  });
  let failed = false;
  child.on('error', () => { failed = true; });
  child.unref();
  const started = Date.now();
  while (!failed && Date.now() - started < 12000) {
    const info = await probeInstance(root);
    if (info?.state === 'running' && info.debugPort === port && info.pid === child.pid) return child;
    if (child.exitCode !== null || child.signalCode !== null) return null;
    await sleep(150);
  }
  if (update && !failed) await stopCandidate(child);
  return null;
}

if (!update) {
  const started = await startHelper();
  await record(started ? 'restarted' : 'start-failed');
  process.exit(started ? 0 : 1);
}

let candidate;
try {
  candidate = await startHelper(await selectedApp(runtime, update));
  if (candidate) await activateUpdate(runtime, update);
} catch {
  if (candidate) await stopCandidate(candidate);
  candidate = null;
}
if (candidate) {
  await record('updated');
  process.exit(0);
}
await record('update-rolled-back');
process.exit(await startHelper() ? 0 : 1);
