import { appendFileSync } from 'node:fs';
import path from 'node:path';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.github.com/repos/Yang-goat/codex-usage-monitor/releases/latest') {
    return originalFetch(url, options);
  }
  options.signal.throwIfAborted();
  appendFileSync(path.join(process.env.CODEX_HOME, 'release-checks.log'), `${process.pid}\n`);
  return Response.json({ tag_name: 'v0.1.4' });
};
