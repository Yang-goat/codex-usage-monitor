import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { normalizeId, usageFromEvent, normalizeLimits } from './metrics.mjs';

// Keep only numeric usage fields, never conversation content.
export class Sessions {
  constructor(root) { this.root = root; this.files = new Map(); this.cache = new Map(); this.quota = null; this.lastScan = 0; }
  async scan(force = false) {
    if (!force && Date.now() - this.lastScan < 15000) return;
    const visit = async dir => {
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await visit(p);
        else if (e.isFile() && e.name.endsWith('.jsonl')) {
          const id = normalizeId('/' + e.name.replace(/^.*?(?=[0-9a-f]{8}-[0-9a-f]{4}-)/i, '').replace(/\.jsonl$/, ''));
          if (id) this.files.set(id, p);
        }
      }
    };
    await visit(this.root); this.lastScan = Date.now();
  }
  async read(id) {
    id = normalizeId(id); if (!id) return null;
    await this.scan();
    let file = this.files.get(id);
    if (!file) { await this.scan(true); file = this.files.get(id); }
    if (!file) return null;
    let stat; try { stat = await fs.stat(file); } catch { return null; }
    let c = this.cache.get(id);
    if (!c || stat.size < c.offset || stat.ino !== c.ino) {
      c = { offset: 0, ino: stat.ino, decoder: new StringDecoder('utf8'), pending: '', usage: null };
      this.cache.set(id, c);
    }
    if (stat.size === c.offset) return c.usage;
    const handle = await fs.open(file, 'r');
    try {
      while (c.offset < stat.size) {
        const b = Buffer.alloc(Math.min(128 * 1024, stat.size - c.offset));
        const { bytesRead } = await handle.read(b, 0, b.length, c.offset); if (!bytesRead) break;
        c.offset += bytesRead;
        const lines = (c.pending + c.decoder.write(b.subarray(0, bytesRead))).split('\n');
        c.pending = lines.pop();
        for (const line of lines) {
          if (!line.includes('"token_count"')) continue;
          let row; try { row = JSON.parse(line); } catch { continue; }
          const usage = usageFromEvent(row);
          if (usage) c.usage = usage;
          const observed = Date.parse(row.timestamp);
          const q = normalizeLimits({ rate_limits: row.payload?.rate_limits }, Number.isFinite(observed) ? observed : stat.mtimeMs, 'snapshot');
          if (q && (!this.quota || q.observedAt > this.quota.observedAt)) this.quota = q;
        }
        // A corrupt/incomplete line must not cause unbounded memory growth.
        if (c.pending.length > 8 * 1024 * 1024) c.pending = '';
      }
    } finally { await handle.close(); }
    // Bounded numeric cache. File contents are never copied to disk.
    if (this.cache.size > 12) { const old = [...this.cache.keys()].find(k => k !== id); this.cache.delete(old); }
    return c.usage;
  }
}
