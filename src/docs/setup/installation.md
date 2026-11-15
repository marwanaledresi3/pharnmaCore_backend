# 🚀 Installation

## المتطلبات

| # | المتطلب | الإصدار |
|---|---------|---------|
| 1 | Node.js | 20+ |
| 2 | npm | 10+ |
| 3 | PostgreSQL | 15+ |
| 4 | Git | اختياري |

---

## خطوات التثبيت

### 1. استنساخ المشروع

    git clone <repo-url>
    cd pharnmaCore

### 2. تثبيت المكتبات

    npm install

**المكتبات الرئيسية:**

- `express` — السيرفر.
- `pg` — PostgreSQL.
- `jsonwebtoken` — JWT.
- `bcrypt` — كلمات المرور.
- `cloudinary` — الشعار.
- `pdfkit` — PDF.
- `swagger-jsdoc`, `swagger-ui-express` — التوثيق.

### 3. إعداد `.env`

انسخ `.env.example` إلى `.env`:

    cp .env.example .env

**عدّل القيم حسب بيئتك:**

    # Database
    DATABASE_URL=postgresql://user:password@host:5432/pharmacore_db

    # Server
    PORT=5000
    NODE_ENV=development

    # JWT
    JWT_SECRET=your-super-secret-key-min-32-chars
    JWT_EXPIRES_IN=7d

    # Cloudinary (للشعار)
    CLOUDINARY_CLOUD_NAME=your-cloud
    CLOUDINARY_API_KEY=your-key
    CLOUDINARY_API_SECRET=your-secret

    # Frontend (لـ CORS و QR)
    FRONTEND_URL=http://localhost:5173

**⚠️ لا ترفع `.env` إلى Git.**

### 4. إعداد قاعدة البيانات

#### 4.1. إنشاء قاعدة البيانات

    createdb pharmacore_db

#### 4.2. تطبيق Schema الأساسي

    psql -U postgres -d pharmacore_db -f databaseOnixEdresSchema_2026_11_09.sql

#### 4.3. تطبيق Migrations

**Windows (PowerShell):**

    Get-ChildItem migrations/2026_11_*.sql | Sort-Object Name | ForEach-Object {
      Write-Host "Applying $_..."
      psql -U postgres -d pharmacore_db -f $_.FullName
    }

**Linux/Mac:**

    for f in migrations/2026_11_*.sql; do
      echo "Applying $f..."
      psql -U postgres -d pharmacore_db -f "$f"
    done

#### 4.4. إعداد الصلاحيات

    node scripts/seed-permissions.js

#### 4.5. إعدادات النظام

    node scripts/migrate-settings.js

#### 4.6. بيانات تجريبية (اختياري)

    node scripts/seed.js

### 5. تشغيل السيرفر

#### Development

    npm run dev

يُفترض أن يظهر ما يشبه:

    🚀 Server running on http://localhost:5000
    WebSocket: ws://localhost:5000/ws

#### Production

    npm start

### 6. التحقق من التشغيل

#### 6.1. Health Check

    curl http://localhost:5000/health

مثال على الاستجابة المتوقعة:

    {
      "status": "OK",
      "timestamp": "2026-01-15T10:00:00.000Z"
    }

#### 6.2. Swagger UI

افتح المتصفح على:

    http://localhost:5000/api-docs

يُفترض أن تظهر:

- صفحة Swagger.
- عمليات API الموثقة.
- زر **Authorize** للمصادقة.

#### 6.3. تسجيل الدخول

    curl -X POST http://localhost:5000/api/v1/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email": "admin@example.com", "password": "password"}'

مثال توضيحي لشكل الاستجابة:

    {
      "success": true,
      "token": "eyJhbGciOiJIUzI1NiIs...",
      "user": {
        "id": "uuid",
        "name": "Admin",
        "roles": ["Owner"]
      }
    }

---

## حل المشاكل

### مشكلة 1: `ETIMEDOUT` لقاعدة البيانات

**السبب المحتمل:** تفضيل IPv6 مع عدم دعم الشبكة له.

**حل محتمل:** ضبط أولوية IPv4 في `config/pool.js`:

    const dns = require('node:dns');
    dns.setDefaultResultOrder('ipv4first');

    const { Pool } = require('pg');

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });

استخدم إعداد SSL المناسب لمزود قاعدة البيانات، ولا تعطّل التحقق من الشهادة دون فهم أثر ذلك الأمني.

**أو** أضف معامل SSL إلى رابط الاتصال عند الحاجة:

    DATABASE_URL=postgresql://user:password@host:5432/db?sslmode=require

### مشكلة 2: Swagger لا يعمل

تحقق من:

1. وجود `config/swagger.js`.
2. وجود ربط Swagger داخل `app.js`:

       app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

3. إعدادات `helmet` وسياسة Content Security Policy.
4. وجود تعليقات `@swagger` في ملفات المسارات `routes/*.js`.

### مشكلة 3: `Cannot find module`

أعد تثبيت المكتبات:

    npm install

أو استخدم:

    npm ci

### مشكلة 4: `password authentication failed`

تحقق من:

1. صحة `DATABASE_URL`.
2. وجود مستخدم PostgreSQL.
3. صحة كلمة المرور.
4. صحة بيانات الاتصال واسم قاعدة البيانات.

### مشكلة 5: `Too many clients already`

**السبب المحتمل:** امتلاء Connection Pool.

راجع إعدادات `config/pool.js`، ويمكن ضبطها مثلاً كالتالي:

    const pool = new Pool({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

اختر قيمة `max` وفق حدود الاتصالات المتاحة في قاعدة البيانات وعدد نسخ التطبيق.

---

## Checklist

- [ ] Node.js 20+ مثبت.
- [ ] PostgreSQL 15+ متاح.
- [ ] ملف `.env` معد.
- [ ] قاعدة البيانات موجودة.
- [ ] Schema الأساسي مطبق.
- [ ] Migrations مطبقة بالترتيب.
- [ ] Permissions مهيأة.
- [ ] Settings مهيأة.
- [ ] السيرفر يعمل.
- [ ] `/health` يعمل.
- [ ] `/api-docs` يعمل.
- [ ] تسجيل الدخول يعمل.

---

## ملاحظات مهمة

1. لا ترفع ملف `.env` إلى Git.
2. استخدم `JWT_SECRET` قوياً، ولا تستخدم قيمة تجريبية في الإنتاج.
3. استخدم HTTPS في بيئة الإنتاج.
4. اضبط SSL وفق متطلبات مزود قاعدة البيانات.
5. خذ نسخة احتياطية قبل تطبيق أي Migration.
6. اختبر استعادة النسخ الاحتياطية دورياً.
7. لا تشغّل `scripts/seed.js` في قاعدة الإنتاج قبل مراجعة تأثيره.
8. تأكد من أن ملفات Schema وMigrations تطابق نسخة المشروع الحالية.
9. لا تعتبر أمثلة الاستجابات أعلاه بيانات دخول حقيقية.
10. راجع إعدادات الاتصال والصلاحيات قبل إتاحة النظام للمستخدمين.