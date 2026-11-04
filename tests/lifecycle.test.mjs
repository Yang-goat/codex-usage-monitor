import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeInstance, instancePipe } from '../src/instance.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await delay(80); } while (Date.now() < end);
  throw new Error('Timed out waiting for lifecycle condition');
}
async function fixture(t) {
  const base = path.join(project, 'runtime', 'lifecycle-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  await fs.cp(path.join(project, 'src'), path.join(root, 'src'), { recursive: true });
  await fs.copyFile(path.join(project, 'package.json'), path.join(root, 'package.json'));
  await fs.mkdir(path.join(root, 'runtime'));
  await fs.mkdir(path.join(root, 'home', 'sessions'), { recursive: true });
  const children = [];
  const start = (port, extra = {}) => {
    const child = spawn(process.execPath, [path.join(root, 'src', 'main.mjs')], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_METER_RUNTIME: '', CODEX_HOME: path.join(root, 'home'), CODEX_METER_PORT: String(port), CODEX_METER_CLIENT_PID: '', ...extra },
    });
    child.output = ''; child.stdout.on('data', d => child.output += d); child.stderr.on('data', d => child.output += d);
    children.push(child); return child;
  };
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(c => until(() => c.exitCode !== null || c.signalCode !== null).catch(() => {})));
  });
  return { root, start, children, metadata: () => fs.readFile(path.join(root, 'runtime', 'meter.lock'), 'utf8').then(JSON.parse) };
}
async function stop(f) {
  const metadata = await f.metadata();
  await probeInstance(f.root, { action: 'stop', token: metadata.token });
  await until(async () => !(await probeInstance(f.root)));
}

test('concurrent helpers: one owner; duplicate cannot overwrite or remove its metadata', async t => {
  const f = await fixture(t);
  const contenders = Array.from({ length: 8 }, () => f.start(19439));
  const info = await until(async () => { const x = await probeInstance(f.root); return x?.state === 'running' && x; });
  await until(() => contenders.filter(c => c.exitCode === 0).length === 7);
  assert.equal(contenders.filter(c => c.exitCode === null).length, 1);
  assert.equal((await f.metadata()).pid, info.pid);
  const before = await f.metadata();
  const duplicate = f.start(19440);
  await until(() => duplicate.exitCode !== null);
  assert.equal(duplicate.exitCode, 0);
  assert.deepEqual(await f.metadata(), before);
  await stop(f);
  assert.equal(await fs.stat(path.join(f.root, 'runtime', 'meter.lock')).catch(() => null), null);
});

test('forced helper exit leaves metadata but OS lock recovers, even when its JSON is corrupt', async t => {
  const f = await fixture(t);
  const first = f.start(19439);
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  const old = await f.metadata();
  first.kill(); await until(() => first.exitCode !== null || first.signalCode !== null);
  assert.equal((await f.metadata()).pid, old.pid);
  await fs.writeFile(path.join(f.root, 'runtime', 'meter.lock'), '{incomplete');
  const next = f.start(19439);
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  assert.equal((await f.metadata()).pid, next.pid);
  await stop(f);
});

test('endpoint disappears: graceful shutdown removes metadata and allows immediate restart', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  let seen = 0;
  const server = http.createServer((req, res) => { seen++; res.end('[]'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const first = f.start(port);
  await until(() => seen > 0); await delay(200);
  await new Promise(resolve => server.close(resolve));
  await until(() => first.exitCode !== null, 18000);
  assert.equal(first.exitCode, 0, first.output);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'runtime', 'status.json'), 'utf8')).state, 'stopped');
  assert.equal(await fs.stat(path.join(f.root, 'runtime', 'meter.lock')).catch(() => null), null);
  const second = f.start(port);
  await until(async () => (await probeInstance(f.root))?.pid === second.pid);
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  await stop(f);
});

test('desktop owner exit stops helper promptly, including while waiting for first endpoint', async t => {
  const f = await fixture(t);
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => owner.kill());
  const child = f.start(19439, { CODEX_METER_CLIENT_PID: String(owner.pid) });
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  owner.kill();
  await until(() => child.exitCode !== null, 5000);
  assert.equal(child.exitCode, 0, child.output);
});

test('legacy live helper is preserved; new helper waits, then takes over after it exits', async t => {
  const f = await fixture(t);
  const legacy = net.createServer(s => s.end());
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  t.after(() => legacy.close());
  const metadata = { pid: process.pid, port: legacy.address().port };
  await fs.writeFile(path.join(f.root, 'runtime', 'meter.lock'), JSON.stringify(metadata));
  const child = f.start(19439);
  await until(async () => (await probeInstance(f.root))?.state === 'starting');
  assert.deepEqual(await f.metadata(), metadata);
  await new Promise(resolve => legacy.close(resolve));
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  assert.equal((await f.metadata()).pid, child.pid);
  await stop(f);
});

test('failed initialization releases ownership so a later launch can recover', async t => {
  const f = await fixture(t);
  const renderer = path.join(f.root, 'src', 'renderer.js');
  await fs.rename(renderer, renderer + '.saved');
  const failed = f.start(19439);
  await until(() => failed.exitCode !== null);
  assert.equal(failed.exitCode, 1);
  assert.equal(await probeInstance(f.root), null);
  await fs.rename(renderer + '.saved', renderer);
  f.start(19439);
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  await stop(f);
});

test('pipe name is stable for equivalent path casing', () => {
  assert.equal(instancePipe(project), instancePipe(project.toUpperCase()));
});

test('custom runtime keeps metadata and cleanup in the requested directory', async t => {
  const f = await fixture(t);
  const runtime = path.join(f.root, 'custom-runtime');
  f.start(19439, { CODEX_METER_RUNTIME: runtime });
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  const metadata = JSON.parse(await fs.readFile(path.join(runtime, 'meter.lock'), 'utf8'));
  assert.equal(await fs.stat(path.join(f.root, 'runtime', 'meter.lock')).catch(() => null), null);
  await probeInstance(f.root, { action: 'stop', token: metadata.token });
  await until(async () => !(await probeInstance(f.root)));
  assert.equal(await fs.stat(path.join(runtime, 'meter.lock')).catch(() => null), null);
  assert.equal(JSON.parse(await fs.readFile(path.join(runtime, 'status.json'), 'utf8')).state, 'stopped');
});

test('restart control waits for old PID exit, creates one replacement, and rejects invalid commands', async t => {
  const f = await fixture(t);
  const first = f.start(19439);
  await until(async () => (await probeInstance(f.root))?.state === 'running');
  const original = await f.metadata();
  await probeInstance(f.root, { action: 'restart', token: 'wrong' });
  await probeInstance(f.root, { action: 'arbitrary-command', token: original.token });
  await delay(200);
  assert.equal((await probeInstance(f.root)).pid, first.pid);
  await Promise.all(Array.from({ length: 5 }, () => probeInstance(f.root, { action: 'restart', token: original.token })));
  const next = await until(async () => {
    const current = await probeInstance(f.root);
    return current?.state === 'running' && current.pid !== first.pid && current;
  });
  t.after(async () => {
    const current = await probeInstance(f.root);
    if (current) await stop(f);
  });
  assert.notEqual(next.pid, first.pid);
  assert.equal(first.exitCode, 0);
  assert.equal(next.debugPort, 19439);
  await until(async () => JSON.parse(await fs.readFile(path.join(f.root, 'runtime', 'restart-status.json'), 'utf8')).state === 'restarted');
  const duplicate = f.start(19439);
  await until(() => duplicate.exitCode !== null);
  assert.equal((await probeInstance(f.root)).pid, next.pid);
  await stop(f);
});
