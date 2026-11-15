# 📚 OnixEdres API Documentation

> توثيق شامل لنظام OnixEdres للمحاسبة والمخزون وإدارة الشركات.

## 🎯 نظرة عامة

نظام **OnixEdres** هو نظام ERP متكامل يدعم:
- 🏢 **الشركات المتعددة** (Multi-tenant)
- 📊 **المحاسبة** (قيود، حسابات، تقارير)
- 📦 **المخزون** (منتجات، دفعات، مستودعات)
- 💰 **المالية** (فواتير، مدفوعات، مصروفات)
- 📄 **المستندات** (إشعارات، مذكرات، أذون)
- 🔗 **B2B** (شبكة موردين)
- 📱 **البوابات الخارجية** (عملاء، موردون)

## 📂 الأقسام

### 🏗️ [البنية المعمارية](./architecture/)
- [Journal Helper](./architecture/journal-helper.md) — أدوات القيود المحاسبية
- [Transaction Pattern](./architecture/transaction-pattern.md) — نمط المعاملات
- [Security](./architecture/security.md) — الأمان

### 📡 [API Reference](./api/)
- [Notes](./api/notes.md) — إشعارات مدين/دائن
- [Delivery Notes](./api/delivery-notes.md) — مذكرات التسليم
- [Stock Transfers](./api/stock-transfers.md) — أذون التحويل
- [Stock Adjustments](./api/stock-adjustments.md) — تسويات الجرد
- [Goods Receipts](./api/goods-receipts.md) — أذون الاستلام
- [Documents](./api/documents.md) — المستندات الموحدة
- [PDF](./api/pdf.md) — ملفات PDF
- [Settings](./api/settings.md) — الإعدادات

### 🗄️ [Database](./database/)
- [Schema](./database/schema.md) — الجداول
- [Migrations](./database/migrations.md) — ترتيب التشغيل

### 🚀 [Setup](./setup/)
- [Installation](./setup/installation.md) — التثبيت
- [Deployment](./setup/deployment.md) — النشر

## 🔐 المصادقة

كل الـ endpoints (ما عدا `/auth/login`) تتطلب: