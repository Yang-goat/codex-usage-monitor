import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadPreferences } from '../src/preferences.mjs';

async function fixture() {
  const root = fileURLToPath(new URL('../runtime/', import.meta.url));
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'preferences-test-'));
}

test('uses Chinese by default and preserves the last selection across helper starts', async () => {
  const root = await fixture();
  const settings = await loadPreferences(root);
  assert.equal(settings.locale, 'zh-CN');

  await Promise.all([settings.setLocale('en-US'), settings.setLocale('zh-CN'), settings.setLocale('en-US')]);
  await settings.flush();
  assert.equal((await loadPreferences(root)).locale, 'en-US');
  await assert.rejects(settings.setLocale('unsupported'), /Unsupported locale/);
  assert.equal(settings.locale, 'en-US');
});

test('invalid preferences fall back to Chinese and a failed save can be retried', async () => {
  const root = await fixture();
  const file = path.join(root, 'preferences.json');
  await fs.writeFile(file, '{invalid JSON');
  const settings = await loadPreferences(root);
  assert.equal(settings.locale, 'zh-CN');

  await fs.unlink(file);
  await fs.mkdir(file);
  await assert.rejects(settings.setLocale('en-US'));
  assert.equal(settings.locale, 'zh-CN');
  await fs.rmdir(file);
  await settings.setLocale('en-US');
  assert.equal((await loadPreferences(root)).locale, 'en-US');
});
