
'use strict';

let app;

try {

  const express = require('express');
  const cors = require('cors');
  const helmet = require('helmet');
  const morgan = require('morgan');

  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./config/swagger');

  const {
    notFound,
    errorHandler,
  } = require('./middlewares/errorHandler');

  // ═══════════════════════════════════════════════════════
  // 2) Create Express App
  // ═══════════════════════════════════════════════════════

  app = express();


  // ═══════════════════════════════════════════════════════
  // 3) Security Middleware
  // ═══════════════════════════════════════════════════════

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // ═══════════════════════════════════════════════════════
  // 4) Global Middleware
  // ═══════════════════════════════════════════════════════

  app.use(cors());
  app.use(express.json());
  app.use(morgan('dev'));

  console.log('✅ [APP] Middlewares initialized');

  // ═══════════════════════════════════════════════════════
  // 5) Swagger Documentation
  // ═══════════════════════════════════════════════════════

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'OnixEdres API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'none',
        filter: true,
      },
    })
  );


  // ═══════════════════════════════════════════════════════
  // 6) Health Check
  // ═══════════════════════════════════════════════════════

  app.get('/health', (req, res) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
    });
  });

  // ═══════════════════════════════════════════════════════
  // 7) API Routes
  // ═══════════════════════════════════════════════════════

  console.log('📦 [APP] Loading API routes...');

  app.use('/api/v1', require('./routes'));

  console.log('✅ [APP] API routes loaded successfully');

  // ═══════════════════════════════════════════════════════
  // 8) Error Handling
  // ═══════════════════════════════════════════════════════

  app.use(notFound);
  app.use(errorHandler);

  console.log('✅ [APP] Error handlers initialized');

  // ═══════════════════════════════════════════════════════
  // Application Ready
  // ═══════════════════════════════════════════════════════

  console.log('🎉 [APP] Application initialized successfully');

} catch (error) {
  console.error('\n');
  console.error('════════════════════════════════════════════');
  console.error('❌ APPLICATION INITIALIZATION FAILED');
  console.error('════════════════════════════════════════════');

  console.error('📌 Error Name:', error?.name || 'Unknown');
  console.error('📌 Error Message:', error?.message || error);
  console.error('📌 Full Error Stack:');
  console.error(error?.stack || error);

  if (error?.details) {
    console.error('📌 Error Details:', error.details);
  }

  console.error('════════════════════════════════════════════');
  console.error('❌ Application startup aborted');
  console.error('════════════════════════════════════════════\n');

  // أوقف التشغيل حتى لا يعمل التطبيق بحالة غير سليمة
  throw error;
}

module.exports = app;