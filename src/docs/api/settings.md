# ⚙️ Settings API — الإعدادات

## ما هو؟

نظام الإعدادات في OnixEdres يسمح بتخصيص إعدادات النظام لكل شركة بشكل مستقل.

**المميزات:**
- أكثر من 75 مفتاح إعداد.
- 14 قسماً رئيسياً.
- تحقق تلقائي من صحة كل قيمة.
- قابلية التوسع وإضافة إعدادات جديدة بسهولة.
- تخزين الإعدادات بشكل مستقل لكل شركة.

---

## البنية

يُخزّن كل إعداد في جدول `settings`:

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | معرف فريد |
| `company_id` | UUID | الشركة المالكة للإعداد |
| `key` | VARCHAR(100) | اسم الإعداد |
| `value` | JSONB | قيمة الإعداد (أي نوع بيانات) |

**القيد الفريد:**

`(company_id, key)`

يضمن عدم تكرار مفتاح الإعداد داخل الشركة نفسها، مع السماح للشركات المختلفة باستخدام المفتاح نفسه بقيم مختلفة.

---

## 1. GET /companies/settings — جلب كل الإعدادات

### ما هو؟
يعيد جميع إعدادات الشركة في شكل مسطّح (Flat Object).

### الصلاحية
`settings.view`

### مثال cURL

    curl http://localhost:5000/api/v1/companies/settings \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "timezone": "Asia/Aden",
        "date_format": "YYYY-MM-DD",
        "invoice_prefix": "INV-",
        "numbering_padding": 4,
        "inventory_method": "fifo",
        "invoice_show_logo": true,
        "invoice_due_days": 30,
        "notify_low_stock": true,
        "default_markup_percentage": 20
      }
    }

---

## 2. PUT /companies/settings — تحديث الإعدادات

### ما هو؟
يُحدّث إعداداً واحداً أو مجموعة إعدادات للشركة، دون الحاجة إلى إرسال جميع المفاتيح.

### الصلاحية
`settings.update`

### ماذا يرسل؟

    {
      "invoice_due_days": 45,
      "invoice_show_logo": false,
      "numbering_padding": 5
    }

### ماذا يحدث؟

1. التحقق من كل مفتاح باستخدام `SETTINGS_SCHEMA`.
2. المفاتيح غير المعروفة تُرفض بكود 400.
3. القيم غير الصالحة تُرفض بكود 400 مع تفاصيل الأخطاء.
4. القيم الصالحة تُحفظ باستخدام `INSERT ... ON CONFLICT DO UPDATE`.
5. يتم تحديث الإعدادات الخاصة بالشركة الحالية فقط.

### ماذا يرجع؟

    {
      "success": true,
      "message": "تم تحديث 3 إعداد",
      "data": {
        "updated": [
          "invoice_due_days",
          "invoice_show_logo",
          "numbering_padding"
        ]
      }
    }

### الأخطاء المحتملة

| الكود | الرسالة |
|---|---|
| 400 | `No settings provided` |
| 400 | `بعض الإعدادات غير صحيحة` (مع مصفوفة `errors`) |

**مثال استجابة خطأ:**

    {
      "success": false,
      "message": "بعض الإعدادات غير صحيحة",
      "errors": [
        {
          "key": "invoice_due_days",
          "error": "invoice_due_days must be <= 365"
        },
        {
          "key": "unknown_key",
          "error": "Unknown setting key: unknown_key"
        }
      ]
    }

---

## 3. GET /companies/settings/grouped — الإعدادات المجمّعة

### ما هو؟
يعيد إعدادات الشركة مجمّعة حسب القسم، لتسهيل عرضها في واجهة الإعدادات والقوائم الفرعية (Sub-Nav).

### الصلاحية
`settings.view`

### مثال cURL

    curl http://localhost:5000/api/v1/companies/settings/grouped \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "invoicing": {
          "invoice_prefix": "INV-",
          "invoice_due_days": 30,
          "invoice_show_logo": true,
          "invoice_template": "standard"
        },
        "inventory": {
          "inventory_method": "fifo",
          "inventory_allow_negative": false,
          "inventory_low_stock_threshold": 10
        },
        "numbering": {
          "numbering_purchase_order_prefix": "PO-",
          "numbering_padding": 4
        },
        "payments": {
          "payment_allow_partial": true,
          "payment_cash_account_id": null
        }
      }
    }

### كيف يعمل التجميع؟

يُحدّد القسم من بادئة مفتاح الإعداد (Prefix):

| البادئة | القسم |
|---|---|
| `invoice_*` | `invoicing` |
| `inventory_*` | `inventory` |
| `numbering_*` | `numbering` |
| `payment_*` | `payments` |
| `notify_*` | `notifications` |
| `pdf_*` | `printing` |
| `locale_*` | `localization` |
| `security_*` | `security` |
| `accounting_*` | `accounting` |
| `b2b_*` | `b2b` |
| `tax_*` | `tax` |
| `partners_*` | `partners` |
| `stock_transfer_*` | `stock_transfer` |
| `stock_adjustment_*` | `stock_adjustment` |
| `notes_*` | `notes` |
| `delivery_note_*` | `delivery_note` |

---

## 4. GET /companies/payment-accounts — حسابات الدفع

### ما هو؟
يعيد الحسابات النقدية والبنكية المتاحة للشركة، لاستخدامها في إعدادات الدفع.

### الصلاحية
`settings.view`

### مثال cURL

    curl http://localhost:5000/api/v1/companies/payment-accounts \
      -H "Authorization: Bearer <TOKEN>"

### ماذا يرجع؟

    {
      "success": true,
      "data": {
        "cash_accounts": [
          {
            "id": "uuid",
            "code": "1111",
            "name": "الصندوق"
          }
        ],
        "bank_accounts": [
          {
            "id": "uuid",
            "code": "1112",
            "name": "البنك"
          }
        ]
      }
    }

### الاستخدام

- `payment_cash_account_id` ← يُختار من `cash_accounts`.
- `payment_bank_account_id` ← يُختار من `bank_accounts`.

---

## المفاتيح المتاحة (75+)

### 1. عام (General)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `timezone` | string | `Asia/Aden` |
| `date_format` | string | `YYYY-MM-DD` |
| `fiscal_year_start` | string | `01-01` |

### 2. الفواتير (Invoicing)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `invoice_prefix` | string | `INV-` |
| `invoice_next_number` | number | `1` |
| `invoice_show_logo` | boolean | `true` |
| `invoice_show_tax_number` | boolean | `true` |
| `invoice_show_barcode` | boolean | `true` |
| `invoice_show_signature` | boolean | `true` |
| `invoice_footer` | string | `شكراً لتعاملكم معنا` |
| `invoice_terms` | string | — |
| `invoice_due_days` | number (0-365) | `30` |
| `invoice_template` | string | `standard` |
| `invoice_currency_display` | string | `symbol` |

### 3. الترقيم (Numbering)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `numbering_purchase_order_prefix` | string | `PO-` |
| `numbering_sales_order_prefix` | string | `SO-` |
| `numbering_payment_receipt_prefix` | string | `REC-` |
| `numbering_payment_voucher_prefix` | string | `PAY-` |
| `numbering_expense_prefix` | string | `EXP-` |
| `numbering_return_prefix` | string | `RET-` |
| `numbering_journal_prefix` | string | `JE-` |
| `numbering_padding` | number (1-10) | `4` |
| `numbering_reset_yearly` | boolean | `false` |

### 4. المخزون (Inventory)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `inventory_method` | string | `fifo` |
| `inventory_allow_negative` | boolean | `false` |
| `inventory_low_stock_threshold` | number | `10` |
| `inventory_expiry_notify_days` | number | `30` |
| `inventory_expiry_warning_days` | number | `90` |
| `inventory_require_batch_on_sale` | boolean | `true` |
| `inventory_auto_reserve_on_approve` | boolean | `true` |
| `inventory_show_expired_in_sale` | boolean | `false` |

### 5. الضرائب (Tax)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `tax_default_rate` | number (0-100) | `15` |
| `tax_inclusive_pricing` | boolean | `false` |
| `tax_calculation_method` | string | `line` |
| `tax_show_on_invoice` | boolean | `true` |

### 6. الإشعارات (Notifications)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `notify_new_order` | boolean | `true` |
| `notify_payment_received` | boolean | `true` |
| `notify_low_stock` | boolean | `true` |
| `notify_expiry` | boolean | `true` |
| `notify_daily_summary` | boolean | `true` |
| `notify_weekly_report` | boolean | `false` |
| `notify_channel_email` | boolean | `false` |
| `notify_channel_sms` | boolean | `false` |
| `notify_channel_whatsapp` | boolean | `false` |

### 7. الطباعة وPDF (Printing)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `pdf_paper_size` | string | `A4` |
| `pdf_orientation` | string | `portrait` |
| `pdf_font` | string | `Cairo` |
| `pdf_font_size` | number (6-24) | `12` |
| `pdf_show_watermark` | boolean | `false` |
| `pdf_watermark_text` | string | `مسودة` |
| `pdf_show_page_numbers` | boolean | `true` |
| `pdf_header_text` | string | — |

### 8. اللغة (Localization)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `locale_language` | string | `ar` |
| `locale_number_format` | string | `1,234.56` |
| `locale_decimal_places` | number | `2` |
| `locale_currency_position` | string | `suffix` |
| `locale_week_start_day` | string | `saturday` |
| `locale_calendar` | string | `gregorian` |

### 9. المدفوعات (Payments)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `payment_allow_partial` | boolean | `true` |
| `payment_allow_overpayment` | boolean | `false` |
| `payment_default_terms_days` | number | `30` |
| `payment_auto_apply_credit` | boolean | `true` |
| `payment_cash_account_id` | uuid/null | `null` |
| `payment_bank_account_id` | uuid/null | `null` |

### 10. الشركاء (Partners)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `partners_customer_default_terms` | number | `30` |
| `partners_supplier_default_terms` | number | `30` |
| `partners_customer_credit_check` | boolean | `true` |
| `partners_require_tax_number` | boolean | `false` |

### 11. الأمان (Security)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `security_password_min_length` | number (6-128) | `8` |
| `security_password_require_upper` | boolean | `true` |
| `security_password_require_number` | boolean | `true` |
| `security_session_timeout_minutes` | number | `60` |
| `security_max_login_attempts` | number | `5` |
| `security_require_2fa` | boolean | `false` |

### 12. المحاسبة (Accounting)

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `accounting_auto_post_journal` | boolean | `true` |
| `accounting_allow_manual_journal` | boolean | `true` |
| `accounting_require_approval` | boolean | `false` |
| `accounting_rounding_method` | string | `nearest` |
| `accounting_cost_center_enabled` | boolean | `false` |

### 13. B2B

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `b2b_enabled` | boolean | `true` |
| `b2b_auto_approve_connections` | boolean | `false` |
| `b2b_portal_show_prices` | boolean | `true` |
| `b2b_portal_show_invoices` | boolean | `true` |

### 14. المستندات الجديدة

| المفتاح | النوع | الافتراضي |
|---|---|---|
| `numbering_stock_transfer_prefix` | string | `TRF-` |
| `numbering_stock_adjustment_prefix` | string | `ADJ-` |
| `numbering_credit_note_prefix` | string | `CN-` |
| `numbering_debit_note_prefix` | string | `DN-` |
| `numbering_goods_receipt_prefix` | string | `GRN-` |
| `numbering_delivery_note_prefix` | string | `DN-` |
| `notes_auto_journal` | boolean | `true` |
| `delivery_note_auto_deduct_stock` | boolean | `true` |
| `stock_adjustment_auto_journal` | boolean | `true` |

---

## التحقق (Validation)

يحتوي كل مفتاح في `SETTINGS_SCHEMA` على قواعد للتحقق من صحة قيمته.

### خصائص التحقق

| الحقل | الوصف |
|---|---|
| `type` | نوع القيمة: `string`, `number`, `boolean`, `uuid` |
| `enum` | قائمة القيم المسموحة (اختياري) |
| `min` | الحد الأدنى للقيمة الرقمية |
| `max` | الحد الأعلى للقيمة الرقمية |
| `maxLength` | أقصى طول للنص |
| `pattern` | تعبير منتظم للتحقق من النص (اختياري) |
| `nullable` | يحدد السماح بالقيمة `null` |

### مثال

    invoice_due_days: {
      type: 'number',
      min: 0,
      max: 365
    },

    invoice_template: {
      type: 'string',
      enum: ['standard', 'modern', 'minimal']
    },

    payment_cash_account_id: {
      type: 'uuid',
      nullable: true
    }

---

## Migration — ترحيل الإعدادات

### عند إضافة مفتاح إعداد جديد

يجب تنفيذ الخطوات التالية:

1. إضافة المفتاح إلى `data/defaultSettings.js` ليُستخدم مع الشركات الجديدة.
2. إضافته إلى `SETTINGS_SCHEMA` في `services/settingsService.js` لتفعيل التحقق من صحته.
3. تشغيل `node scripts/migrate-settings.js` لإضافة الإعداد إلى الشركات الموجودة.

### أوامر تشغيل السكربت

**معاينة التغييرات دون تطبيقها (Dry Run):**

    node scripts/migrate-settings.js --dry-run

**تطبيق التغييرات:**

    node scripts/migrate-settings.js

**التطبيق مع عرض التفاصيل:**

    node scripts/migrate-settings.js --verbose

---

## ملاحظات مهمة

1. تُخزّن كل قيمة إعداد في عمود `value` من نوع JSONB، مما يسمح بتخزين أنواع بيانات مختلفة.
2. القيد الفريد `(company_id, key)` يمنع تكرار الإعداد داخل الشركة الواحدة.
3. الدالة `updateSettings` تدعم التحديث الجزئي؛ لذلك لا يلزم إرسال جميع المفاتيح.
4. الدالة `getSettingsGrouped` تجمع الإعدادات حسب البادئة (Prefix).
5. المفاتيح غير المعروفة تُرفض بكود 400.
6. القيم غير الصالحة تُرفض بكود 400 مع تفاصيل الأخطاء.
7. الدالة `initDefaults` تستخدم `ON CONFLICT DO NOTHING`، مما يجعل تهيئة الإعدادات آمنة عند تشغيلها أكثر من مرة.
8. السكربت `migrate-settings.js` يُستخدم لتطبيق الإعدادات الافتراضية الجديدة على الشركات الموجودة.
9. يُعد `SETTINGS_SCHEMA` المرجع الأساسي لقواعد التحقق من مفاتيح الإعدادات.
10. الصلاحيات المطلوبة:
    - `settings.view`
    - `settings.update`
11. القيمة `null` في `payment_cash_account_id` و`payment_bank_account_id` تعني استخدام الحساب الافتراضي (1111/1112)، وفق آلية النظام.
12. يُستخدم `invoice_next_number` عند إنشاء أول فاتورة، وفق آلية الترقيم المعتمدة.

---

## تنبيهات مهمة للمطور

1. يجب التأكد من أن عدد المفاتيح الفعلي في `SETTINGS_SCHEMA` يطابق العدد المذكور في التوثيق.
2. يجب أن تتطابق المفاتيح في `defaultSettings.js` و`SETTINGS_SCHEMA` مع المفاتيح التي تقبلها واجهة API.
3. يجب عدم السماح بتحديث إعدادات شركة أخرى، والتحقق دائماً من `company_id` المستخرج من جلسة المستخدم.
4. يجب التحقق من أن حسابات الدفع المختارة تنتمي إلى الشركة الحالية، وأنها حسابات نشطة ومناسبة لطبيعة الدفع.
5. يجب عدم السماح بتغيير إعدادات حساسة مثل إعدادات الأمان دون الصلاحيات المناسبة.
6. يجب تنفيذ تحديثات الإعدادات بطريقة آمنة، مع مراعاة سلامة البيانات عند تحديث أكثر من مفتاح.
7. يجب التأكد من أن `migrate-settings.js --dry-run` لا يُجري أي تعديل فعلي على قاعدة البيانات.
8. يجب مراجعة قواعد التحقق عند إضافة أي مفتاح جديد أو تغيير نوعه أو قيمته الافتراضية.
9. توجد بادئات إضافية في قائمة التجميع مثل `notes_*` و`delivery_note_*` و`stock_transfer_*` و`stock_adjustment_*`؛ يجب التأكد من دعمها في آلية التجميع الفعلية.
10. يجب مطابقة أسماء المسارات والحقول والصلاحيات والرسائل مع تنفيذ Backend قبل اعتماد هذه الوثيقة نهائياً.

---

## ✅ تحقق

بعد حفظ الملف، تأكد من وجود الأقسام التالية:

- [ ] `# ⚙️ Settings API`
- [ ] `## ما هو؟`
- [ ] `## البنية`
- [ ] `## 1. GET /companies/settings`
- [ ] `## 2. PUT /companies/settings`
- [ ] `## 3. GET /companies/settings/grouped`
- [ ] `## 4. GET /companies/payment-accounts`
- [ ] `## المفاتيح المتاحة (75+)` — 14 قسماً
- [ ] `## التحقق (Validation)`
- [ ] `## Migration`
- [ ] `## ملاحظات مهمة` — 12 نقطة


---

