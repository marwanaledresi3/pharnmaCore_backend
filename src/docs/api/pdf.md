# 📄 PDF API — ملفات PDF

## ما هو؟

توفر هذه الواجهة إمكانية إنشاء ومعاينة وتحميل ملفات PDF للمستندات المالية والمخزنية في النظام.

**المستندات المدعومة:**

1. فاتورة بيع أو شراء.
2. مرتجع بيع أو شراء.
3. سند قبض أو صرف.
4. أمر شراء.
5. أمر بيع.
6. مذكرة تسليم.
7. مصروف.
8. كشف حساب.
9. ميزان مراجعة.
10. إشعار دائن أو مدين.
11. إذن استلام.
12. إذن تحويل.
13. تسوية جرد.

**المزايا:**
- دعم اللغة العربية بالكامل واتجاه RTL.
- استخدام خط Cairo.
- رأس الشركة مع الشعار والبيانات.
- تذييل وإطار للصفحات.
- ترقيم الصفحات.
- دعم المستندات متعددة الصفحات تلقائياً.
- إمكانية المعاينة أو التحميل.

---

## 1. GET /pdf/invoices/:id — فاتورة

### ما هو؟
يُولّد ملف PDF لفاتورة بيع أو شراء.

### الصلاحية
`invoices.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/invoices/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o invoice.pdf

### Response

- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="invoice-INV-0001.pdf"`

---

## 2. GET /pdf/returns/:id — مرتجع

### ما هو؟
يُولّد ملف PDF لمرتجع بيع أو شراء.

### الصلاحية
`invoices.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/returns/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o return.pdf

---

## 3. GET /pdf/payments/:id — سند قبض أو صرف

### ما هو؟
يُولّد ملف PDF لسند قبض أو سند صرف، بحسب نوع العملية.

### الصلاحية
`payments.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/payments/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o voucher.pdf

---

## 4. GET /pdf/purchase-orders/:id — أمر شراء

### ما هو؟
يُولّد ملف PDF لأمر شراء مع تفاصيل المورد والمنتجات والكميات والأسعار.

### الصلاحية
`purchase_orders.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/purchase-orders/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o purchase-order.pdf

---

## 5. GET /pdf/sales-orders/:id — أمر بيع

### ما هو؟
يُولّد ملف PDF لأمر بيع مع تفاصيل العميل والمنتجات والكميات والأسعار.

### الصلاحية
`sales_orders.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/sales-orders/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o sales-order.pdf

---

## 6. GET /pdf/delivery-notes/:id — مذكرة تسليم

### ما هو؟
يُولّد ملف PDF لمذكرة تسليم البضاعة.

### الصلاحية
`purchase_orders.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/delivery-notes/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o delivery-note.pdf

---

## 7. GET /pdf/expenses/:id — مصروف

### ما هو؟
يُولّد ملف PDF لمستند مصروف مع تفاصيل المبلغ والتصنيف والبيانات المرتبطة به.

### الصلاحية
`expenses.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/expenses/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o expense.pdf

---

## 8. GET /pdf/statements/:partyType/:id — كشف حساب

### ما هو؟
يُولّد ملف PDF لكشف حساب عميل أو مورد خلال فترة زمنية محددة.

### الصلاحية
`reports.view_financial`

### المعاملات

| المعامل | القيمة |
|---|---|
| `partyType` | customer أو supplier |
| `id` | UUID |
| `date_from` | اختياري — YYYY-MM-DD |
| `date_to` | اختياري — YYYY-MM-DD |

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/statements/customer/abc-123?date_from=2026-01-01&date_to=2026-01-31" \
      -H "Authorization: Bearer <TOKEN>" \
      -o statement.pdf

---

## 9. GET /pdf/reports/trial-balance — ميزان مراجعة

### ما هو؟
يُولّد ملف PDF لتقرير ميزان المراجعة، ويعرض أرصدة الحسابات المدينة والدائنة خلال الفترة المحددة.

### الصلاحية
`reports.view_financial`

### المعاملات

| المعامل | القيمة |
|---|---|
| `date_from` | اختياري — YYYY-MM-DD |
| `date_to` | اختياري — YYYY-MM-DD |

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/reports/trial-balance?date_from=2026-01-01" \
      -H "Authorization: Bearer <TOKEN>" \
      -o trial-balance.pdf

---

## 10. GET /pdf/notes/:id — إشعار دائن أو مدين

### ما هو؟
يُولّد ملف PDF لإشعار دائن أو مدين، مع تفاصيل الطرف والمبلغ والسبب والمستند المرتبط إن وجد.

### الصلاحية
`notes.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/notes/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o credit-note.pdf

---

## 11. GET /pdf/goods-receipts/:id — إذن استلام

### ما هو؟
يُولّد ملف PDF لإذن استلام البضاعة، مع بيانات المورد والمستودع والدفعات والكميات والأسعار.

### الصلاحية
`goods_receipts.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/goods-receipts/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o goods-receipt.pdf

---

## 12. GET /pdf/stock-transfers/:id — إذن تحويل

### ما هو؟
يُولّد ملف PDF لإذن تحويل المخزون بين المستودعات، مع بيانات المستودع المصدر والمستودع المستهدف والمنتجات والكميات.

### الصلاحية
`stock_transfers.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/stock-transfers/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o stock-transfer.pdf

---

## 13. GET /pdf/stock-adjustments/:id — تسوية جرد

### ما هو؟
يُولّد ملف PDF لتسوية الجرد، مع الكميات المسجلة والكميات الفعلية والفروقات وأسباب التسوية.

### الصلاحية
`stock_adjustments.view`

### مثال cURL

    curl -X GET "http://localhost:5000/api/v1/pdf/stock-adjustments/abc-123" \
      -H "Authorization: Bearer <TOKEN>" \
      -o stock-adjustment.pdf

---

## الواجهة (React)

### 1. المعاينة (فتح في نافذة جديدة)

استدعاء دوال المعاينة من `pdfApi`:

    import { pdfApi } from '../api/pdfApi';

    // معاينة إشعار
    await pdfApi.previewNote(note.id);

    // معاينة إذن استلام
    await pdfApi.previewGoodsReceipt(gr.id);

### 2. التحميل

استدعاء دوال التحميل من `pdfApi`:

    import { pdfApi } from '../api/pdfApi';

    // تحميل إشعار
    await pdfApi.downloadNotePdf(note.id, note.note_number);

    // تحميل إذن استلام
    await pdfApi.downloadGoodsReceiptPdf(gr.id, gr.receipt_number);

### كيف يعمل؟

**أولاً: `openPdf(path)`**

1. يفتح نافذة جديدة باستخدام `window.open`.
2. يعرض رسالة "جاري التحميل...".
3. يجلب ملف PDF من Backend مع إرسال `Authorization` header.
4. يحوّل الاستجابة إلى `Blob`.
5. ينشئ `blob URL`.
6. يعرض ملف PDF داخل النافذة المفتوحة.

**ثانياً: `downloadPdf(path, filename)`**

1. يجلب ملف PDF من Backend مع إرسال `Authorization` header.
2. يحوّل الاستجابة إلى `Blob`.
3. ينشئ رابط تحميل مؤقتاً.
4. ينفّذ التحميل تلقائياً باسم الملف المحدد.
5. ينظّف الرابط المؤقت بعد انتهاء الاستخدام.

---

## الأخطاء الشائعة

| الكود | الرسالة | الحل |
|---|---|---|
| 401 | `Authentication required` | تحقق من صلاحية التوكن وإرساله |
| 403 | `Forbidden` | تحقق من صلاحيات المستخدم |
| 404 | `X not found` | تحقق من معرّف المستند `id` |
| 500 | `فشل إنشاء PDF` | راجع سجلات Backend وأخطاء إنشاء PDF |

---

## ملاحظات مهمة

1. تستخدم دالة `openPdf` جلب ملف PDF وتحويله إلى `Blob` أولاً؛ لأن `window.open` لا يرسل ترويسة `Authorization` تلقائياً.
2. تُولّد ملفات PDF في الذاكرة، ولا تُخزّن على السيرفر، ما لم يُنفّذ النظام آلية تخزين إضافية.
3. الحجم التقريبي للملفات عادةً 50-200 KB، وقد يختلف حسب عدد الصفحات والصور والبيانات.
4. تستخدم القوالب خطوطاً عربية مثل Cairo لدعم النصوص العربية واتجاه RTL.
5. توجد قوالب المستندات في `services/pdf/templates/` وفق تنظيم المشروع الفعلي.
6. يُستخدم `pdfLayout.drawCompanyHeader` لرسم رأس الشركة، بما يشمل الشعار والاسم والبيانات.
7. التذييل والإطار وترقيم الصفحات تُدار تلقائياً من أدوات تخطيط PDF المشتركة.
8. إعداد `helmet({ contentSecurityPolicy: false })` قد يُستخدم لمعالجة مشكلات Swagger، لكنه ليس شرطاً لإنشاء ملفات PDF بحد ذاته.
9. الصلاحيات تختلف حسب نوع المستند، ويجب التحقق من صلاحية المستخدم قبل جلب بيانات المستند وإنشاء ملفه.
10. يختلف `document_type` المستخدم في واجهة المستندات الموحدة عن نوع PDF؛ فالأول يحدد تصنيف المستند في القائمة الموحدة، والثاني يحدد قالب ومسار إنشاء ملف PDF.

---

## تنبيهات مهمة للمطور

1. يجب التأكد من أن جميع مسارات PDF المذكورة مسجلة فعلياً في Router ومتصلة بالـ Controller الصحيح.
2. يجب التأكد من أن صلاحية كل مسار مناسبة لنوع المستند، وعدم الاعتماد على إخفاء زر التحميل في الواجهة فقط.
3. يجب تطبيق عزل بيانات الشركات والتحقق من ملكية المستند قبل إنشاء PDF.
4. يجب أن تكون بيانات PDF مأخوذة من Backend، وليس من قيم مرسلة من الواجهة الأمامية.
5. يجب التأكد من تضمين الخطوط العربية المطلوبة في بيئة الإنتاج، وأن مسارات الخطوط صحيحة.
6. يجب التعامل مع أخطاء الخطوط والصور والشعار والبيانات الناقصة دون تعطيل إنشاء المستندات الأخرى.
7. يجب مراعاة إغلاق النوافذ المؤقتة وتنظيف `Blob URLs` بعد الانتهاء، لتجنب استهلاك الذاكرة.
8. يجب اختبار ملفات PDF متعددة الصفحات والتأكد من عدم انقسام الجداول أو اختفاء التذييلات.
9. يجب التأكد من أن `Content-Type` و`Content-Disposition` مضبوطتان بشكل صحيح للمعاينة والتحميل.
10. يجب مطابقة أسماء الدوال والملفات والمسارات والصلاحيات مع تنفيذ Backend وReact الفعلي قبل اعتماد هذه الوثيقة نهائياً.