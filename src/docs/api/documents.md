# 📄 Documents API — المستندات الموحدة

## ما هو؟

واجهة المستندات الموحدة تعرض جميع المستندات المالية والمخزنية للشركة من مكان واحد.

**المميزات:**
- 15 نوع مستند.
- 8 فئات.
- فلاتر متقدمة.
- بحث وترقيم صفحات.
- إحصائيات حسب نوع المستند.

**الهدف:** توفير رؤية شاملة لكل ما حدث في الشركة من مكان واحد (360°).

---

## الأنواع المدعومة

| # | النوع | الفئة | الجدول |
|---|-------|-------|--------|
| 1 | `invoice_sales` | invoices | `invoices` |
| 2 | `invoice_purchase` | invoices | `invoices` |
| 3 | `payment_receive` | payments | `payments` |
| 4 | `payment_pay` | payments | `payments` |
| 5 | `payment_refund` | payments | `payments` |
| 6 | `payment_credit_apply` | payments | `payments` |
| 7 | `expense` | expenses | `expenses` |
| 8 | `return_sale` | returns | `returns` |
| 9 | `return_purchase` | returns | `returns` |
| 10 | `note_credit` | notes | `notes` |
| 11 | `note_debit` | notes | `notes` |
| 12 | `delivery_note` | delivery | `delivery_notes` |
| 13 | `stock_transfer` | inventory | `stock_transfers` |
| 14 | `stock_adjustment` | inventory | `stock_adjustments` |
| 15 | `journal_entry` | accounting | `journal_entries` |

---

## 1. GET /documents — قائمة المستندات

### ما هو؟
يعيد قائمة موحدة بجميع المستندات المالية والمخزنية، مع إمكانية التصفية والبحث وترقيم الصفحات.

### الصلاحية
`documents.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `document_type` | واحد من أنواع المستندات الـ 15 |
| `status` | draft, posted, confirmed, paid, cancelled |
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |
| `party_id` | UUID (عميل أو مورد) |
| `search` | بحث في رقم المستند أو اسم الطرف |
| `page` | رقم الصفحة |
| `limit` | 1-200 |

### مثال cURL

    curl "http://localhost:5000/api/v1/documents?document_type=invoice_sales&date_from=2026-01-01&page=1" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "items": [
          {
            "document_type": "invoice_sales",
            "document_id": "uuid",
            "document_number": "INV-0001",
            "document_date": "2026-01-15",
            "amount": 5000,
            "status": "paid",
            "party_name": "شركة النيل",
            "party_id": "uuid",
            "journal_entry_id": "uuid",
            "source_id": null,
            "created_at": "2026-01-15T10:00:00Z"
          }
        ],
        "pagination": {
          "page": 1,
          "limit": 50,
          "total": 245,
          "pages": 5
        }
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `Invalid document_type` |
| 400 | `Invalid status` |
| 401 | `Authentication required` |

---

## 2. GET /documents/stats — إحصائيات المستندات

### ما هو؟
يعيد إحصائيات سريعة لكل نوع مستند، تشمل العدد والمبلغ الإجمالي خلال فترة محددة.

### الصلاحية
`documents.view`

### الفلاتر المتاحة

| الفلتر | القيمة |
|---|---|
| `date_from` | YYYY-MM-DD |
| `date_to` | YYYY-MM-DD |

### مثال cURL

    curl "http://localhost:5000/api/v1/documents/stats?date_from=2026-01-01&date_to=2026-01-31" \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "by_type": [
          {
            "type": "invoice_sales",
            "count": 15,
            "total_amount": 45000
          },
          {
            "type": "payment_receive",
            "count": 12,
            "total_amount": 40000
          },
          {
            "type": "expense",
            "count": 8,
            "total_amount": 5000
          }
        ],
        "totals": {
          "count": 45,
          "amount": 120000
        }
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `Invalid date format` |

---

## 3. GET /documents/types — قائمة أنواع المستندات

### ما هو؟
يعيد قائمة الأنواع المتاحة والفئات والحالات، لاستخدامها في بناء فلاتر واجهة المستخدم.

### الصلاحية
`documents.view`

### مثال cURL

    curl http://localhost:5000/api/v1/documents/types \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "types": [
          {
            "value": "invoice_sales",
            "label": "فاتورة بيع",
            "category": "invoices"
          },
          {
            "value": "invoice_purchase",
            "label": "فاتورة شراء",
            "category": "invoices"
          },
          {
            "value": "payment_receive",
            "label": "سند قبض",
            "category": "payments"
          },
          {
            "value": "note_credit",
            "label": "إشعار دائن",
            "category": "notes"
          },
          {
            "value": "note_debit",
            "label": "إشعار مدين",
            "category": "notes"
          },
          {
            "value": "delivery_note",
            "label": "مذكرة تسليم",
            "category": "delivery"
          },
          {
            "value": "stock_transfer",
            "label": "إذن تحويل",
            "category": "inventory"
          },
          {
            "value": "stock_adjustment",
            "label": "تسوية جرد",
            "category": "inventory"
          },
          {
            "value": "journal_entry",
            "label": "قيد يومية",
            "category": "accounting"
          }
        ],
        "categories": [
          {
            "value": "invoices",
            "label": "الفواتير"
          },
          {
            "value": "payments",
            "label": "المدفوعات"
          },
          {
            "value": "expenses",
            "label": "المصروفات"
          },
          {
            "value": "returns",
            "label": "المرتجعات"
          },
          {
            "value": "notes",
            "label": "الإشعارات"
          },
          {
            "value": "delivery",
            "label": "مذكرات التسليم"
          },
          {
            "value": "inventory",
            "label": "المخزون"
          },
          {
            "value": "accounting",
            "label": "المحاسبة"
          }
        ],
        "statuses": [
          "draft",
          "posted",
          "confirmed",
          "dispatched",
          "delivered",
          "invoiced",
          "unpaid",
          "partial",
          "paid",
          "cancelled"
        ]
      }
    }

---

## الفئات

| الفئة | الأنواع |
|---|---|
| `invoices` | فاتورة بيع، فاتورة شراء |
| `payments` | سند قبض، سند صرف، سند استرداد، تخصيص رصيد |
| `expenses` | مصروف |
| `returns` | مرتجع بيع، مرتجع شراء |
| `notes` | إشعار دائن، إشعار مدين |
| `delivery` | مذكرة تسليم |
| `inventory` | إذن تحويل، تسوية جرد |
| `accounting` | قيد يومية |

---

## ملاحظات مهمة

1. يجب أن تكون قيمة `document_type` واحدة من أنواع المستندات الـ 15 المدعومة.
2. يُستخدم `party_id` لتصفية المستندات حسب العميل أو المورد، وفق نوع المستند.
3. يُستخدم `source_id` للإشارة إلى المستند الأصلي المرتبط، مثل `invoice_id` للإشعار.
4. قد تكون قيمة `journal_entry_id` مساوية لـ `null` لبعض المستندات التي لا تنشئ قيداً محاسبياً، مثل التحويل المخزني.
5. البحث (`search`) يعمل على رقم المستند واسم الطرف المرتبط به.
6. الترقيم (`page`, `limit`) يدعم حتى 200 مستند في الصفحة الواحدة، إذا كان هذا الحد معتمداً في Backend.
7. إحصائيات (`stats`) المستندات مفيدة للوحة التحكم والتقارير.
8. قائمة الأنواع (`types`) تُستخدم لبناء الفلاتر في الواجهة الأمامية، ويجب أن تتطابق مع الأنواع المدعومة فعلياً.
9. الصلاحية المطلوبة للوصول إلى جميع هذه المسارات هي `documents.view`.
10. تُجمع المستندات من مصادر متعددة باستخدام `UNION ALL`، ويجب التأكد من أن جميع الاستعلامات تستخدم نفس ترتيب وأنواع الأعمدة، مع تطبيق نطاق الشركة والصلاحيات على كل مصدر.

---

## تنبيهات مهمة للمطور

1. جدول الأنواع يوضح 15 نوعاً، لكن استجابة `GET /documents/types` النموذجية أعلاه تعرض بعض الأنواع فقط؛ يجب إكمال القائمة لتشمل جميع الأنواع المدعومة.
2. يجب أن تتطابق الحالات المتاحة في الفلاتر مع حالات كل نوع مستند، وعدم افتراض أن جميع المستندات تستخدم الحالات نفسها.
3. يجب التحقق من أن `stats` لا تجمع مبالغ مستندات مختلفة بطريقة تؤدي إلى تضخيم الإجماليات أو احتساب المستند نفسه مرتين.
4. يجب تحديد ما إذا كانت الإحصائيات تعرض المستندات الملغاة أو تستبعدها، وتوضيح ذلك في الاستجابة.
5. يجب تطبيق عزل بيانات الشركات في جميع الاستعلامات، وعدم السماح بعرض مستندات شركة أخرى.
6. يجب مطابقة أسماء الجداول والحقول والمسارات ورسائل الأخطاء مع تنفيذ Backend الفعلي قبل اعتماد هذه الوثيقة نهائياً.