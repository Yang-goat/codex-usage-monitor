const releasesUrl = 'https://api.github.com/repos/Yang-goat/codex-usage-monitor/releases/latest';

function stableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Invalid release version');
  }
  return value.split('.').map(BigInt);
}

export async function checkLatestRelease(currentVersion, signal) {
  const current = stableVersion(currentVersion);
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(releasesUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-usage-monitor' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

  const { tag_name: tag } = await response.json();
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Invalid release tag');
  const latest = stableVersion(tag.slice(1));
  const difference = latest.findIndex((part, index) => part !== current[index]);
  if (difference !== -1 && latest[difference] > current[difference]) {
    return { state: 'available', tag };
  }
  return { state: 'current' };
}
