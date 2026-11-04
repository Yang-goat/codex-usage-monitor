import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLatestRelease } from '../src/releases.mjs';

test('checks only the official latest release and compares version numbers', async t => {
  const responses = ['v0.1.10', 'v0.1.4', 'v0.0.99'];
  const fetchRelease = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ tag_name: responses.shift() }));

  assert.deepEqual(await checkLatestRelease('0.1.4'), { state: 'available', tag: 'v0.1.10' });
  assert.deepEqual(await checkLatestRelease('0.1.4'), { state: 'current' });
  assert.deepEqual(await checkLatestRelease('0.1.4'), { state: 'current' });
  const [url, options] = fetchRelease.mock.calls[0].arguments;
  assert.equal(url, 'https://api.github.com/repos/Yang-goat/codex-usage-monitor/releases/latest');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(Object.keys(options.headers).some(key => key.toLowerCase() === 'authorization'), false);
});

test('rejects GitHub errors, invalid tags and cancellation', async t => {
  const responses = [
    new Response(null, { status: 403 }),
    new Response('invalid JSON'),
    Response.json({ tag_name: 'v0.2.0-beta.1' }),
    Response.json({ tag_name: null }),
  ];
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signal.throwIfAborted();
    return responses.shift();
  });

  await assert.rejects(checkLatestRelease('0.1.4'), /HTTP 403/);
  await assert.rejects(checkLatestRelease('0.1.4'), SyntaxError);
  await assert.rejects(checkLatestRelease('0.1.4'), /Invalid release version/);
  await assert.rejects(checkLatestRelease('0.1.4'), /Invalid release tag/);
  await assert.rejects(checkLatestRelease('0.1.4', AbortSignal.abort()), { name: 'AbortError' });
});
