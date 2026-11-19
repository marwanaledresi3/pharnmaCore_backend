// server.js
'use strict';

require('dotenv').config();

const app = require('./app');
const jobs = require('./jobs');
const { pool } = require('./config/pool');

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ═══════════════════════════════════════════════════════════════
// Global Error Handlers (قبل أي شيء)
// ═══════════════════════════════════════════════════════════════

process.on('uncaughtException', (err) => {
  console.error('\n════════════════════════════════════════════');
  console.error('❌ UNCAUGHT EXCEPTION');
  console.error('════════════════════════════════════════════');
  console.error('Name:',    err?.name);
  console.error('Message:', err?.message);
  console.error('Stack:',   err?.stack);
  console.error('════════════════════════════════════════════\n');

  // في الإنتاج: أوقف التطبيق (حالة غير معروفة)
  if (NODE_ENV === 'production') {
    shutdown('uncaughtException', 1);
  }
  // في التطوير: استمر (nodemon سيعيد التشغيل عند الحفظ)
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n════════════════════════════════════════════');
  console.error('❌ UNHANDLED REJECTION');
  console.error('════════════════════════════════════════════');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('════════════════════════════════════════════\n');

  if (NODE_ENV === 'production') {
    shutdown('unhandledRejection', 1);
  }
});

// ═══════════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════════

let server = null;
let shuttingDown = false;

const start = async () => {
  try {
    // 1) فحص الاتصال بـ DB
    console.log('🔌 [SERVER] Checking database connection...');
    const { rows } = await pool.query('SELECT NOW() AS now');
    console.log(`✅ [SERVER] Database connected — ${rows[0].now.toISOString()}`);

    // 2) بدء HTTP server
    server = app.listen(PORT, () => {
      console.log('\n════════════════════════════════════════════');
      console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
      console.log(`📚 Swagger: http://localhost:${PORT}/api-docs`);
      console.log(`❤️  Health:  http://localhost:${PORT}/health`);
      console.log('════════════════════════════════════════════\n');

      // 3) بدء الـ jobs (بعد listen — لضمان أن HTTP جاهز)
      if (NODE_ENV !== 'test' && process.env.DISABLE_JOBS !== 'true') {
        console.log('⏰ [SERVER] Starting background jobs...');
        jobs.startAll();
      } else {
        console.log('⏸️  [SERVER] Background jobs disabled');
      }
    });

    // 4) مهلة الاتصال
    server.timeout = 120_000; // 2 دقيقة

  } catch (err) {
    console.error('❌ [SERVER] Failed to start:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
};

// ═══════════════════════════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════════════════════════

const shutdown = async (signal = 'SIGTERM', exitCode = 0) => {
  if (shuttingDown) {
    console.log(`[SERVER] Shutdown already in progress — ignoring ${signal}`);
    return;
  }
  shuttingDown = true;

  console.log(`\n📴 [SERVER] Received ${signal} — shutting down...`);

  const forceTimeout = setTimeout(() => {
    console.error('⏰ [SERVER] Forced shutdown after 15s');
    process.exit(1);
  }, 15_000);

  try {
    // 1) إيقاف الـ jobs أولاً
    try {
      jobs.stopAll();
      console.log('✅ [SERVER] Jobs stopped');
    } catch (e) {
      console.error('⚠️  [SERVER] Jobs stop failed:', e.message);
    }

    // 2) إغلاق HTTP server
    if (server) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) console.error('⚠️  [SERVER] HTTP close error:', err.message);
          else     console.log('✅ [SERVER] HTTP server closed');
          resolve();
        });
      });
    }

    // 3) إغلاق pool
    try {
      await pool.end();
      console.log('✅ [SERVER] DB pool closed');
    } catch (e) {
      console.error('⚠️  [SERVER] Pool close failed:', e.message);
    }

    clearTimeout(forceTimeout);
    console.log('✅ [SERVER] Shutdown complete\n');
    process.exit(exitCode);

  } catch (err) {
    console.error('❌ [SERVER] Shutdown error:', err.message);
    clearTimeout(forceTimeout);
    process.exit(1);
  }
};

// ═══════════════════════════════════════════════════════════════
// Signal Handlers
// ═══════════════════════════════════════════════════════════════

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT',  () => shutdown('SIGINT',  0));

// ═══════════════════════════════════════════════════════════════
// Go
// ═══════════════════════════════════════════════════════════════

start();

module.exports = { start, shutdown };