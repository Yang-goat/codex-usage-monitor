import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
test('Windows launcher mutex serializes eight concurrent requests; later requests reuse service', async () => {
  const base = path.join(root, 'runtime', 'lifecycle-tests');
  await fs.mkdir(base, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(base, 'launcher-'));
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests', 'fixtures', 'launcher-worker.ps1'), '-SourceRoot', root, '-FixtureRoot', fixture], { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Launcher test timeout')); }, 15000);
    child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(output)); });
  });
  await Promise.all(Array.from({ length: 8 }, launch));
  await launch();
  assert.deepEqual((await fs.readFile(path.join(fixture, 'launches.txt'), 'utf8')).trim().split('\n'), ['client', 'helper']);
});
