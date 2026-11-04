import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isNewerRelease, windowsAssetUrl } from './releases.mjs';

const exec = promisify(execFile);
const maxDownload = 32 * 1024 * 1024;
const extractor = fileURLToPath(new URL('./extract-update.ps1', import.meta.url));

function validSelection(value) {
  try {
    return isNewerRelease(value?.tag, '0.0.0') && /^u-[A-Za-z0-9]{6}$/.test(value.slot);
  } catch {
    return false;
  }
}

export async function readActiveUpdate(runtime) {
  const value = await fs.readFile(path.join(runtime, 'active-update.json'), 'utf8').then(JSON.parse).catch(() => null);
  return validSelection(value) ? value : null;
}

export async function selectedApp(runtime, selection) {
  if (!validSelection(selection)) throw new Error('Invalid update selection');
  const slots = path.join(await fs.realpath(runtime), 'updates');
  const app = path.join(slots, selection.slot, 'app');
  if ((await fs.realpath(app)).toLowerCase() !== app.toLowerCase()) throw new Error('Update directory is redirected');
  const metadata = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
  if (metadata.name !== 'codex-usage-monitor' || `v${metadata.version}` !== selection.tag) {
    throw new Error('Update package version mismatch');
  }
  return app;
}

export async function activateUpdate(runtime, selection) {
  const file = path.join(runtime, 'active-update.json');
  if (!selection) {
    await fs.rm(file, { force: true });
    return;
  }
  await selectedApp(runtime, selection);
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(selection) + '\n', 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function stageUpdate(runtime, release, signal) {
  const { tag, asset } = release;
  if (!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest) ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maxDownload) {
    throw new Error('Invalid Windows release asset');
  }
  const timeout = AbortSignal.timeout(60000);
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(windowsAssetUrl(tag), { signal: downloadSignal });
  if (!response.ok || !response.body) throw new Error('Release download failed');
  const hash = createHash('sha256');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > asset.size) throw new Error('Release download exceeds advertised size');
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest.toLowerCase()) {
    throw new Error('Release digest mismatch');
  }

  const directory = path.join(await fs.realpath(runtime), 'updates');
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw new Error('Update directory is redirected');
  const stage = await fs.mkdtemp(path.join(directory, 'u-'));
  try {
    const archive = path.join(stage, 'release.zip');
    const app = path.join(stage, 'app');
    await fs.writeFile(archive, Buffer.concat(chunks, bytes), { flag: 'wx' });
    await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', extractor,
      archive, app, `codex-usage-monitor-${tag}/`,
    ], { windowsHide: true, timeout: 45000, signal });
    await fs.unlink(archive);
    const selection = { tag, slot: path.basename(stage) };
    await selectedApp(runtime, selection);
    for (const file of ['main.mjs', 'renderer.js', 'restart.mjs']) {
      await exec(process.execPath, ['--check', path.join(app, 'src', file)], { windowsHide: true, timeout: 5000, signal });
    }
    return selection;
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
