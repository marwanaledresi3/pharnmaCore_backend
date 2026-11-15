# 📋 Stock Adjustments API — تسويات الجرد

## ما هي تسوية الجرد؟

تسوية الجرد هي مستند لتعديل كميات المخزون بعد إجراء الجرد الفعلي ومقارنة الكميات الموجودة فعلياً بالكميات المسجلة في النظام.

**أنواع الأسباب:**

| السبب | الوصف |
|---|---|
| `physical_count` | جرد فعلي |
| `damage` | تالف |
| `theft` | سرقة |
| `expiry` | انتهاء صلاحية |
| `error` | خطأ إدخال |
| `other` | أسباب أخرى |

**متى نستخدمه؟**
- جرد دوري (شهري/سنوي).
- تسوية أخطاء الإدخال.
- تسجيل البضاعة التالفة.
- تسجيل النقص أو الزيادة في المخزون.
- تسوية المنتجات منتهية الصلاحية.

---

## دورة الحياة

    draft ──(confirm)──> confirmed ──(cancel)──> cancelled
      │                      │
      └──(cancel)──> cancelled

| من | إلى | الإجراء |
|---|---|---|
| draft | confirmed | `POST /stock-adjustments/:id/confirm` |
| draft | cancelled | `POST /stock-adjustments/:id/cancel` |
| confirmed | cancelled | `POST /stock-adjustments/:id/cancel` مع عكس الحركات |

---

## 1. POST /stock-adjustments — إنشاء تسوية

### ما هو؟
ينشئ تسوية جرد بحالة مسودة (draft)، دون تعديل المخزون فعلياً.

### الصلاحية
`stock_adjustments.create`

### ماذا يرسل؟

    {
      "warehouse_id": "550e8400-e29b-41d4-a716-446655440000",
      "reason": "physical_count",
      "adjustment_date": "2026-01-15",
      "notes": "جرد نهاية شهر يناير",
      "items": [
        {
          "product_id": "660e8400-e29b-41d4-a716-446655440000",
          "batch_id": "770e8400-e29b-41d4-a716-446655440000",
          "actual_quantity": 95
        }
      ]
    }

### شرح الحقول

| الحقل | مطلوب؟ | القيمة |
|---|---|---|
| `warehouse_id` | نعم | UUID |
| `reason` | نعم | physical_count, damage, theft, expiry, error, other |
| `adjustment_date` | اختياري | YYYY-MM-DD (افتراضي: اليوم) |
| `notes` | اختياري | نص |
| `items` | نعم | بند واحد على الأقل |
| `items.*.product_id` | نعم | UUID |
| `items.*.batch_id` | اختياري | UUID (لتحديد دفعة معينة) |
| `items.*.actual_quantity` | نعم | أكبر من أو يساوي صفر |

**ملاحظة مهمة:**

- `system_quantity` تُجلب تلقائياً من قاعدة البيانات.
- `difference = actual_quantity - system_quantity`.
- لا يُسمح بإرسال `system_quantity` من المستخدم باعتبارها قيمة موثوقة.
- يجب تحديد سياسة واضحة عند عدم إرسال `batch_id`، خصوصاً إذا كان المنتج يمتلك أكثر من دفعة.

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "adjustment_number": "ADJ-0001",
        "adjustment_date": "2026-01-15",
        "status": "draft",
        "warehouse_name": "المستودع الرئيسي",
        "reason": "physical_count",
        "items": []
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `warehouse_id is required` |
| 400 | `reason is required` |
| 400 | `At least one item is required` |
| 400 | `Invalid actual_quantity for product X` |
| 400 | `Batch X not found in warehouse` |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/stock-adjustments \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{
        "warehouse_id": "550e8400-...",
        "reason": "physical_count",
        "notes": "جرد نهاية يناير",
        "items": [
          {
            "product_id": "660e8400-...",
            "actual_quantity": 95
          }
        ]
      }'

---

## 2. POST /stock-adjustments/:id/confirm — تأكيد التسوية

### ما هو؟
ينفذ التسوية فعلياً ويحدث كميات المخزون ويسجل الحركات الناتجة عنها.

### ماذا يحدث؟

1. التحقق من أن التسوية بحالة `draft`.
2. التحقق من أن المستودع تابع للشركة الحالية.
3. قراءة الكميات الحالية من قاعدة البيانات.
4. إعادة التحقق من الكميات لمنع التعارض مع العمليات المتزامنة.
5. حساب الفرق بين الكمية الفعلية والكمية المسجلة.
6. تعديل كميات الدفعات وفق الفرق.
7. تسجيل حركات `stock_movements` بنوع `adjustment`.
8. إنشاء قيد محاسبي إذا كان `stock_adjustment_auto_journal = true`.
9. تحديث حالة التسوية إلى `confirmed`.

### المعالجة المحاسبية

عند وجود زيادة في المخزون:

- مدين: 113 (المخزون).
- دائن: 518 (فروقات المخزون).

عند وجود نقص في المخزون:

- مدين: 518 (فروقات المخزون).
- دائن: 113 (المخزون).

**ملاحظة:** يجب تحديد قيمة التسوية بناءً على تكلفة المخزون الفعلية، مع مراعاة تكلفة كل دفعة وعدم الاعتماد على سعر البيع.

### الصلاحية
`stock_adjustments.confirm`

### ماذا يرسل؟
لا شيء، فقط `id` في URL.

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "adjustment_number": "ADJ-0001",
        "status": "confirmed",
        "journal_entry_id": "je-456",
        "confirmed_at": "2026-01-15T15:30:00Z"
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 404 | `Adjustment not found` |
| 400 | `Adjustment is already confirmed` |
| 400 | `Adjustment is cancelled` |
| 400 | `No differences to adjust` |
| 400 | `Insufficient quantity in batch X` |
| 500 | `Required accounts (113, 518) not found` |
| 500 | `لا يمكن تأكيد الإذن: القيد المحاسبي غير متوازن` |
| 409 | `فشل التأكيد — قد يكون معدّلاً من عملية أخرى` |

### مثال

    curl -X POST http://localhost:5000/api/v1/stock-adjustments/abc-123/confirm \
      -H "Authorization: Bearer <TOKEN>"

---

## 3. POST /stock-adjustments/:id/cancel — إلغاء التسوية

### ما هو؟
يلغي تسوية الجرد.

- إذا كانت draft: إلغاء بسيط دون تعديل المخزون.
- إذا كانت confirmed: عكس حركات المخزون وعكس القيد المحاسبي المرتبط بها.

### الصلاحية
`stock_adjustments.cancel`

### ماذا يرسل؟

    {
      "reason": "خطأ في الجرد"
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
| 404 | `Adjustment not found` |
| 400 | `Already cancelled` |
| 400 | `Cannot reverse: insufficient quantity in batch X` |
| 400 | `Cannot reverse adjustment: original stock movements not found` |

### مثال

    curl -X POST http://localhost:5000/api/v1/stock-adjustments/abc-123/cancel \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{"reason": "خطأ في الجرد"}'

---

## 4. GET /stock-adjustments — قائمة التسويات

### ما هو؟
يعيد جميع تسويات الجرد مع الفلاتر وترقيم الصفحات.

### الصلاحية
`stock_adjustments.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `status` | draft, confirmed, cancelled |
| `warehouse_id` | UUID |
| `reason` | physical_count, damage, theft, expiry, error, other |
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |
| `search` | بحث في رقم التسوية أو الملاحظات |
| `page` | رقم الصفحة |
| `limit` | 1-100 |

### مثال

    curl "http://localhost:5000/api/v1/stock-adjustments?status=confirmed&reason=damage&page=1" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "id": "abc-123",
            "adjustment_number": "ADJ-0001",
            "adjustment_date": "2026-01-15",
            "status": "confirmed",
            "reason": "physical_count",
            "warehouse_name": "المستودع الرئيسي",
            "items_count": 2,
            "total_value": 150.00
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

## 5. GET /stock-adjustments/:id — تفاصيل التسوية

### ما هو؟
يعيد تسوية واحدة مع جميع بنودها وتفاصيل الكميات والتكاليف.

### الصلاحية
`stock_adjustments.view`

### مثال

    curl http://localhost:5000/api/v1/stock-adjustments/abc-123 \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "adjustment_number": "ADJ-0001",
        "adjustment_date": "2026-01-15",
        "status": "confirmed",
        "warehouse_name": "المستودع الرئيسي",
        "reason": "physical_count",
        "notes": "جرد نهاية يناير",
        "journal_entry_id": "je-456",
        "items": [
          {
            "id": "item-1",
            "product_name": "باراسيتامول",
            "product_sku": "PCM-500",
            "batch_number": "B2401",
            "system_quantity": 100,
            "actual_quantity": 95,
            "difference": -5,
            "unit_cost": 10
          }
        ]
      }
    }

---

## 6. GET /stock-adjustments/warehouse-products/:warehouseId — منتجات المستودع

### ما هو؟
يعيد المنتجات والدفعات الموجودة في مستودع معين لمساعدة المستخدم على إجراء الجرد ومقارنة الكميات الفعلية بكميات النظام.

### الصلاحية
`stock_adjustments.create`

### مثال

    curl http://localhost:5000/api/v1/stock-adjustments/warehouse-products/abc-123 \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "product_id": "uuid",
            "product_name": "باراسيتامول",
            "product_sku": "PCM-500",
            "product_unit": "قطعة",
            "batch_id": "uuid",
            "batch_number": "B2401",
            "batch_expiry": "2027-01-01",
            "system_quantity": 100,
            "cost_price": 10
          }
        ]
      }
    }

---

## ملاحظات مهمة

1. `system_quantity` تُجلب تلقائياً من قاعدة البيانات ولا يجب الاعتماد على قيمة يرسلها المستخدم.
2. `difference` يُحسب تلقائياً وفق المعادلة: `actual_quantity - system_quantity`.
3. القيد المحاسبي يُنشأ تلقائياً إذا كان `stock_adjustment_auto_journal = true`.
4. يجب تحديد سياسة واضحة لتوزيع النقص على الدفعات عند عدم إرسال `batch_id`، ولا يجوز تطبيق FIFO بطريقة عشوائية على كميات الجرد الفعلي.
5. يجب تنفيذ جميع العمليات داخل Database Transaction.
6. يجب ضمان Rollback عند فشل أي خطوة، بحيث لا يحدث تعديل جزئي للمخزون أو الحسابات.
7. الإلغاء بعد التأكيد يعكس جميع الحركات والقيد المحاسبي المرتبط بالتسوية.
8. يجب التحقق من كفاية المخزون قبل تنفيذ أي تخفيض.
9. يجب التحقق من وجود الحسابات 113 و518 قبل إنشاء القيد المحاسبي.
10. يجب أن يكون القيد المحاسبي متوازناً: إجمالي المدين يساوي إجمالي الدائن.
11. يجب قفل سجلات الدفعات أثناء التأكيد أو استخدام آلية تمنع تعارض عمليات الجرد المتزامنة.
12. يجب منع تأكيد التسوية أكثر من مرة.
13. يجب منع إلغاء التسوية الملغاة مسبقاً.
14. يجب التحقق من أن المستودع والمنتجات والدفعات تتبع الشركة الحالية.
15. يجب حفظ الكميات الأصلية والكمية الفعلية والفرق وتكلفة الوحدة لأغراض التدقيق.
16. يجب التعامل مع الزيادة والنقص بصورة منفصلة عند احتواء التسوية على أكثر من منتج.
17. يجب منع إدخال الكميات السالبة، والسماح بالصفر عندما تكون الكمية الفعلية غير موجودة.
18. يجب عدم إنشاء قيد محاسبي إذا لم توجد فروقات فعلية.
19. يجب التأكد من أن عكس التسوية لا يؤدي إلى أرصدة مخزون سالبة أو تلف حركات لاحقة.
20. يجب تسجيل سبب الإلغاء والمستخدم الذي نفذ العملية وتاريخها.
21. الصلاحيات المطلوبة: `stock_adjustments.view`, `stock_adjustments.create`, `stock_adjustments.confirm`, `stock_adjustments.cancel`.

---

## ملخص Endpoints

| Method | Endpoint | الصلاحية | الوظيفة |
|---|---|---|---|
| POST | `/stock-adjustments` | `stock_adjustments.create` | إنشاء تسوية |
| POST | `/stock-adjustments/:id/confirm` | `stock_adjustments.confirm` | تأكيد التسوية |
| POST | `/stock-adjustments/:id/cancel` | `stock_adjustments.cancel` | إلغاء التسوية |
| GET | `/stock-adjustments` | `stock_adjustments.view` | قائمة التسويات |
| GET | `/stock-adjustments/:id` | `stock_adjustments.view` | تفاصيل التسوية |
| GET | `/stock-adjustments/warehouse-products/:warehouseId` | `stock_adjustments.create` | منتجات المستودع |

---

## ملاحظة للمطور

هذه الوثيقة تصف الواجهات والسلوك المتوقع. يجب مطابقة أسماء الحقول والاستجابات والصلاحيات مع ملفات Routes وControllers وServices الفعلية في Backend قبل اعتمادها كتوثيق نهائي.