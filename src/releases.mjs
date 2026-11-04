const repository = 'Yang-goat/codex-usage-monitor';
const releasesUrl = `https://api.github.com/repos/${repository}/releases/latest`;

function stableVersion(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.trim() !== value) {
    throw new Error('Invalid release version');
  }
  return value.split('.').map(BigInt);
}

export function isNewerRelease(tag, currentVersion) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Invalid release tag');
  const current = stableVersion(currentVersion);
  const latest = stableVersion(tag.slice(1));
  const difference = latest.findIndex((part, index) => part !== current[index]);
  return difference !== -1 && latest[difference] > current[difference];
}

export function windowsAssetUrl(tag) {
  isNewerRelease(tag, '0.0.0');
  return `https://github.com/${repository}/releases/download/${tag}/codex-usage-monitor-${tag}-windows.zip`;
}

export async function checkLatestRelease(currentVersion, signal) {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(releasesUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-usage-monitor' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

  const { tag_name: tag, assets } = await response.json();
  if (isNewerRelease(tag, currentVersion)) {
    const url = windowsAssetUrl(tag);
    const asset = Array.isArray(assets) && assets.find(item => item?.browser_download_url === url &&
      item.state === 'uploaded' && /^sha256:[a-f0-9]{64}$/i.test(item.digest) &&
      Number.isSafeInteger(item.size) && item.size > 0);
    return { state: 'available', tag, ...(asset && { asset: { digest: asset.digest, size: asset.size } }) };
  }
  return { state: 'current' };
}
