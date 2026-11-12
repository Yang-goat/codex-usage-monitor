import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows taskbar icon repair, caching and process ownership', () => {
  // Let Windows PowerShell discover its own modules when npm was started in pwsh.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./window-icon.test.ps1', import.meta.url))], {env, encoding:'utf8', windowsHide:true, timeout:30000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
