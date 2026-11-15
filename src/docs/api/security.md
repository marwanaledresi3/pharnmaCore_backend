
---

## 📁 `docs/architecture/security.md`

```markdown
# 🔒 Security — الأمان

## 🎯 المبادئ

1. **Multi-tenancy:** كل استعلام يقيّد بـ `company_id`
2. **Authorization:** كل endpoint محمي بـ `authorize(...)`
3. **Validation:** كل input يتحقق قبل الاستخدام
4. **Audit:** كل تعديل مسجّل

## 🏢 1. Multi-tenancy

**القاعدة:** **لا استعلام بدون `company_id`**

### ❌ خطأ
```javascript
const invoice = await client.query(
  `SELECT * FROM invoices WHERE id = $1`,
  [id]
);