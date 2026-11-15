
---

## 📁 `docs/architecture/journal-helper.md`

```markdown
# 🔧 Journal Helper — أدوات القيود المحاسبية

## 🎯 الهدف

`services/journalHelper.js` — **طبقة أمان** لكل عملية تُنشئ قيداً محاسبياً.

**المبدأ:** *"لا قيد بدون توازن مضمون"*

## 📋 الدوال

### 1. `assertBalanced(lines, context)`

**الغرض:** التحقق من توازن السطور **قبل** الإنشاء.

```javascript
const { assertBalanced } = require('./journalHelper');

const lines = [
  { account_id: acc1, debit: 100, credit: 0 },
  { account_id: acc2, debit: 0, credit: 100 },
];

assertBalanced(lines, 'في الفاتورة');
// ✅ يمر

// ⚠️ إذا:
// - أقل من 2 سطر
// - debit != credit
// - سطر بدون debit/credit
// - سطر بـ debit و credit معاً
// → يرمي ApiError(400)