// Word Fleet server: static files + WebSocket game rooms. No npm dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attachWebSocket } = require('./lib/ws');
const { Room } = require('./lib/game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  let file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC, 'index.html');
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
});

const rooms = new Map();
const send = (conn, obj) => { try { conn.send(JSON.stringify(obj)); } catch (e) {} };

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

attachWebSocket(server, '/ws', conn => {
  let room = null;
  let me = null;

  const bind = (r, p) => {
    room = r; me = p;
    r.attach(p, conn);
    send(conn, { type: 'welcome', code: r.code, id: p.id, token: p.token });
    r.broadcast();
  };

  conn.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ping') return send(conn, { type: 'pong' });

    try {
      if (msg.type === 'create') {
        if (me) return;
        const r = new Room(newCode(), send);
        rooms.set(r.code, r);
        if (msg.settings && typeof msg.settings === 'object') {
          // allow the host to carry over preferred settings
          const host = r.addPlayer({ name: msg.name, color: msg.color, spectator: !!msg.spectator });
          bind(r, host);
          for (const [key, value] of Object.entries(msg.settings)) r.handle(host, { type: 'settings', key, value });
        } else {
          bind(r, r.addPlayer({ name: msg.name, color: msg.color, spectator: !!msg.spectator }));
        }
        return;
      }
      if (msg.type === 'join') {
        if (me) return;
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) return send(conn, { type: 'error', msg: 'Room not found. Check the code.' });
        return bind(r, r.addPlayer({ name: msg.name, color: msg.color }));
      }
      if (msg.type === 'resume') {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        const p = r && r.players.find(x => x.token === msg.token);
        if (!p) return send(conn, { type: 'resumeFailed' });
        if (p.conn && p.conn !== conn) { try { p.conn.close(); } catch (e) {} }
        return bind(r, p);
      }
      if (!room || !me) return;
      if (msg.type === 'leave') {
        room.handle(me, msg);
        const r = room; room = null; me = null;
        send(conn, { type: 'left' });
        if (!r.players.length) rooms.delete(r.code);
        return;
      }
      room.handle(me, msg);
    } catch (e) {
      send(conn, { type: 'error', msg: e.message || 'Something went wrong.' });
    }
  });

  conn.on('close', () => {
    if (room && me && me.conn === conn) room.detach(me);
  });
});

// Game clock + cleanup of abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    try { r.tick(); } catch (e) { console.error(e); }
    const anyone = r.players.some(p => p.connected);
    if (!anyone && now - r.lastActivity > 15 * 60 * 1000) rooms.delete(code);
    if (!r.players.length) rooms.delete(code);
  }
}, 500).unref();

server.listen(PORT, () => console.log(`⚓ Word Fleet running on http://localhost:${PORT}`));

module.exports = { server, rooms };
