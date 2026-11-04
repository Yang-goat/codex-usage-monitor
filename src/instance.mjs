import fs from 'node:fs/promises';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export function instancePipe(root) {
  const key = createHash('sha256').update(path.resolve(root).toUpperCase()).digest('hex').slice(0, 24);
  return `\\\\.\\pipe\\codex-composer-meter-${key}`;
}

export async function probeInstance(root, command) {
  return new Promise(resolve => {
    const socket = net.connect(instancePipe(root));
    let data = '', done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('end', () => finish(null));
    socket.on('connect', () => { if (command) socket.write(JSON.stringify(command) + '\n'); });
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 4096) return finish(null);
      if (!data.includes('\n')) return;
      try { finish(JSON.parse(data.split('\n')[0])); } catch { finish(null); }
    });
  });
}

// The OS owns exclusivity and removes a Windows pipe even after a forced exit.
// meter.lock is diagnostic metadata only; it never grants ownership.
export async function acquireInstance(root, port, onStop) {
  const metadata = { protocol: 'codex-meter/1', pid: process.pid, debugPort: port, token: randomUUID() };
  let state = 'starting';
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(1000, () => socket.destroy());
    socket.write(JSON.stringify({ protocol: metadata.protocol, pid: metadata.pid, debugPort: port, state }) + '\n');
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 4096) return socket.destroy();
      if (!data.includes('\n')) return;
      try {
        const command = JSON.parse(data.split('\n')[0]);
        if (['stop','restart'].includes(command.action) && command.token === metadata.token) onStop(command.action);
      } catch {}
      socket.end();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(instancePipe(root), () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') return null;
    throw error;
  }
  server.on('error', () => onStop('stop'));
  return {
    metadata,
    setState(value) { state = value; },
    async close() {
      // Remove only our metadata, while still holding the OS lock.
      const lockPath = path.join(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'), 'meter.lock');
      const current = await fs.readFile(lockPath, 'utf8').then(JSON.parse).catch(() => null);
      if (current?.token === metadata.token) await fs.unlink(lockPath).catch(() => {});
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export async function legacyInstanceAlive(root) {
  const previous = await fs.readFile(path.join(process.env.CODEX_METER_RUNTIME||path.join(root,'runtime'), 'meter.lock'), 'utf8').then(JSON.parse).catch(() => null);
  if (!previous || previous.protocol || !Number.isInteger(previous.pid) || !Number.isInteger(previous.port) || previous.port < 1 || previous.port > 65535) return false;
  try { process.kill(previous.pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  return new Promise(resolve => {
    const socket = net.connect(previous.port, '127.0.0.1');
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}
