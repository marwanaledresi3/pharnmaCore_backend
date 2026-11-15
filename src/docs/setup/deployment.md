# 🌐 Deployment

## المنصات المدعومة

| المنصة | مستوى الصعوبة | قاعدة البيانات | المميزات |
|---|---|---|---|
| **Render** | ⭐ | Neon | إعداد ونشر سهل |
| **Railway** | ⭐⭐ | PostgreSQL | سريع ومرن |
| **Fly.io** | ⭐⭐⭐ | PostgreSQL | توزيع عالمي |
| **DigitalOcean** | ⭐⭐ | Managed DB | إدارة موثوقة |
| **AWS ECS** | ⭐⭐⭐⭐ | RDS | بنية احترافية |
| **VPS** | ⭐⭐⭐ | Self-hosted | تحكم كامل |

---

## 1. Render

### 1.1. نشر Backend

من Render Dashboard:

1. اختر **New → Web Service**.
2. اربط مستودع GitHub الخاص بالـ Backend.
3. اضبط الإعدادات:

| الإعداد | القيمة |
|---|---|
| Environment | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

### 1.2. متغيرات البيئة

أضف المتغيرات التالية من إعدادات الخدمة:

    NODE_ENV=production
    PORT=5000
    JWT_SECRET=<strong-secret>
    DATABASE_URL=<from-Neon>
    FRONTEND_URL=https://your-frontend.com

أضف بقية المتغيرات المطلوبة حسب إعدادات المشروع، مثل بيانات Cloudinary عند استخدام رفع الشعارات.

لا تضع أسرار الإنتاج داخل ملفات Git.

### 1.3. قاعدة البيانات Neon

1. أنشئ مشروعاً في Neon.
2. أنشئ قاعدة البيانات المطلوبة.
3. انسخ رابط الاتصال `DATABASE_URL`.
4. أضفه إلى Environment Variables في Render.
5. تأكد من إعداد SSL وفق متطلبات Neon.

### 1.4. تطبيق Schema وMigrations

قبل تشغيل التطبيق على قاعدة إنتاج جديدة:

1. خذ نسخة احتياطية إذا كانت القاعدة تحتوي على بيانات.
2. طبّق ملف Schema الأساسي.
3. طبّق ملفات Migrations بالترتيب.
4. نفّذ إعداد الصلاحيات والإعدادات بعد مراجعة تأثير scripts.

مثال على تنفيذ ملفات Migrations من بيئة تحتوي على PostgreSQL Client:

    for f in migrations/2026_11_*.sql; do
      echo "Applying $f..."
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    done

إعداد الصلاحيات:

    node scripts/seed-permissions.js

إعدادات النظام:

    node scripts/migrate-settings.js

**ملاحظة:** لا تفترض أن Render Shell يحتوي على جميع الأدوات المطلوبة. يمكن تنفيذ أوامر قاعدة البيانات من جهاز إداري آمن لديه اتصال بقاعدة Neon.

### 1.5. التحقق بعد النشر

    curl https://your-app.onrender.com/health

ثم تحقق من واجهة Swagger إذا كانت مفعلة:

    https://your-app.onrender.com/api-docs

---

## 2. Railway

### 2.1. تثبيت Railway CLI

    npm install -g @railway/cli

### 2.2. تسجيل الدخول وإنشاء المشروع

    railway login
    railway init

### 2.3. إضافة PostgreSQL

    railway add postgresql

### 2.4. إعداد متغيرات البيئة

    railway variables set NODE_ENV=production
    railway variables set JWT_SECRET=your-strong-secret

تأكد من ضبط `DATABASE_URL` وفق طريقة الربط التي توفرها Railway، ولا تستبدل رابط قاعدة بيانات قائم دون التأكد من قاعدة البيانات المقصودة.

### 2.5. نشر التطبيق

    railway up

### 2.6. تطبيق Schema وMigrations

نفّذ Schema الأساسي أولاً على قاعدة البيانات المستهدفة:

    railway run psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f databaseOnixEdresSchema_2026_11_09.sql

ثم نفّذ Migrations بالترتيب:

    railway run bash -c 'for f in migrations/2026_11_*.sql; do echo "Applying $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1; done'

ثم إعداد الصلاحيات والإعدادات بعد مراجعة scripts:

    railway run node scripts/seed-permissions.js
    railway run node scripts/migrate-settings.js

---

## 3. Docker

### 3.1. إنشاء Dockerfile

أنشئ ملفاً باسم `Dockerfile` في جذر المشروع:

    FROM node:20-alpine

    WORKDIR /app

    COPY package*.json ./
    RUN npm ci --omit=dev

    COPY . .

    ENV NODE_ENV=production

    EXPOSE 5000

    CMD ["node", "server.js"]

**ملاحظات:**

- تأكد أن `server.js` هو ملف تشغيل التطبيق الفعلي.
- إذا كان المشروع يستخدم ملف تشغيل آخر، عدّل `CMD`.
- لا تنسخ ملفات الأسرار أو `.env` إلى الصورة.
- يفضّل إضافة مستخدم غير root وتشغيل التطبيق بصلاحيات محدودة قبل اعتماد الصورة للإنتاج.

### 3.2. إنشاء `.dockerignore`

    node_modules
    npm-debug.log
    .git
    .env
    .env.*
    coverage
    logs
    *.log

### 3.3. إنشاء docker-compose.yml

    services:
      db:
        image: postgres:15
        restart: unless-stopped
        environment:
          POSTGRES_DB: pharmacore_db
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        volumes:
          - pgdata:/var/lib/postgresql/data
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U postgres -d pharmacore_db"]
          interval: 5s
          timeout: 5s
          retries: 5

      api:
        build: .
        restart: unless-stopped
        environment:
          DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/pharmacore_db
          JWT_SECRET: ${JWT_SECRET}
          NODE_ENV: production
          PORT: 5000
        ports:
          - "5000:5000"
        depends_on:
          db:
            condition: service_healthy

    volumes:
      pgdata:

### 3.4. إعداد ملف `.env` الخاص بـ Docker

    POSTGRES_PASSWORD=replace-with-strong-password
    JWT_SECRET=replace-with-strong-secret

لا ترفع هذا الملف إلى Git.

### 3.5. البناء والتشغيل

    docker compose build
    docker compose up -d

### 3.6. تطبيق Schema وMigrations

تأكد من وجود PostgreSQL Client في الحاوية التي ستنفذ منها الأوامر.

مثال:

    docker compose exec api sh -c 'for f in migrations/2026_11_*.sql; do echo "Applying $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1; done'

إعداد الصلاحيات:

    docker compose exec api node scripts/seed-permissions.js

إعدادات النظام:

    docker compose exec api node scripts/migrate-settings.js

إذا لم تتوفر أداة `psql` داخل حاوية API، نفّذ عمليات قاعدة البيانات من حاوية PostgreSQL أو جهاز إداري مناسب.

---

## 4. VPS

### 4.1. المتطلبات

مثال على Ubuntu 22.04:

    sudo apt update
    sudo apt install -y nginx postgresql git curl

ثبّت إصدار Node.js 20 أو أحدث من مصدر موثوق، وتحقق من الإصدارات:

    node --version
    npm --version
    psql --version

### 4.2. إعداد PostgreSQL

افتح واجهة PostgreSQL:

    sudo -u postgres psql

أنشئ قاعدة البيانات والمستخدم:

    CREATE DATABASE pharmacore_db;
    CREATE USER pharmacore WITH PASSWORD 'replace-with-strong-password';
    GRANT ALL PRIVILEGES ON DATABASE pharmacore_db TO pharmacore;
    \q

قد تحتاج إلى منح صلاحيات إضافية على Schema والجداول وفق إصدار PostgreSQL وطريقة تشغيل التطبيق.

### 4.3. تنزيل المشروع

    sudo mkdir -p /var/www/pharmacore
    sudo chown "$USER":"$USER" /var/www/pharmacore

    cd /var/www
    git clone <repo-url> pharmacore
    cd pharmacore

ثبّت مكتبات الإنتاج:

    npm ci --omit=dev

### 4.4. إعداد متغيرات البيئة

أنشئ ملف `.env` في جذر المشروع واضبط:

    NODE_ENV=production
    PORT=5000
    DATABASE_URL=postgresql://pharmacore:password@localhost:5432/pharmacore_db
    JWT_SECRET=replace-with-strong-secret
    FRONTEND_URL=https://your-frontend.com

اضبط بقية المتغيرات المطلوبة بحسب المشروع.

### 4.5. تطبيق Schema وMigrations

خذ نسخة احتياطية قبل أي تعديل على قاعدة بيانات تحتوي على بيانات.

طبّق Schema الأساسي:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f databaseOnixEdresSchema_2026_11_09.sql

ثم Migrations بالترتيب:

    for f in migrations/2026_11_*.sql; do
      echo "Applying $f..."
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1
    done

ثم نفّذ scripts الإعداد بعد مراجعتها:

    node scripts/seed-permissions.js
    node scripts/migrate-settings.js

### 4.6. تشغيل التطبيق باستخدام PM2

ثبّت PM2:

    npm install -g pm2

أنشئ `ecosystem.config.js`:

    module.exports = {
      apps: [
        {
          name: 'pharmacore',
          script: 'server.js',
          instances: 1,
          exec_mode: 'fork',
          env: {
            NODE_ENV: 'production',
            PORT: 5000,
          },
        },
      ],
    };

شغّل التطبيق:

    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup

نفّذ أمر `pm2 startup` الذي يظهر لك لحفظ التشغيل التلقائي بعد إعادة تشغيل الخادم.

### 4.7. إعداد Nginx

أنشئ ملفاً باسم:

    /etc/nginx/sites-available/pharmacore

مثال للإعداد:

    server {
        listen 80;
        server_name api.example.com;

        location / {
            proxy_pass http://127.0.0.1:5000;
            proxy_http_version 1.1;

            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;

            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

فعّل الموقع:

    sudo ln -s /etc/nginx/sites-available/pharmacore /etc/nginx/sites-enabled/pharmacore
    sudo nginx -t
    sudo systemctl reload nginx

### 4.8. إعداد SSL باستخدام Let's Encrypt

ثبّت Certbot:

    sudo apt install -y certbot python3-certbot-nginx

أصدر شهادة SSL:

    sudo certbot --nginx -d api.example.com

استبدل `api.example.com` باسم النطاق الفعلي الموجّه إلى الخادم.

---

## Checklist الإنتاج

### Security

- [ ] `NODE_ENV=production`.
- [ ] `JWT_SECRET` قوي وغير مكشوف.
- [ ] HTTPS مفعل.
- [ ] CORS محدود للنطاقات المصرح بها.
- [ ] Rate Limiting مفعل.
- [ ] Helmet مضبوط.
- [ ] اتصال قاعدة البيانات مؤمن.
- [ ] `.env` غير مرفوع إلى Git.
- [ ] صلاحيات ملفات الخادم محدودة.
- [ ] لا توجد بيانات دخول افتراضية.

### Database

- [ ] النسخة الاحتياطية موجودة.
- [ ] Schema الأساسي مطبق.
- [ ] Migrations مطبقة بالترتيب.
- [ ] الفهارس والقيود متحققة.
- [ ] Connection Pool مضبوط.
- [ ] اختبار استعادة النسخة الاحتياطية ناجح.
- [ ] صلاحيات المستخدم محدودة حسب الحاجة.

### Monitoring

- [ ] Health Check يعمل.
- [ ] تسجيل الأخطاء مفعل.
- [ ] مراقبة توفر الخدمة مفعلة.
- [ ] تنبيهات الأعطال مهيأة.
- [ ] سجلات التطبيق قابلة للمراجعة.
- [ ] مراقبة استهلاك الذاكرة والمعالج.

### Performance

- [ ] ضغط الاستجابات مفعل عند الحاجة.
- [ ] Caching مضبوط عند الحاجة.
- [ ] الصور محسنة.
- [ ] استعلامات قاعدة البيانات مراجعة.
- [ ] Connection Pool مناسب لحجم الخدمة.
- [ ] CDN مستخدم للأصول الثابتة عند الحاجة.

### Backup

- [ ] نسخة احتياطية يومية أو وفق سياسة العمل.
- [ ] النسخ محفوظة خارج الخادم الأساسي.
- [ ] مدة الاحتفاظ بالنسخ محددة.
- [ ] اختبار الاستعادة دوري.
- [ ] النسخ الاحتياطية محمية من الوصول غير المصرح به.

---

## أوامر مساعدة

### التحقق من حالة التطبيق

محلياً:

    curl http://localhost:5000/health

في الإنتاج:

    curl https://api.example.com/health

### عرض Logs

Render:

    render logs -s your-service

Railway:

    railway logs

PM2:

    pm2 logs pharmacore

Docker:

    docker compose logs -f api

### إعادة تشغيل التطبيق

PM2:

    pm2 restart pharmacore

Docker:

    docker compose restart api

### نسخ احتياطي لقاعدة البيانات

نسخة احتياطية:

    pg_dump "$DATABASE_URL" -Fc -f backup.dump

استعادة نسخة احتياطية:

    pg_restore --clean --if-exists -d "$DATABASE_URL" backup.dump

**تحذير:** الاستعادة قد تستبدل أو تحذف كائنات وبيانات موجودة. لا تستخدم خيارات التنظيف على قاعدة إنتاج قبل التأكد من النسخة الاحتياطية والهدف.

---

## ملاحظات مهمة

1. لا ترفع `.env` إلى Git.
2. استخدم أسراراً قوية ومختلفة لكل بيئة.
3. HTTPS ضروري في الإنتاج.
4. اضبط SSL وفق متطلبات مزود قاعدة البيانات.
5. خذ نسخة احتياطية قبل تنفيذ Migrations.
6. اختبر استعادة النسخ الاحتياطية.
7. لا تنفذ Scripts الخاصة بالبيانات التجريبية على قاعدة الإنتاج دون مراجعتها.
8. تأكد من ترتيب Migrations وعدم تخطي ملفات مطلوبة.
9. لا تفترض أن كل منصة توفر `psql` أو أدوات النظام نفسها.
10. استخدم مدير عمليات مثل PM2 عند النشر اليدوي على VPS.
11. استخدم Nginx كـ Reverse Proxy عند الحاجة.
12. راقب أداء التطبيق وقاعدة البيانات باستمرار.

---

## ملاحظة خاصة بمشروع PharmaCore

إعدادات النشر يجب أن تتوافق مع ملفات المشروع الفعلية، خصوصاً:

- `package.json`
- `server.js`
- `app.js`
- `config/pool.js`
- `config/swagger.js`
- `migrations/`
- `scripts/`

تأكد من أن مسارات Health Check وSwagger وأوامر التشغيل تتطابق مع التنفيذ الفعلي قبل اعتماد هذا الدليل.