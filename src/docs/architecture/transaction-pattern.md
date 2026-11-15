
---

## 📁 `docs/architecture/transaction-pattern.md`

```markdown
# 🔄 Transaction Pattern — نمط المعاملات

## 🎯 المبدأ

كل عملية تُعدّل بيانات مالية/مخزنية يجب أن تكون **ذرّية** (atomic):
- إما **تنجح كلياً**
- أو **تفشل كلياً** (rollback)

## 🏗️ الهيكل

```javascript
async function operation(companyId, userId, payload) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قراءة + قفل
    // 2) تحققات
    // 3) تعديلات
    // 4) قيود محاسبية
    // 5) تحديثات

    await client.query('COMMIT');
    transactionStarted = false;

    return result;

  } catch (err) {
    // ✅ لا تُخفِ الخطأ الأصلي
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[operation] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}



---

## 1. POST /stock-transfers — إنشاء

### ماذا يرسل؟

```json
{
  "from_warehouse_id": "550e8400-e29b-41d4-a716-446655440000",
  "to_warehouse_id": "660e8400-e29b-41d4-a716-446655440000",
  "transfer_date": "2026-01-15",
  "notes": "تحويل بضاعة للمستودع الفرعي",
  "items": [
    {
      "product_id": "770e8400-e29b-41d4-a716-446655440000",
      "quantity": 20,
      "from_batch_id": "880e8400-e29b-41d4-a716-446655440000"
    }
  ]
}