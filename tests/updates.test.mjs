import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { activateUpdate, readActiveUpdate, selectedApp, stageUpdate } from '../src/updates.mjs';
import { checkLatestRelease } from '../src/releases.mjs';

const exec = promisify(execFile);
const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const creator = fileURLToPath(new URL('./fixtures/create-update-zip.ps1', import.meta.url));
const url = 'https://github.com/Yang-goat/codex-usage-monitor/releases/download/v0.1.5/codex-usage-monitor-v0.1.5-windows.zip';

async function fixture(t, extraEntry) {
  await fs.mkdir(runtime, { recursive: true });
  const root = await fs.mkdtemp(path.join(runtime, 'update-test-'));
  const file = path.join(root, 'fixture.zip');
  await exec('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', creator, file,
    ...(extraEntry ? [extraEntry] : []),
  ], { windowsHide: true, timeout: 15000 });
  const body = await fs.readFile(file);
  const digest = 'sha256:' + createHash('sha256').update(body).digest('hex');
  t.mock.method(globalThis, 'fetch', async request => {
    assert.equal(request, url);
    return new Response(body);
  });
  return { root, release: { tag: 'v0.1.5', asset: { size: body.length, digest } } };
}

test('selects only the official, verified Windows asset', async t => {
  const asset = { browser_download_url: url, digest: 'sha256:' + 'a'.repeat(64), size: 10, state: 'uploaded' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    tag_name: 'v0.1.5',
    assets: [{ ...asset, browser_download_url: 'https://example.com/update.zip' }, asset],
  }));
  assert.deepEqual(await checkLatestRelease('0.1.4'), {
    state: 'available', tag: 'v0.1.5', asset: { digest: asset.digest, size: 10 },
  });
});

test('stages the verified archive and selects it only when activated', async t => {
  const { root, release } = await fixture(t);
  await fs.writeFile(path.join(root, 'preferences.json'), '{"locale":"en-US"}');
  const slot = await stageUpdate(root, release);
  assert.equal(await readActiveUpdate(root), null);
  await activateUpdate(root, slot);
  assert.deepEqual(await readActiveUpdate(root), slot);
  assert.equal(await fs.readFile(path.join(await selectedApp(root, slot), 'src', 'main.mjs'), 'utf8'), 'export {};');
  assert.equal(await fs.readFile(path.join(root, 'preferences.json'), 'utf8'), '{"locale":"en-US"}');
  await activateUpdate(root, null);
  assert.equal(await readActiveUpdate(root), null);
});

test('rejects a corrupted download and a traversal entry without activating a version', async t => {
  const { root, release } = await fixture(t, '../escape.txt');
  const wrongDigest = { ...release, asset: { ...release.asset, digest: 'sha256:' + '0'.repeat(64) } };
  await assert.rejects(stageUpdate(root, wrongDigest), /digest mismatch/);
  await assert.rejects(stageUpdate(root, release), /Unsafe path in update/);
  assert.equal(await readActiveUpdate(root), null);
  assert.deepEqual(await fs.readdir(path.join(root, 'updates')), []);
});
