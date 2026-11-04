const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  console.warn('[ws] JWT_SECRET غير معرّف — WebSocket معطل');
}

/**
 * مدير اتصالات WebSocket.
 * كل شركة لها مجموعة اتصالات (مستخدمون متعددون).
 */
class WebSocketService {
  constructor() {
    this.wss = null;
    /** Map<companyId, Set<WebSocket>> */
    this.connections = new Map();
    /** Map<userId, Set<WebSocket>> */
    this.userConnections = new Map();
  }

  /**
   * يُهيئ WebSocket على HTTP server.
   */
  init(httpServer) {
    if (!SECRET) return;

    this.wss = new WebSocketServer({ noServer: true });

    // معالجة upgrade يدوياً لتمرير المصادقة
    httpServer.on('upgrade', (req, socket, head) => {
      // فقط مسار /ws
      const { pathname } = url.parse(req.url);
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }

      // قراءة التوكن
      let token = null;
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      } else {
        // أو من query
        const parsed = url.parse(req.url, true);
        token = parsed.query?.token || null;
      }

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let payload;
      try {
        payload = jwt.verify(token, SECRET);
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // التحقق من company_id
      const companyId = payload.company_id || payload.companyId;
      const userId = payload.id || payload.userId;
      if (!companyId) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      req.user = { id: userId, company_id: companyId, email: payload.email };

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => {
      const { company_id, id } = req.user;

      // سجل الاتصال
      if (!this.connections.has(company_id)) {
        this.connections.set(company_id, new Set());
      }
      this.connections.get(company_id).add(ws);

      if (!this.userConnections.has(id)) {
        this.userConnections.set(id, new Set());
      }
      this.userConnections.get(id).add(ws);

      console.log(`[ws] connected: user=${id} company=${company_id}`);

      // Ping/pong لمراقبة الحياة
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      // إرسال تأكيد الاتصال
      ws.send(JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
      }));

      // استقبال رسائل من العميل (ping يدوي)
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch {
          /* silent */
        }
      });

      ws.on('close', () => {
        this.connections.get(company_id)?.delete(ws);
        this.userConnections.get(id)?.delete(ws);
        console.log(`[ws] disconnected: user=${id} company=${company_id}`);
      });

      ws.on('error', (err) => {
        console.error('[ws] error:', err.message);
      });
    });

    // Heartbeat كل 30 ثانية
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    console.log('[ws] ✅ WebSocket server ready at /ws');
  }

  /**
   * يُرسل إشعاراً لكل اتصالات شركة معينة.
   */
  emitToCompany(companyId, payload) {
    const sockets = this.connections.get(companyId);
    if (!sockets || sockets.size === 0) return 0;

    const message = JSON.stringify(payload);
    let sent = 0;
    for (const ws of sockets) {
      if (ws.readyState === 1 /* OPEN */) {
        try {
          ws.send(message);
          sent++;
        } catch (err) {
          console.error('[ws] send error:', err.message);
        }
      }
    }
    return sent;
  }

  /**
   * يُرسل إشعاراً لمستخدم معين (كل اتصالاته).
   */
  emitToUser(userId, payload) {
    const sockets = this.userConnections.get(userId);
    if (!sockets || sockets.size === 0) return 0;

    const message = JSON.stringify(payload);
    let sent = 0;
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        try {
          ws.send(message);
          sent++;
        } catch (err) {
          console.error('[ws] send error:', err.message);
        }
      }
    }
    return sent;
  }

  /**
   * إحصائيات للصحة.
   */
  stats() {
    return {
      companies: this.connections.size,
      users: this.userConnections.size,
      total: this.wss ? this.wss.clients.size : 0,
    };
  }
}

module.exports = new WebSocketService();