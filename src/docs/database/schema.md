# 🗄️ Database Schema

## 1. نظرة عامة

يوضح هذا الملف بنية قاعدة بيانات **OnixEdres**، والجداول الرئيسية، والعلاقات بينها، والقيود والفهارس والـ Triggers المستخدمة.

### إحصاءات قاعدة البيانات

- حوالي 35 جدولاً.
- 8 مجموعات رئيسية.
- معظم الجداول مرتبطة بشركة من خلال `company_id`.
- جدول `global_products` هو الاستثناء، لأنه يمثل كتالوج المنتجات العالمي المشترك.

> **ملاحظة:** الأعداد وأسماء الأعمدة والقيود الواردة هنا توثيق مرجعي، ويجب مطابقتها مع ملفات SQL الفعلية قبل اعتمادها باعتبارها وصفاً نهائياً لقاعدة البيانات.

---

# 2. المجموعة الأولى: Multi-tenancy

تحتوي هذه المجموعة على الشركات والمستخدمين والفروع ونظام الأدوار والصلاحيات.

## 2.1 جدول `companies` — الشركات

يمثل الشركات المسجلة في النظام.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `name` | VARCHAR(200) | اسم الشركة بالعربية |
| `name_en` | VARCHAR(200) | اسم الشركة بالإنجليزية |
| `currency_id` | UUID | مرجع العملة الافتراضية |
| `tax_number` | VARCHAR(50) | الرقم الضريبي |
| `address` | TEXT | عنوان الشركة |
| `logo_url` | TEXT | رابط شعار الشركة |
| `use_shared_logo` | BOOLEAN | استخدام الشعار المشترك |
| `default_markup_percentage` | NUMERIC(5,2) | نسبة الزيادة الافتراضية (0–1000) |
| `is_active` | BOOLEAN | حالة الشركة |

## 2.2 جدول `users` — المستخدمون

يمثل حسابات المستخدمين داخل النظام.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة التابعة للمستخدم |
| `name` | VARCHAR(150) | اسم المستخدم |
| `email` | VARCHAR(255) | البريد الإلكتروني |
| `password_hash` | VARCHAR(255) | كلمة المرور المشفرة باستخدام bcrypt |
| `user_type` | VARCHAR(20) | نوع المستخدم: internal / external |
| `branch_id` | UUID | الفرع المرتبط بالمستخدم |
| `is_active` | BOOLEAN | حالة المستخدم |

## 2.3 جدول `branches` — الفروع

يمثل الفروع التابعة للشركات.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة المالكة للفرع |
| `name` | VARCHAR(150) | اسم الفرع |
| `code` | VARCHAR(30) | رمز الفرع، فريد لكل شركة |
| `warehouse_id` | UUID | المستودع المرتبط بالفرع |
| `is_main` | BOOLEAN | تحديد الفرع الرئيسي |

## 2.4 جداول الأدوار والصلاحيات

| الجدول | الوصف |
|---|---|
| `roles` | تعريف أدوار المستخدمين مثل Owner وAccountant |
| `permissions` | تعريف صلاحيات النظام، حوالي 132 صلاحية |
| `role_permissions` | ربط الأدوار بالصلاحيات بعلاقة many-to-many |
| `user_roles` | ربط المستخدمين بالأدوار بعلاقة many-to-many |

---

# 3. المجموعة الثانية: المنتجات والمخزون

تحتوي على المنتجات ووحداتها ودفعاتها ومستودعاتها وحركات المخزون.

## 3.1 جدول `products` — المنتجات

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة المالكة للمنتج |
| `sku` | VARCHAR(50) | رمز المنتج، فريد لكل شركة |
| `barcode` | VARCHAR(100) | الباركود |
| `name` | VARCHAR(200) | اسم المنتج |
| `unit` | VARCHAR(30) | الوحدة النصية |
| `base_unit_id` | UUID | الوحدة الأساسية المرتبطة بالمنتج |
| `cost_price` | NUMERIC(14,2) | سعر الشراء |
| `selling_price` | NUMERIC(14,2) | سعر البيع |
| `markup_percentage` | NUMERIC(5,2) | نسبة الزيادة الخاصة بالمنتج |
| `pricing_policy` | VARCHAR(20) | سياسة التسعير: fixed / auto_markup |
| `global_product_id` | UUID | مرجع المنتج في الكتالوج العالمي |
| `min_stock_level` | NUMERIC(14,3) | الحد الأدنى للمخزون |
| `tax_rate_id` | UUID | مرجع الضريبة |
| `revenue_account_id` | UUID | حساب الإيرادات |
| `inventory_account_id` | UUID | حساب المخزون |
| `cogs_account_id` | UUID | حساب تكلفة البضاعة المباعة |

## 3.2 جدول `product_units` — وحدات المنتجات

يتيح تعريف وحدات متعددة للمنتج مع معامل تحويل بين الوحدات.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `product_id` | UUID | المنتج المرتبط |
| `unit_id` | UUID | الوحدة المرتبطة |
| `conversion_factor` | NUMERIC(14,6) | عدد الوحدات الأساسية المكافئة |
| `is_base_unit` | BOOLEAN | تحديد الوحدة الأساسية |
| `sale_price` | NUMERIC(14,2) | سعر البيع بهذه الوحدة |
| `purchase_price` | NUMERIC(14,2) | سعر الشراء بهذه الوحدة |
| `barcode` | VARCHAR(100) | باركود الوحدة |

## 3.3 جدول `product_batches` — دفعات المنتجات

يخزن بيانات دفعات المنتجات داخل المستودعات.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `product_id` | UUID | المنتج |
| `warehouse_id` | UUID | المستودع |
| `batch_number` | VARCHAR(100) | رقم الدفعة |
| `expiry_date` | DATE | تاريخ انتهاء الصلاحية |
| `cost_price` | NUMERIC(14,2) | تكلفة الدفعة |
| `cost_price_base` | NUMERIC(14,2) | التكلفة بالعملة الأساسية |
| `quantity` | NUMERIC(14,3) | الكمية المتوفرة |

**القيد الفريد الموثق:**

`(product_id, warehouse_id, batch_number)`

## 3.4 جدول `warehouses` — المستودعات

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة المالكة |
| `name` | VARCHAR(150) | اسم المستودع، فريد لكل شركة |
| `code` | VARCHAR(30) | رمز المستودع |
| `is_default` | BOOLEAN | تحديد المستودع الافتراضي |

## 3.5 جدول `stock_movements` — حركات المخزون

يسجل جميع الحركات التي تؤثر على المخزون.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `warehouse_id` | UUID | المستودع |
| `batch_id` | UUID | دفعة المنتج |
| `movement_type` | VARCHAR(20) | نوع الحركة: in / out / adjustment / transfer وغيرها |
| `quantity` | NUMERIC(14,3) | كمية الحركة موجبة أو سالبة |
| `unit_cost` | NUMERIC(14,2) | تكلفة الوحدة |
| `reference_type` | VARCHAR(30) | نوع المستند المصدر |
| `reference_id` | UUID | معرف المستند المصدر |

## 3.6 جدول `stock_reservations` — حجوزات المخزون

يستخدم لتسجيل الكميات المحجوزة ومنع استخدامها في عمليات أخرى.

الحالات الموثقة:

- `active`
- `consumed`
- `released`
- `expired`

أنواع المراجع تشمل:

- `sales_order`
- `purchase_order`

## 3.7 جدول `product_price_history` — سجل تغير الأسعار

يحتفظ بتاريخ تغير أسعار المنتجات.

قيم `change_source` الموثقة:

- `purchase`
- `manual`
- `bulk_update`
- `import`

---

# 4. المجموعة الثالثة: المحاسبة

تحتوي على شجرة الحسابات والقيود والفواتير والمدفوعات والمصروفات والمرتجعات.

## 4.1 جدول `chart_of_accounts` — شجرة الحسابات

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `code` | VARCHAR(20) | رمز الحساب، فريد لكل شركة |
| `name` | VARCHAR(150) | اسم الحساب |
| `account_type` | VARCHAR(20) | نوع الحساب |
| `parent_id` | UUID | الحساب الأب، مرجع ذاتي |
| `is_active` | BOOLEAN | حالة الحساب |

أنواع الحسابات:

- `asset`
- `liability`
- `equity`
- `revenue`
- `expense`

## 4.2 جدول `journal_entries` — القيود المحاسبية

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `entry_number` | INTEGER | رقم القيد، فريد لكل شركة |
| `entry_date` | DATE | تاريخ القيد |
| `description` | TEXT | وصف القيد |
| `source_type` | VARCHAR(30) | نوع مصدر القيد |
| `source_id` | UUID | معرف المستند المصدر |
| `status` | VARCHAR(20) | حالة القيد: draft / posted |
| `posted_at` | TIMESTAMPTZ | وقت ترحيل القيد |

يدعم `source_type` الموثق 16 نوعاً، ويجب مراجعة قائمة الأنواع الفعلية في قيود قاعدة البيانات والكود.

## 4.3 جدول `journal_entry_lines` — تفاصيل القيود

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `journal_entry_id` | UUID | القيد المحاسبي، مع CASCADE |
| `account_id` | UUID | الحساب المحاسبي |
| `debit` | NUMERIC(14,2) | مبلغ المدين |
| `credit` | NUMERIC(14,2) | مبلغ الدائن |
| `description` | TEXT | وصف السطر |

**قيد التحقق الموثق:**

يمنع أن يحتوي السطر نفسه على مبلغ مدين ومبلغ دائن أكبر من صفر في الوقت نفسه:

`CHECK (NOT (debit > 0 AND credit > 0))`

## 4.4 جدول `invoices` — الفواتير

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `invoice_number` | VARCHAR(50) | رقم الفاتورة، فريد لكل شركة |
| `invoice_type` | VARCHAR(20) | نوع الفاتورة: sales / purchase |
| `reference_type` | VARCHAR(20) | نوع المستند المرجعي |
| `reference_id` | UUID | معرف المستند المرجعي |
| `customer_id` | UUID | العميل |
| `supplier_id` | UUID | المورد |
| `total` | NUMERIC(14,2) | إجمالي الفاتورة |
| `paid_amount` | NUMERIC(14,2) | المبلغ المدفوع |
| `status` | VARCHAR(20) | حالة الفاتورة |
| `journal_entry_id` | UUID | القيد المحاسبي المرتبط |

أنواع المراجع الموثقة تشمل:

- `sales_order`
- `purchase_order`
- `delivery_note`

الحالات الموثقة:

- `unpaid`
- `partial`
- `paid`
- `cancelled`

## 4.5 جدول `invoice_items` — بنود الفواتير

يمثل تفاصيل المنتجات والخدمات داخل الفاتورة.

الحقول الموثقة:

- `quantity`
- `unit_price`
- `line_total`
- `batch_id`
- `unit_id`
- `conversion_factor`

## 4.6 جدول `payments` — المدفوعات

| العمود | النوع | الوصف |
|---|---|---|
| `id` | UUID | المفتاح الأساسي |
| `company_id` | UUID | الشركة |
| `payment_type` | VARCHAR(20) | نوع العملية |
| `amount` | NUMERIC(14,2) | مبلغ العملية، أكبر من صفر |
| `invoice_id` | UUID | الفاتورة المرتبطة |
| `customer_id` | UUID | العميل |
| `supplier_id` | UUID | المورد |
| `voucher_number` | VARCHAR(50) | رقم السند |
| `journal_entry_id` | UUID | القيد المحاسبي المرتبط |
| `refund_of_payment_id` | UUID | مرجع عملية الدفع الأصلية |

قيم `payment_type`:

- `receive`
- `pay`
- `refund`
- `credit_apply`

## 4.7 جدول `expenses` — المصروفات

يمثل المصروفات المسجلة على الشركة.

قيم `payment_type` الموثقة:

- `cash`
- `credit`
- `partial`

الحالات الموثقة:

- `draft`
- `posted`
- `partial`
- `paid`
- `cancelled`

## 4.8 جدولَا `returns` و`return_items` — المرتجعات

يمثلان عمليات إرجاع المبيعات والمشتريات وتفاصيلها.

قيم `return_type`:

- `sale`
- `purchase`

الحالات:

- `draft`
- `confirmed`
- `cancelled`

## 4.9 الجداول المرجعية

| الجدول | الوظيفة |
|---|---|
| `currencies` | تعريف العملات |
| `exchange_rates` | أسعار صرف العملات |
| `tax_rates` | تعريف نسب الضرائب |
| `units` | تعريف وحدات القياس |

---

# 5. المجموعة الرابعة: المستندات الجديدة

تحتوي على المستندات التشغيلية والمخزنية التي تمت إضافتها إلى النظام.

## 5.1 جدولَا `notes` و`note_items` — إشعارات المدين والدائن

يمثلان إشعارات المدين والدائن وبنود كل إشعار.

| الحقل | النوع | الوصف |
|---|---|---|
| `note_type` | VARCHAR(20) | نوع الإشعار: credit / debit |
| `party_type` | VARCHAR(20) | نوع الطرف: customer / supplier |
| `reason` | VARCHAR(50) | سبب الإشعار |
| `status` | VARCHAR(20) | حالة الإشعار |

الأسباب الموثقة:

- `return`
- `discount`
- `correction`
- `price_diff`
- `shipping`
- `other`

الحالات:

- `draft`
- `confirmed`
- `cancelled`

**قيد التحقق الموثق:**

يجب تحديد طرف واحد فقط؛ إما عميل أو مورد، ولا يسمح بتحديد الاثنين معاً أو تركهما فارغين:

`CHECK ((customer_id IS NOT NULL AND supplier_id IS NULL) OR (customer_id IS NULL AND supplier_id IS NOT NULL))`

## 5.2 جدولَا `delivery_notes` و`delivery_note_items` — مذكرات التسليم

يمثلان مستندات تسليم البضائع للعملاء وتفاصيل المنتجات المسلمة.

الحالات الموثقة:

- `draft`
- `dispatched`
- `delivered`
- `invoiced`
- `cancelled`

حقول بيانات الشحن والتسليم:

| الحقل | الوصف |
|---|---|
| `driver_name` | اسم السائق |
| `vehicle_number` | رقم المركبة |
| `delivered_to_name` | اسم الشخص المستلم |
| `signature_url` | رابط توقيع المستلم |

## 5.3 جدولَا `stock_transfers` و`stock_transfer_items` — أذون التحويل

يمثلان عمليات نقل المخزون بين المستودعات.

| الحقل | النوع | الوصف |
|---|---|---|
| `from_warehouse_id` | UUID | المستودع المصدر |
| `to_warehouse_id` | UUID | المستودع المستلم |
| `status` | VARCHAR(20) | حالة التحويل |

الحالات:

- `draft`
- `confirmed`
- `cancelled`

**قيد التحقق الموثق:**

يمنع التحويل من المستودع إلى نفسه:

`CHECK (from_warehouse_id <> to_warehouse_id)`

## 5.4 جدولَا `stock_adjustments` و`stock_adjustment_items` — تسويات المخزون

يمثلان عمليات تصحيح كميات المخزون نتيجة الجرد أو التلف أو الفقد أو غيرها.

| الحقل | النوع | الوصف |
|---|---|---|
| `reason` | VARCHAR(50) | سبب التسوية |
| `status` | VARCHAR(20) | حالة التسوية |

الأسباب الموثقة:

- `physical_count`
- `damage`
- `theft`
- `expiry`
- `error`
- `other`

الحالات:

- `draft`
- `confirmed`
- `cancelled`

**معادلة الفرق:**

`difference = actual_quantity - system_quantity`

## 5.5 جدولَا `goods_receipts` و`goods_receipt_items` — أذون الاستلام

يمثلان عمليات استلام البضائع وإدخالها إلى المخزون.

| الحقل | النوع | الوصف |
|---|---|---|
| `payment_type` | VARCHAR(20) | نوع الدفع: cash / credit |
| `status` | VARCHAR(20) | حالة إذن الاستلام |
| `purchase_order_id` | UUID | أمر الشراء المرتبط، اختياري |

الحالات:

- `draft`
- `confirmed`
- `cancelled`

---

# 6. المجموعة الخامسة: المشتريات والمبيعات

تحتوي على أوامر الشراء والبيع وبنودها وتعديلات الموردين.

## 6.1 جدولَا `purchase_orders` و`purchase_order_items`

يمثلان أوامر الشراء وتفاصيل المنتجات المطلوبة من الموردين.

الحالات الموثقة:

- `draft`
- `approved`
- `rejected`
- `confirmed`
- `cancelled`
- `invoiced`

قيم `payment_type`:

- `cash`
- `credit`
- `partial`

## 6.2 جدولَا `sales_orders` و`sales_order_items`

يمثلان أوامر البيع وتفاصيل المنتجات المطلوبة من العملاء.

الحالات الموثقة:

- `draft`
- `confirmed`
- `cancelled`
- `invoiced`

## 6.3 جدول `purchase_order_item_adjustments`

يحتفظ بسجل التعديلات التي يجريها المورد على بنود أوامر الشراء.

---

# 7. المجموعة السادسة: الشركاء وشبكة الأعمال

## 7.1 جدول `customers` — العملاء

يمثل العملاء المرتبطين بالشركة.

الحقول الرئيسية الموثقة:

- `company_id`
- `user_id`
- `account_id`
- `credit_limit`
- `is_active`

## 7.2 جدول `suppliers` — الموردون

يمثل الموردين المرتبطين بالشركة.

الحقول الرئيسية الموثقة:

- `company_id`
- `user_id`
- `account_id`
- `credit_limit`
- `is_active`

## 7.3 جداول شبكة B2B

| الجدول | الوظيفة |
|---|---|
| `company_connections` | إدارة طلبات الربط والاتصال بين الشركات |
| `company_posts` | منشورات الشركات |
| `company_post_comments` | تعليقات المنشورات |
| `company_post_likes` | إعجابات المنشورات |

تدعم هذه الجداول وظائف شبكة الأعمال والتواصل بين الشركات.

---

# 8. المجموعة السابعة: النظام والإعدادات

## 8.1 جدول `settings` — إعدادات الشركات

يخزن إعدادات كل شركة بصورة مستقلة.

| العمود | النوع | الوصف |
|---|---|---|
| `company_id` | UUID | الشركة المالكة للإعداد |
| `key` | VARCHAR(100) | اسم الإعداد |
| `value` | JSONB | قيمة الإعداد |

**القيد الفريد:**

`UNIQUE (company_id, key)`

## 8.2 جدول `company_sequences`

يستخدم لإدارة التسلسلات والأرقام التلقائية للمستندات.

الحقول الموثقة:

- `seq_name`
- `next_value`

## 8.3 جدول `audit_logs` — سجل التدقيق

يسجل العمليات والتغييرات التي تحدث داخل النظام.

| العمود | النوع | الوصف |
|---|---|---|
| `company_id` | UUID | الشركة |
| `user_id` | UUID | المستخدم المنفذ |
| `action` | VARCHAR(50) | نوع العملية |
| `table_name` | VARCHAR(100) | اسم الجدول المتأثر |
| `record_id` | UUID | معرف السجل |
| `old_data` | JSONB | البيانات القديمة |
| `new_data` | JSONB | البيانات الجديدة |

قيم `action` الموثقة:

- `insert`
- `update`
- `delete`

## 8.4 جدولَا `notifications` و`notification_preferences`

| الجدول | الوظيفة |
|---|---|
| `notifications` | تخزين إشعارات المستخدمين |
| `notification_preferences` | تخزين تفضيلات الإشعارات |

الحقول الموثقة للإشعارات:

- `type`
- `title`
- `message`
- `is_read`

## 8.5 جدول `delivery_tokens`

يستخدم لإدارة رموز QR المرتبطة بتأكيد عمليات التسليم.

---

# 9. المجموعة الثامنة: الكتالوج العالمي

## 9.1 جدول `global_products`

يمثل الكتالوج الدوائي العالمي المشترك بين الشركات.

الخصائص الموثقة:

- يحتوي على حوالي 50 عموداً.
- يتضمن بيانات دوائية مثل دواعي الاستعمال والتفاعلات والجرعات.
- يستخدم JSONB لتخزين الأقسام والبيانات المعقدة.
- يحتوي على `keywords` و`tags` مع فهارس GIN لتحسين البحث.
- يحتوي على `merged_into_id` لدعم دمج المنتجات المكررة.

هذا الجدول مشترك ولا يعتمد على `company_id` مثل بيانات المنتجات الخاصة بالشركات.

---

# 10. العلاقات الرئيسية بين الجداول

## 10.1 علاقة الشركات بالجداول التابعة

تمثل `companies` الجدول الرئيسي للبيانات الخاصة بكل شركة.

العلاقات الرئيسية الموثقة:

    companies
    ├── users
    ├── branches
    ├── chart_of_accounts
    ├── products
    ├── warehouses
    ├── customers
    ├── suppliers
    ├── invoices
    ├── journal_entries
    ├── notes
    ├── delivery_notes
    ├── stock_transfers
    ├── stock_adjustments
    ├── goods_receipts
    └── ...

## 10.2 علاقات الفواتير

    invoices
    ├── invoice_items
    ├── payments
    └── returns

## 10.3 علاقات إشعارات المدين والدائن

    notes
    ├── note_items
    └── journal_entries (journal_entry_id)

## 10.4 علاقات مذكرات التسليم

    delivery_notes
    ├── delivery_note_items
    └── invoices (invoice_id)

## 10.5 علاقات أذون التحويل

    stock_transfers
    └── stock_transfer_items

## 10.6 علاقات تسويات المخزون

    stock_adjustments
    ├── stock_adjustment_items
    └── journal_entries (journal_entry_id)

## 10.7 علاقات أذون الاستلام

    goods_receipts
    ├── goods_receipt_items
    └── journal_entries (journal_entry_id)

---

# 11. الفهارس Indexes

تستخدم الفهارس لتحسين سرعة الاستعلامات والوصول إلى البيانات.

| نوع الفهرس | الغرض |
|---|---|
| `idx_*_company_date` | تحسين الاستعلامات حسب الشركة والتاريخ |
| `idx_*_company_status` | تحسين الفلترة حسب الشركة والحالة |
| `idx_*_product` | تحسين استعلامات المنتجات |
| `uq_*` | ضمان القيم الفريدة |
| GIN (`keywords`, `tags`) | تحسين البحث في الكلمات والوسوم |
| Partial indexes | تحسين الاستعلامات التي تستهدف جزءاً من البيانات |

---

# 12. Triggers

الـ Triggers تنفذ عمليات تلقائية عند حدوث تغييرات على الجداول.

| اسم Trigger | الوظيفة |
|---|---|
| `trg_*_updated_at` | تحديث حقل `updated_at` |
| `trg_*_audit` | تسجيل العمليات في `audit_logs` |
| `trg_account_postable` | منع الترحيل على حساب له حسابات فرعية |
| `trg_journal_balance` | التحقق من توازن القيد المحاسبي |
| `trg_prevent_posted_je_*` | منع تعديل القيد المحاسبي بعد ترحيله |

---

# 13. القيود والملاحظات المهمة

1. معظم الجداول التشغيلية مرتبطة بالشركة من خلال `company_id`، بينما `global_products` هو الكتالوج العالمي المشترك.
2. توضح البنية المرجعية أن معظم الجداول تحتوي على `created_at` و`updated_at`، مع استثناءات للقيود المحاسبية.
3. توثق البنية استخدام `ON DELETE CASCADE` في علاقات الشركة، ويجب مراجعة كل علاقة فعلياً قبل الحذف.
4. جدول `journal_entry_lines` يستخدم `ON DELETE CASCADE` مع القيد المحاسبي.
5. جدول `product_batches` يستخدم قيداً فريداً على `(product_id, warehouse_id, batch_number)`.
6. جدول `invoices` يستخدم قيداً فريداً على `(company_id, invoice_number)`.
7. جدول `settings` يستخدم قيداً فريداً على `(company_id, key)`.
8. جدول `chart_of_accounts` يستخدم قيداً فريداً على `(company_id, code)`.
9. جدول `journal_entries` يستخدم قيداً فريداً على `(company_id, entry_number)`.
10. جدول `stock_transfers` يستخدم قيداً فريداً على `(company_id, transfer_number)`.
11. جدول `delivery_notes` يستخدم قيداً فريداً على `(company_id, delivery_number)`.
12. جدول `goods_receipts` يستخدم قيداً فريداً على `(company_id, receipt_number)`.
13. جدول `stock_adjustments` يستخدم قيداً فريداً على `(company_id, adjustment_number)`.
14. جدول `notes` يستخدم قيداً فريداً على `(company_id, note_number)`.

---

# 14. قواعد مهمة لسلامة البيانات

عند تطوير قاعدة البيانات أو إضافة جداول جديدة، يجب مراعاة ما يلي:

- الحفاظ على عزل بيانات الشركات وعدم السماح بالوصول إلى بيانات شركة أخرى.
- ربط كل سجل تشغيلي بالشركة المالكة له عندما يكون ذلك مناسباً.
- استخدام المفاتيح الأجنبية لضمان صحة العلاقات.
- استخدام القيود الفريدة لمنع تكرار أرقام المستندات.
- استخدام معاملات قاعدة البيانات `Transactions` في العمليات التي تعدل أكثر من جدول.
- الحفاظ على توازن القيود المحاسبية عند الترحيل.
- منع تعديل القيود المحاسبية المرحلة وفق قواعد النظام.
- تسجيل العمليات المهمة في سجل التدقيق.
- الحفاظ على سلامة كميات المخزون والدفعات عند عمليات الاستلام والتحويل والتسوية والبيع.
- عدم حذف البيانات المحاسبية أو المخزنية التاريخية دون معالجة محاسبية وتشغيلية مناسبة.

---

# 15. التحقق من المخطط الفعلي

يمكن استخدام استعلامات PostgreSQL التالية لمراجعة بنية قاعدة البيانات.

## 15.1 عرض جميع الجداول

    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;

## 15.2 عرض أعمدة جدول معين

    SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
    ORDER BY ordinal_position;

## 15.3 عرض القيود

    SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_type;

## 15.4 عرض المفاتيح الأجنبية

    SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;

## 15.5 عرض الفهارس

    SELECT
        tablename,
        indexname,
        indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;

## 15.6 عرض Triggers

    SELECT
        event_object_table AS table_name,
        trigger_name,
        event_manipulation,
        action_timing,
        action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;

---

# 16. تحديث هذا التوثيق

عند إجراء أي تغيير على قاعدة البيانات:

1. تحديث ملف SQL الأساسي أو إضافة Migration جديدة.
2. تحديث هذا الملف عند إضافة جدول أو عمود أو علاقة أو قيد.
3. توثيق أي تغيير في المفاتيح الأجنبية والفهارس والـ Triggers.
4. توضيح تأثير التغيير على البيانات الحالية.
5. التأكد من أن التغيير لا يخل بعزل الشركات.
6. اختبار التغيير على بيئة تطوير قبل تطبيقه في الإنتاج.

**الهدف:** أن يظل هذا الملف مرجعاً واضحاً لبنية قاعدة بيانات OnixEdres، وأن يعكس المخطط الفعلي للمشروع بعد كل تحديث.