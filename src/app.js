const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// ✅ 1) helmet أولاً — مع استثناء Swagger من CSP
app.use(helmet({
  contentSecurityPolicy: false,  // ⚠️ الأبسط — يعطّل CSP كلياً
  // أو استخدم الحل المتقدم بالأسفل
}));

// ✅ 2) بقية الميدلوير
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ✅ 3) Swagger UI — بعد helmet
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'OnixEdres API Docs',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true,
  },
}));

app.get('/health', (req, res) =>
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
);

// ✅ 4) Routes
app.use('/api/v1', require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;