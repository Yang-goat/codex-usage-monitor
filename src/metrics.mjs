export function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function normalizeId(value) {
  if (typeof value !== 'string') return null;
  return value.match(/(?:^|:|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[/?#])/i)?.[1]?.toLowerCase() ?? null;
}
export function usageFromEvent(row) {
  if (row?.type !== 'event_msg' || row.payload?.type !== 'token_count') return null;
  const info = row.payload.info;
  if (!info?.total_token_usage) return null;
  const t = info.total_token_usage;
  const input = number(t.input_tokens), cached = number(t.cached_input_tokens);
  const context = number(info.last_token_usage?.total_tokens);
  const window = number(info.model_context_window);
  return {
    total: number(t.total_tokens), input, output: number(t.output_tokens),
    reasoning: number(t.reasoning_output_tokens), cached,
    cacheRate: input > 0 && cached !== null ? Math.min(100, cached / input * 100) : null,
    context, window, contextPercent: window > 0 && context !== null ? context / window * 100 : null,
    updatedAt: row.timestamp ?? null
  };
}
export function normalizeLimits(result, observedAt = Date.now(), source = 'live') {
  const all = result?.rateLimitsByLimitId ?? result?.rate_limits_by_limit_id;
  const bucket = all?.codex ?? result?.rateLimits ?? result?.rate_limits ?? (result?.limit_id ? result : null);
  if (!bucket) return null;
  const windows = ['primary', 'secondary'].flatMap(key => {
    const w = bucket[key], used = number(w?.usedPercent ?? w?.used_percent);
    if (used === null) return [];
    const minutes = number(w.windowDurationMins ?? w.window_minutes);
    return [{ key, used, remaining: Math.max(0, 100 - used), minutes,
      resetsAt: number(w.resetsAt ?? w.resets_at) }];
  });
  return windows.length ? { windows, observedAt, source } : null;
}
export function formatToken(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
export function countdown(seconds, now = Date.now()) {
  if (!seconds) return '—';
  let s = Math.ceil(seconds - now / 1000);
  if (s <= 0) return '待刷新';
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m${s % 60}s`;
}
