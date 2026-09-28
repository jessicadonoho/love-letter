// Phone-to-phone networking over WebRTC using PeerJS (loaded as a global `Peer`).
// The host phone registers a peer ID derived from the room code; other phones
// connect straight to it. PeerJS's free public broker is only used for the
// initial handshake — game traffic flows directly between phones.

const PREFIX = 'loveletter-phones-';

/** Optional self-hosted broker: add ?peer=host:port to the URL (used for local dev/tests). */
function peerOptions() {
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: location.protocol === 'https:', debug: 1 };
}

export class Host {
  constructor(code, { onMessage, onJoin, onLeave, onStatus }) {
    Object.assign(this, { code, onMessage, onJoin, onLeave, onStatus });
    this.conns = new Set();
    this.destroyed = false;
  }

  start() {
    this.peer = new Peer(PREFIX + this.code, peerOptions());
    this.peer.on('open', () => this.onStatus('open'));
    this.peer.on('connection', (conn) => {
      conn.on('open', () => { this.conns.add(conn); this.onJoin?.(conn); });
      conn.on('data', (msg) => this.onMessage(conn, msg));
      conn.on('close', () => { this.conns.delete(conn); this.onLeave?.(conn); });
      conn.on('error', () => { this.conns.delete(conn); this.onLeave?.(conn); });
    });
    this.peer.on('disconnected', () => {
      if (!this.destroyed) setTimeout(() => this.peer && !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Usually the old host tab still holds the ID for a few seconds after a refresh.
        this.onStatus('id-taken');
        this.peer.destroy();
        if (!this.destroyed) setTimeout(() => this.start(), 3000);
      } else if (err.type !== 'peer-unavailable') {
        this.onStatus('error', err.type);
      }
    });
  }

  send(conn, msg) {
    if (conn.open) conn.send(msg);
  }

  destroy() {
    this.destroyed = true;
    this.peer?.destroy();
  }
}

export class Client {
  constructor(code, { onMessage, onStatus }) {
    Object.assign(this, { code, onMessage, onStatus });
    this.destroyed = false;
    this.conn = null;
  }

  start() {
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => this.connect());
    this.peer.on('disconnected', () => {
      if (!this.destroyed) setTimeout(() => this.peer && !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this.onStatus('no-host');
        this.retry();
      } else {
        this.onStatus('error', err.type);
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this.retry();
      }
    });
  }

  connect() {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on('open', () => this.onStatus('connected'));
    conn.on('data', (msg) => this.onMessage(msg));
    conn.on('close', () => { if (this.conn === conn) { this.onStatus('lost'); this.retry(); } });
    conn.on('error', () => { if (this.conn === conn) { this.onStatus('lost'); this.retry(); } });
  }

  retry() {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.peer.disconnected) this.peer.reconnect();
      if (this.peer.open) this.connect();
    }, 2500);
  }

  send(msg) {
    if (this.conn?.open) { this.conn.send(msg); return true; }
    return false;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.peer?.destroy();
  }
}
