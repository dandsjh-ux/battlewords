// Minimal, dependency-free WebSocket server (RFC 6455) on top of Node's http module.
// Handles text frames, fragmentation, ping/pong and close. Good enough for game traffic.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20; // 1 MB is plenty for game messages

class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.alive = true;
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('end', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.terminate();
        len = Number(big); off = 10;
      }
      if (len > MAX_PAYLOAD) return this.terminate();
      let mask = null;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.subarray(off, off + 4); off += 4;
      }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(off + len);
      this._frame(op, fin, payload);
    }
  }

  _frame(op, fin, payload) {
    if (op === 0x8) { // close
      this._write(0x8, Buffer.alloc(0));
      this.socket.end();
      return this._closed();
    }
    if (op === 0x9) return this._write(0xA, payload); // ping -> pong
    if (op === 0xA) { this.alive = true; return; }    // pong
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.frags.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.frags).toString('utf8');
        this.frags = [];
        this.alive = true;
        this.emit('message', msg);
      }
    }
  }

  _write(op, data) {
    if (!this.open || this.socket.destroyed) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, data])); } catch (e) { this._closed(); }
  }

  send(str) { this._write(0x1, Buffer.from(str, 'utf8')); }
  ping() { this._write(0x9, Buffer.alloc(0)); }
  close() { this._write(0x8, Buffer.alloc(0)); try { this.socket.end(); } catch (e) {} this._closed(); }
  terminate() { try { this.socket.destroy(); } catch (e) {} this._closed(); }
}

function attachWebSocket(server, path, onConnection) {
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      return socket.destroy();
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);
    const conn = new WSConnection(socket);
    conns.add(conn);
    conn.on('close', () => conns.delete(conn));
    onConnection(conn, req);
  });

  // Heartbeat keeps proxies (e.g. Render) from dropping idle sockets and clears dead ones.
  const timer = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.terminate(); continue; }
      c.alive = false;
      c.ping();
    }
  }, 25000);
  timer.unref();
  return { conns };
}

module.exports = { attachWebSocket };
