# 📥 Goods Receipts API — أذون الاستلام

## ما هو إذن الاستلام؟

إذن الاستلام هو مستند يُستخدم لتسجيل استلام البضاعة فعلياً من المورد وإضافتها إلى المخزون.

**الفرق عن أمر الشراء:**
- أمر الشراء: طلب شراء (نية).
- إذن الاستلام: استلام فعلي للبضاعة ودخولها إلى المخزون.

**متى نستخدمه؟**
- استلام بضاعة بدون أمر شراء (شراء مباشر).
- استلام جزئي لأمر شراء.
- استلام هدايا أو عينات.

---

## دورة الحياة

    draft ──(confirm)──> confirmed ──(cancel)──> cancelled
      │                      │
      └──(cancel)──> cancelled

| من | إلى | الإجراء |
|---|---|---|
| draft | confirmed | `POST /goods-receipts/:id/confirm` |
| draft | cancelled | `POST /goods-receipts/:id/cancel` |
| confirmed | cancelled | `POST /goods-receipts/:id/cancel` مع عكس الحركات والقيد |

---

## 1. POST /goods-receipts — إنشاء إذن استلام

### ما هو؟
يُنشئ إذن استلام بحالة مسودة (draft)، دون إضافة الكميات إلى المخزون قبل التأكيد.

### الصلاحية
`goods_receipts.create`

### ماذا يرسل؟

    {
      "supplier_id": "550e8400-e29b-41d4-a716-446655440000",
      "warehouse_id": "660e8400-e29b-41d4-a716-446655440000",
      "purchase_order_id": null,
      "receipt_date": "2026-01-15",
      "payment_type": "credit",
      "notes": "استلام بضاعة يناير",
      "items": [
        {
          "product_id": "770e8400-e29b-41d4-a716-446655440000",
          "batch_number": "B2401",
          "expiry_date": "2027-01-01",
          "quantity": 100,
          "unit_price": 10,
          "tax_rate": 15
        }
      ]
    }

### شرح الحقول

| الحقل | مطلوب؟ | القيمة |
|---|---|---|
| `supplier_id` | نعم | UUID |
| `warehouse_id` | نعم | UUID |
| `purchase_order_id` | اختياري | UUID (ربط بأمر شراء) |
| `receipt_date` | اختياري | YYYY-MM-DD (افتراضي: اليوم) |
| `payment_type` | اختياري | cash, credit (افتراضي: credit) |
| `notes` | اختياري | نص |
| `items` | نعم | بند واحد على الأقل |
| `items.*.product_id` | نعم | UUID |
| `items.*.quantity` | نعم | أكبر من صفر |
| `items.*.unit_price` | نعم | أكبر من أو يساوي صفر |
| `items.*.batch_number` | اختياري | نص (يُستخدم لتحديد الدفعة) |
| `items.*.expiry_date` | اختياري | YYYY-MM-DD |
| `items.*.tax_rate` | اختياري | 0-100 |

**أنواع الدفع:**

| النوع | الوصف |
|---|---|
| `cash` | نقدي — Cr 1111 (صندوق) |
| `credit` | آجل — Cr 211 (ذمم موردين) |

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "receipt_number": "GRN-0001",
        "receipt_date": "2026-01-15",
        "status": "draft",
        "supplier_name": "شركة التوريد",
        "warehouse_name": "المستودع الرئيسي",
        "total": 1150.00,
        "payment_type": "credit",
        "items": []
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `supplier_id is required` |
| 400 | `warehouse_id is required` |
| 400 | `Supplier not found or inactive` |
| 400 | `Warehouse not found or inactive` |
| 400 | `Invalid quantity for product X` |
| 400 | `Invalid unit_price for product X` |
| 400 | `Subtotal must be > 0` |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/goods-receipts \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{
        "supplier_id": "550e8400-...",
        "warehouse_id": "660e8400-...",
        "payment_type": "credit",
        "items": [
          {
            "product_id": "770e8400-...",
            "batch_number": "B2401",
            "expiry_date": "2027-01-01",
            "quantity": 100,
            "unit_price": 10,
            "tax_rate": 15
          }
        ]
      }'

---

## 2. POST /goods-receipts/:id/confirm — تأكيد إذن الاستلام

### ما هو؟
ينفّذ الاستلام فعلياً ويُرحّل أثره المخزني والمحاسبي.

**ماذا يحدث؟**

1. التحقق من إجماليات الإذن وبنوده.
2. التحقق من الحسابات المطلوبة وأنها موجودة ونشطة.
3. بناء سطور القيد والتحقق من توازنه.
4. إضافة الكميات إلى المخزون وإنشاء الدفعات عند الحاجة.
5. تسجيل حركات `stock_movements` بنوع `goods_receipt`.
6. إنشاء القيد المحاسبي:
   - Dr 113 (مخزون) — subtotal
   - Dr 114 (ضريبة مدخلات) — tax_total
   - Cr 211 (ذمم موردين) أو Cr 1111 (صندوق) — total
7. ترحيل القيد المحاسبي.
8. تحديث حالة الإذن إلى `confirmed`.

### الصلاحية
`goods_receipts.confirm`

### ماذا يرسل؟
لا يحتاج إلى Body؛ يُرسل معرّف الإذن في المسار فقط.

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "receipt_number": "GRN-0001",
        "status": "confirmed",
        "journal_entry_id": "je-456",
        "confirmed_at": "2026-01-15T15:30:00Z"
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 404 | `Goods receipt not found` |
| 400 | `Already confirmed` |
| 400 | `Cannot confirm cancelled receipt` |
| 400 | `لا يمكن تأكيد إذن بمجموع صفر` |
| 400 | `طريقة الدفع غير صالحة` |
| 400 | `الدفعة X لا تنتمي للشركة/المنتج/المستودع` |
| 500 | `الحسابات مفقودة: 113, 114, 211` |
| 500 | `الحسابات غير نشطة: 113` |
| 500 | `القيد المحاسبي غير متوازن` |
| 409 | `فشل تأكيد الإذن — قد يكون معدّلاً من عملية أخرى` |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/goods-receipts/abc-123/confirm \
      -H "Authorization: Bearer <TOKEN>"

---

## 3. POST /goods-receipts/:id/cancel — إلغاء إذن الاستلام

### ما هو؟
يلغي إذن الاستلام، ويختلف أثر الإلغاء حسب حالة الإذن:

- `draft`: إلغاء بسيط دون تأثير على المخزون أو الحسابات.
- `confirmed`: عكس الحركات المخزنية والقيد المحاسبي المرتبط بالإذن.

### الصلاحية
`goods_receipts.cancel`

### ماذا يرسل؟

    {
      "reason": "بضاعة تالفة"
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

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 404 | `Goods receipt not found` |
| 400 | `Already cancelled` |
| 400 | `Cannot reverse: insufficient quantity in batch X` |
| 500 | `Batch X not found during cancel — data inconsistency` |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/goods-receipts/abc-123/cancel \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{"reason": "بضاعة تالفة"}'

---

## 4. GET /goods-receipts — قائمة أذون الاستلام

### ما هو؟
يعيد جميع أذون الاستلام مع إمكانية التصفية والبحث وترقيم الصفحات.

### الصلاحية
`goods_receipts.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `status` | draft, confirmed, cancelled |
| `supplier_id` | UUID |
| `warehouse_id` | UUID |
| `purchase_order_id` | UUID |
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |
| `search` | بحث في رقم الإذن أو اسم المورد |
| `page` | رقم الصفحة |
| `limit` | 1-100 |

### مثال

    curl "http://localhost:5000/api/v1/goods-receipts?status=confirmed&page=1" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "id": "abc-123",
            "receipt_number": "GRN-0001",
            "receipt_date": "2026-01-15",
            "status": "confirmed",
            "supplier_name": "شركة التوريد",
            "warehouse_name": "المستودع الرئيسي",
            "total": 1150.00,
            "payment_type": "credit",
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

## 5. GET /goods-receipts/:id — تفاصيل إذن الاستلام

### ما هو؟
يعيد بيانات إذن استلام واحد مع جميع بنوده وتفاصيله المخزنية والمحاسبية.

### الصلاحية
`goods_receipts.view`

### مثال

    curl http://localhost:5000/api/v1/goods-receipts/abc-123 \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "receipt_number": "GRN-0001",
        "receipt_date": "2026-01-15",
        "status": "confirmed",
        "supplier_name": "شركة التوريد",
        "warehouse_name": "المستودع الرئيسي",
        "payment_type": "credit",
        "subtotal": 1000.00,
        "tax_total": 150.00,
        "total": 1150.00,
        "journal_entry_id": "je-456",
        "items": [
          {
            "id": "item-1",
            "product_name": "باراسيتامول",
            "product_sku": "PCM-500",
            "batch_number": "B2401",
            "expiry_date": "2027-01-01",
            "quantity": 100,
            "unit_price": 10,
            "line_total": 1150.00
          }
        ]
      }
    }

---

## ملاحظات مهمة

1. الدفعات تُنشأ تلقائياً عند عدم وجود دفعة مطابقة، وفق آلية مطابقة الدفعات المعتمدة في النظام.
2. `batch_number` يُستخدم لتحديد الدفعة، ويجب عدم إنشاء دفعة مكررة عند تكرار رقم الدفعة ضمن نطاق الشركة والمنتج والمستودع.
3. التاريخ الافتراضي للانتهاء = سنتان من اليوم، إذا كان هذا هو السلوك المعتمد فعلياً في Backend؛ ويُفضّل عدم افتراض تاريخ انتهاء لمنتج لا يتطلب تاريخ صلاحية.
4. يجب تنفيذ جميع عمليات التأكيد والإلغاء داخل Database Transaction واحدة.
5. يجب ضمان Rollback كامل عند فشل أي خطوة، بحيث لا تبقى حركات مخزنية أو قيود محاسبية جزئية.
6. حماية من تكرار الدفعات والتزامن باستخدام القيود المناسبة وعمليات القفل مثل `FOR UPDATE`، واستخدام `SAVEPOINT` عند الحاجة.
7. الإلغاء بعد التأكيد يجب أن يعكس جميع الحركات المخزنية والقيد المحاسبي، دون حذف السجلات الأصلية.
8. يجب إعادة التحقق من الإجماليات قبل التأكيد، وعدم الاعتماد على إجماليات مرسلة من الواجهة.
9. يجب التحقق من الحسابات المطلوبة (113, 114, 211 أو 1111 بحسب طريقة الدفع) قبل إنشاء القيد، وأن تكون الحسابات نشطة وتتبع الشركة الصحيحة.
10. يجب أن يكون القيد المحاسبي متوازناً: مجموع المدين = مجموع الدائن.
11. يجب التحقق من أن الدفعة المستخدمة تنتمي إلى الشركة والمنتج والمستودع الصحيحين.
12. الصلاحيات المطلوبة:
    - `goods_receipts.view`
    - `goods_receipts.create`
    - `goods_receipts.confirm`
    - `goods_receipts.cancel`

---

## تنبيه للمطور

هذه الوثيقة تصف السلوك المتوقع لواجهة Goods Receipts API. يجب مطابقة أسماء الحقول، والاستجابات، ورسائل الأخطاء، وأرقام الحسابات، والمسارات مع تنفيذ Backend الفعلي قبل اعتمادها كمرجع نهائي. كما يجب التأكد من أن الإلغاء يعالج أي كميات صُرفت أو نُقلت من الدفعات بعد الاستلام، وألا يسمح بعكس المخزون بطريقة تؤدي إلى أرصدة سالبة أو فساد في تكلفة المخزون.