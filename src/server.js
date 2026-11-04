require('dotenv').config();
const app = require('./app');
const {start} = require('./jobs/notificationJob');
const { cleanup } = require('./jobs/cleanupReservations');
const http = require('http');
const WebSocketService = require('./services/websocketService');
// كل ساعة
setInterval(cleanup, 60 * 60 * 1000);
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
// ← تهيئة WebSocket
WebSocketService.init(server);
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
  start();
});


