# 📄 Notes API — إشعارات مدين/دائن

## 🎯 نظرة عامة

إشعارات **مدين/دائن** هي مستندات مالية لتعديل أرصدة العملاء والموردين بدون حركة مخزون.

| النوع | التأثير |
|---|---|
| Credit Note (إشعار دائن) | تخفيض ذمة الطرف |
| Debit Note (إشعار مدين) | زيادة ذمة الطرف |

## متى نستخدمه؟

| الحالة | النوع |
|---|---|
| عميل أرجع بضاعة | إشعار دائن لعميل |
| خصم إضافي بعد الفاتورة | إشعار دائن لعميل |
| بند منسي في الفاتورة | إشعار مدين لعميل |
| فرق سعر من مورد | إشعار مدين لمورد |

---

## 1. POST /notes — إنشاء إشعار

### ما هو؟
ينشئ إشعاراً جديداً بحالة مسودة (draft).

### الصلاحية
`notes.create`

### ماذا يرسل؟

    {
      "note_type": "credit",
      "party_type": "customer",
      "customer_id": "550e8400-e29b-41d4-a716-446655440000",
      "invoice_id": "660e8400-e29b-41d4-a716-446655440000",
      "note_date": "2026-01-15",
      "reason": "return",
      "description": "إرجاع 2 عبوة تالفة",
      "items": [
        {
          "description": "باراسيتامول 500mg",
          "quantity": 2,
          "unit_price": 50,
          "tax_rate": 15
        }
      ]
    }

### شرح الحقول

| الحقل | مطلوب؟ | القيمة |
|---|---|---|
| `note_type` | نعم | `credit` أو `debit` |
| `party_type` | نعم | `customer` أو `supplier` |
| `customer_id` | إذا كان عميل | UUID |
| `supplier_id` | إذا كان مورد | UUID |
| `invoice_id` | اختياري | UUID |
| `note_date` | اختياري | YYYY-MM-DD |
| `reason` | نعم | `return`, `discount`, `correction`, `price_diff`, `shipping`, `other` |
| `description` | اختياري | نص |
| `items` | نعم | بند واحد على الأقل |

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "note_number": "CN-0001",
        "note_type": "credit",
        "party_type": "customer",
        "customer_name": "أحمد محمد",
        "note_date": "2026-01-15",
        "total": 115.00,
        "status": "draft",
        "items": []
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة | السبب |
|---|---|---|
| 400 | `note_type must be credit or debit` | قيمة خاطئة |
| 400 | `customer_id is required for customer notes` | نسيت customer_id |
| 400 | `At least one item is required` | بلا بنود |
| 500 | `Company currency is not configured` | الشركة بلا عملة |

### مثال cURL

    curl -X POST http://localhost:5000/api/v1/notes \
      -H "Authorization: Bearer <TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{
        "note_type": "credit",
        "party_type": "customer",
        "customer_id": "550e8400-...",
        "reason": "return",
        "items": [
          {
            "description": "باراسيتامول",
            "quantity": 2,
            "unit_price": 50,
            "tax_rate": 15
          }
        ]
      }'

---

## 2. POST /notes/:id/confirm — تأكيد

### ما هو؟
يحوّل الإشعار من مسودة إلى مؤكد وينشئ قيداً محاسبياً.

### الصلاحية
`notes.confirm`

### ماذا يرسل؟
لا شيء، فقط `id` في URL.

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "status": "confirmed",
        "journal_entry_id": "je-456"
      }
    }

### القيود المحاسبية

| الحالة | Dr | Cr |
|---|---|---|
| Credit + Customer | 411 (مرتجع مبيعات) | 112 (ذمم عملاء) |
| Credit + Supplier | 211 (ذمم موردين) | 511 (مرتجع مشتريات) |
| Debit + Customer | 112 (ذمم عملاء) | 411 (إيرادات أخرى) |
| Debit + Supplier | 518 (مصاريف أخرى) | 211 (ذمم موردين) |

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `Note is already confirmed` |
| 400 | `Entry is not balanced` |
| 500 | `الحسابات مفقودة: 411` |
| 409 | `فشل التأكيد — قد يكون معدّلاً` |

### مثال

    curl -X POST http://localhost:5000/api/v1/notes/abc-123/confirm \
      -H "Authorization: Bearer <TOKEN>"

---

## 3. POST /notes/:id/cancel — إلغاء

### ما هو؟
يلغي الإشعار.

- إذا كان مسودة: إلغاء بسيط.
- إذا كان مؤكداً: عكس القيد المحاسبي ثم الإلغاء.

### الصلاحية
`notes.cancel`

### ماذا يرسل؟

    {
      "reason": "خطأ في الإدخال"
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
| 400 | `Already cancelled` |
| 404 | `Note not found` |

---

## 4. GET /notes — القائمة

### ما هو؟
يعيد جميع الإشعارات مع إمكانية استخدام الفلاتر.

### الصلاحية
`notes.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `note_type` | credit, debit |
| `party_type` | customer, supplier |
| `status` | draft, confirmed, cancelled |
| `customer_id` | UUID |
| `supplier_id` | UUID |
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |
| `search` | بحث في الرقم أو الوصف |
| `page` | رقم الصفحة |
| `limit` | 1-100 |

### مثال

    curl "http://localhost:5000/api/v1/notes?note_type=credit&status=confirmed&page=1" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "id": "abc-123",
            "note_number": "CN-0001",
            "note_type": "credit",
            "customer_name": "أحمد محمد",
            "total": 115.00,
            "status": "confirmed"
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

## 5. GET /notes/:id — التفاصيل

### ما هو؟
يعيد إشعاراً واحداً مع جميع بنوده.

### الصلاحية
`notes.view`

### مثال

    curl http://localhost:5000/api/v1/notes/abc-123 \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "id": "abc-123",
        "note_number": "CN-0001",
        "note_type": "credit",
        "party_type": "customer",
        "customer_name": "أحمد محمد",
        "note_date": "2026-01-15",
        "subtotal": 100.00,
        "tax_total": 15.00,
        "total": 115.00,
        "status": "confirmed",
        "journal_entry_id": "je-456",
        "items": [
          {
            "id": "item-1",
            "product_name": "باراسيتامول",
            "quantity": 2,
            "unit_price": 50,
            "tax_amount": 15,
            "line_total": 115
          }
        ]
      }
    }

---

## دورة الحياة

    draft ──(confirm)──> confirmed ──(cancel)──> cancelled
      │                      │
      └──(cancel)──> cancelled

| من | إلى | الإجراء |
|---|---|---|
| draft | confirmed | `POST /notes/:id/confirm` |
| draft | cancelled | `POST /notes/:id/cancel` |
| confirmed | cancelled | `POST /notes/:id/cancel` مع عكس القيد |

---

## ملاحظات مهمة

1. الإشعار لا يحرك المخزون، وإنما يعدّل الأرصدة المالية فقط.
2. القيود المحاسبية تُنشأ تلقائياً عند التأكيد.
3. يجب تنفيذ التأكيد والإلغاء داخل Database Transaction لضمان التراجع الكامل عند فشل أي عملية.
4. يجب منع تأكيد الإشعار أكثر من مرة.
5. يجب منع إلغاء الإشعار الملغى مسبقاً.
6. يجب التحقق من أن الإشعار تابع للشركة الحالية لمنع الوصول إلى بيانات شركات أخرى.
7. يجب التحقق من صحة الحسابات المحاسبية قبل إنشاء القيد.
8. يجب أن تكون القيود متوازنة (إجمالي المدين = إجمالي الدائن).
9. يجب حفظ رقم القيد المحاسبي المرتبط بالإشعار.
10. الصلاحيات المطلوبة: `notes.view`, `notes.create`, `notes.confirm`, `notes.cancel`.
