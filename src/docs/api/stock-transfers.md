# ⇄ Stock Transfers API — أذون التحويل

## ما هو إذن التحويل؟

إذن التحويل هو مستند لنقل المخزون من مستودع إلى مستودع آخر داخل الشركة.

**متى نستخدمه؟**
- نقل بضاعة من المستودع الرئيسي للفرعي.
- توزيع بضاعة بين الفروع.
- تجميع بضاعة من عدة مستودعات.

---

## دورة الحياة

    draft ──(confirm)──> confirmed ──(cancel)──> cancelled
      │                      │
      └──(cancel)──> cancelled

| من | إلى | الإجراء |
|---|---|---|
| draft | confirmed | `POST /stock-transfers/:id/confirm` |
| draft | cancelled | `POST /stock-transfers/:id/cancel` |
| confirmed | cancelled | `POST /stock-transfers/:id/cancel` مع عكس الحركات |

---

## 1. POST /stock-transfers — إنشاء إذن تحويل

### ما هو؟
ينشئ إذن تحويل بحالة مسودة (draft).

### الصلاحية
`stock_transfers.create`

### ماذا يرسل؟

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

### شرح الحقول

| الحقل | مطلوب؟ | القيمة |
|---|---|---|
| `from_warehouse_id` | نعم | UUID (المصدر) |
| `to_warehouse_id` | نعم | UUID (الوجهة) |
| `transfer_date` | اختياري | YYYY-MM-DD (افتراضي: اليوم) |
| `notes` | اختياري | نص |
| `items` | نعم | بند واحد على الأقل |
| `items.*.product_id` | نعم | UUID |
| `items.*.quantity` | نعم | أكبر من صفر |
| `items.*.from_batch_id` | اختياري | UUID (لتحديد دفعة معينة) |

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "transfer_number": "TRF-0001",
        "transfer_date": "2026-01-15",
        "status": "draft",
        "from_warehouse_name": "الرئيسي",
        "to_warehouse_name": "الفرعي",
        "items": []
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `Source and destination warehouses are required` |
| 400 | `Source and destination warehouses must be different` |
| 400 | `At least one item is required` |
| 400 | `Batch X not found in source warehouse or insufficient quantity` |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/stock-transfers \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{
        "from_warehouse_id": "550e8400-...",
        "to_warehouse_id": "660e8400-...",
        "items": [
          {
            "product_id": "770e8400-...",
            "quantity": 20
          }
        ]
      }'

---

## 2. POST /stock-transfers/:id/confirm — تأكيد التحويل

### ما هو؟
ينفذ التحويل فعلياً وينقل الكميات بين المستودعين.

### ماذا يحدث؟

1. خصم الكمية من المستودع المصدر.
2. استخدام FIFO إذا لم تُحدد دفعة معينة.
3. إضافة الكمية إلى المستودع الوجهة.
4. إنشاء دفعة جديدة أو تحديث دفعة موجودة حسب آلية النظام.
5. تسجيل حركات المخزون `stock_movements` بنوعي `transfer_out` و`transfer_in`.
6. تحديث حالة الإذن إلى `confirmed`.

### الصلاحية
`stock_transfers.confirm`

### ماذا يرسل؟
لا شيء، فقط `id` في URL.

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "transfer_number": "TRF-0001",
        "status": "confirmed",
        "confirmed_at": "2026-01-15T15:30:00Z"
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 404 | `Transfer not found` |
| 400 | `Transfer is already confirmed` |
| 400 | `Transfer is cancelled` |
| 400 | `Insufficient quantity in batch X` |
| 400 | `Insufficient stock for product X. Missing: 5` |
| 409 | `فشل التأكيد — قد يكون معدّلاً من عملية أخرى` |

### مثال

    curl -X POST http://localhost:5000/api/v1/stock-transfers/abc-123/confirm \
      -H "Authorization: Bearer <TOKEN>"

---

## 3. POST /stock-transfers/:id/cancel — إلغاء التحويل

### ما هو؟
يلغي إذن التحويل.

- إذا كان draft: إلغاء بسيط دون حركات مخزون.
- إذا كان confirmed: عكس حركات المخزون باستخدام `getTransferMovements` و`reverseTransferMovements`.

### الصلاحية
`stock_transfers.cancel`

### ماذا يرسل؟

    {
      "reason": "خطأ في الكمية"
    }

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "cancelled": true,
        "reversed": true
      }
    }

### الأخطاء

| الكود | الرسالة |
|---|---|
| 404 | `Transfer not found` |
| 400 | `Already cancelled` |
| 400 | `Cannot reverse: insufficient quantity in batch X` |

### مثال

    curl -X POST http://localhost:5000/api/v1/stock-transfers/abc-123/cancel \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{"reason": "خطأ في الكمية"}'

---

## 4. GET /stock-transfers — قائمة التحويلات

### ما هو؟
يعيد جميع أذون التحويل مع إمكانية استخدام الفلاتر وترقيم الصفحات.

### الصلاحية
`stock_transfers.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `status` | draft, confirmed, cancelled |
| `from_warehouse_id` | UUID |
| `to_warehouse_id` | UUID |
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |
| `search` | بحث في رقم التحويل |
| `page` | رقم الصفحة |
| `limit` | 1-100 |

### مثال

    curl "http://localhost:5000/api/v1/stock-transfers?status=confirmed&page=1" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "id": "abc-123",
            "transfer_number": "TRF-0001",
            "transfer_date": "2026-01-15",
            "status": "confirmed",
            "from_warehouse_name": "الرئيسي",
            "to_warehouse_name": "الفرعي",
            "items_count": 2
          }
        ],
        "pagination": {
          "page": 1,
          "limit": 20,
          "total": 45,
          "pages": 3
        }
      }
    }

---

## 5. GET /stock-transfers/:id — تفاصيل التحويل

### ما هو؟
يعيد إذن تحويل واحداً مع جميع بنوده وتفاصيل الدفعات.

### الصلاحية
`stock_transfers.view`

### مثال

    curl http://localhost:5000/api/v1/stock-transfers/abc-123 \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "transfer_number": "TRF-0001",
        "transfer_date": "2026-01-15",
        "status": "confirmed",
        "from_warehouse_name": "الرئيسي",
        "to_warehouse_name": "الفرعي",
        "notes": "تحويل بضاعة",
        "items": [
          {
            "id": "item-1",
            "product_name": "باراسيتامول",
            "product_sku": "PCM-500",
            "from_batch_number": "B2401",
            "to_batch_number": "B2401",
            "quantity": 20,
            "unit_cost": 10
          }
        ]
      }
    }

---

## ملاحظات مهمة

1. لا ينشئ التحويل قيداً محاسبياً، لأن العملية مجرد تغيير لموقع المخزون.
2. يستخدم FIFO عند عدم تحديد `from_batch_id`.
3. يجب المحافظة على رقم الدفعة الأصلية عند إنشاء دفعة الوجهة، وفق سياسة تتبع الدفعات المعتمدة.
4. يجب تنفيذ جميع العمليات داخل Database Transaction.
5. يجب ضمان Rollback عند فشل أي خطوة، بحيث لا يحدث خصم دون إضافة مقابلة.
6. الإلغاء بعد التأكيد يعكس جميع الحركات، بما فيها الحركات الناتجة عن FIFO.
7. يجب التحقق من كفاية المخزون قبل التأكيد.
8. يجب منع التحويل بين المستودع نفسه.
9. يجب التحقق من أن المستودعين تابعان للشركة الحالية.
10. يجب قفل سجلات الدفعات أو استخدام آلية تمنع تعارض التحويلات المتزامنة.
11. يجب منع تأكيد التحويل أكثر من مرة.
12. يجب منع إلغاء التحويل الملغى مسبقاً.
13. يجب التحقق من إمكانية عكس الحركات قبل تنفيذ الإلغاء.
14. يجب الاحتفاظ بسجل واضح للحركات الأصلية والحركات العكسية لأغراض التدقيق.
15. يجب أن تكون كميات التحويل موجبة، وألا تتجاوز الكمية المتاحة في الدفعات المحددة.
16. الصلاحيات المطلوبة: `stock_transfers.view`, `stock_transfers.create`, `stock_transfers.confirm`, `stock_transfers.cancel`.

---

## ملخص Endpoints

| Method | Endpoint | الصلاحية | الوظيفة |
|---|---|---|---|
| POST | `/stock-transfers` | `stock_transfers.create` | إنشاء تحويل |
| POST | `/stock-transfers/:id/confirm` | `stock_transfers.confirm` | تأكيد التحويل |
| POST | `/stock-transfers/:id/cancel` | `stock_transfers.cancel` | إلغاء التحويل |
| GET | `/stock-transfers` | `stock_transfers.view` | قائمة التحويلات |
| GET | `/stock-transfers/:id` | `stock_transfers.view` | تفاصيل التحويل |
