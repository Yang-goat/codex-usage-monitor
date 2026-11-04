export class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map();
    socket.addEventListener('message', event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.method === 'Runtime.bindingCalled') { this.onBinding?.(msg.params); return; }
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
    socket.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); } this.pending.clear(); });
  }
  static async connect(url) {
    const u = new URL(url);
    if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('Only loopback CDP is allowed');
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connect timeout')); }, 4000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connect error')); }, { once: true });
    });
    return new CDP(ws);
  }
  call(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout')); }, 5000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('Renderer evaluation failed');
    return r.result?.value;
  }
  close() { this.socket.close(); }
}
export async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
  const list = await response.json();
  return list.filter(t => t.type === 'page' && t.url?.startsWith('app://') &&
    !/avatar-overlay|pet|browser|devtools/i.test(t.url) && t.webSocketDebuggerUrl);
}
