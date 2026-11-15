// config/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'OnixEdres API',
      version: '1.0.0',
      description: `
        توثيق API نظام OnixEdres للمحاسبة والمخزون وإدارة الشركات.

        **خطوات الاستخدام:**
        1. سجّل الدخول عبر \`POST /api/v1/auth/login\` للحصول على التوكن.
        2. اضغط زر **Authorize** 🔓 في الأعلى والصق التوكن.
        3. جرّب أي endpoint بزر **Try it out**.
      `,
      contact: {
        name: 'OnixEdres Team',
        email: 'support@onixedres.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000/api/v1',
        description: '🟢 سيرفر التطوير',
      },
      {
        url: 'https://pharnmacore-backend.onrender.com/api/v1',
        description: '🔴 سيرفر الإنتاج',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'ضع التوكن هنا (بدون كلمة Bearer)',
        },
      },
      schemas: {
        // ═══════════════════════════════════════════════════════
        // Common
        // ═══════════════════════════════════════════════════════
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'رسالة الخطأ' },
            code: { type: 'integer', example: 400 },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 45 },
            pages: { type: 'integer', example: 3 },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Companies
        // ═══════════════════════════════════════════════════════
        Company: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            name_en: { type: 'string', nullable: true },
            currency_id: { type: 'string', format: 'uuid' },
            currency_code: { type: 'string' },
            currency_symbol: { type: 'string' },
            tax_number: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
            logo_url: { type: 'string', nullable: true },
            use_shared_logo: { type: 'boolean' },
            phone: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true },
            website: { type: 'string', nullable: true },
            country: { type: 'string', nullable: true },
            city: { type: 'string', nullable: true },
            default_markup_percentage: { type: 'number' },
            is_active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Notes (Credit/Debit)
        // ═══════════════════════════════════════════════════════
        NoteListItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            note_number: { type: 'string', example: 'CN-0001' },
            note_type: { type: 'string', enum: ['credit', 'debit'] },
            party_type: { type: 'string', enum: ['customer', 'supplier'] },
            note_date: { type: 'string', format: 'date' },
            total: { type: 'number', example: 115.00 },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            reason: {
              type: 'string',
              enum: ['return', 'discount', 'correction', 'price_diff', 'shipping', 'other'],
            },
            customer_id: { type: 'string', format: 'uuid', nullable: true },
            customer_name: { type: 'string', nullable: true },
            supplier_id: { type: 'string', format: 'uuid', nullable: true },
            supplier_name: { type: 'string', nullable: true },
            invoice_id: { type: 'string', format: 'uuid', nullable: true },
            invoice_number: { type: 'string', nullable: true },
            items_count: { type: 'integer', example: 2 },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Note: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            note_number: { type: 'string', example: 'CN-0001' },
            note_type: { type: 'string', enum: ['credit', 'debit'] },
            party_type: { type: 'string', enum: ['customer', 'supplier'] },
            customer_id: { type: 'string', format: 'uuid', nullable: true },
            customer_name: { type: 'string', nullable: true },
            supplier_id: { type: 'string', format: 'uuid', nullable: true },
            supplier_name: { type: 'string', nullable: true },
            invoice_id: { type: 'string', format: 'uuid', nullable: true },
            invoice_number: { type: 'string', nullable: true },
            note_date: { type: 'string', format: 'date' },
            currency_id: { type: 'string', format: 'uuid' },
            currency_code: { type: 'string', example: 'YER' },
            currency_symbol: { type: 'string', example: '﷼' },
            exchange_rate: { type: 'number', example: 1 },
            subtotal: { type: 'number', example: 100.00 },
            tax_total: { type: 'number', example: 15.00 },
            total: { type: 'number', example: 115.00 },
            reason: { type: 'string' },
            description: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            journal_entry_id: { type: 'string', format: 'uuid', nullable: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  product_id: { type: 'string', format: 'uuid', nullable: true },
                  product_name: { type: 'string', nullable: true },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unit_price: { type: 'number' },
                  discount_rate: { type: 'number' },
                  discount_amount: { type: 'number' },
                  tax_rate: { type: 'number' },
                  tax_amount: { type: 'number' },
                  line_total: { type: 'number' },
                },
              },
            },
            created_by: { type: 'string', format: 'uuid' },
            created_by_name: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            confirmed_by: { type: 'string', format: 'uuid', nullable: true },
            confirmed_by_name: { type: 'string', nullable: true },
            confirmed_at: { type: 'string', format: 'date-time', nullable: true },
            cancelled_by: { type: 'string', format: 'uuid', nullable: true },
            cancelled_by_name: { type: 'string', nullable: true },
            cancelled_at: { type: 'string', format: 'date-time', nullable: true },
            cancel_reason: { type: 'string', nullable: true },
          },
        },
        NoteCreate: {
          type: 'object',
          required: ['note_type', 'party_type', 'reason', 'items'],
          properties: {
            note_type: { type: 'string', enum: ['credit', 'debit'] },
            party_type: { type: 'string', enum: ['customer', 'supplier'] },
            customer_id: { type: 'string', format: 'uuid' },
            supplier_id: { type: 'string', format: 'uuid' },
            invoice_id: { type: 'string', format: 'uuid' },
            note_date: { type: 'string', format: 'date' },
            currency_id: { type: 'string', format: 'uuid' },
            exchange_rate: { type: 'number', minimum: 0 },
            reason: {
              type: 'string',
              enum: ['return', 'discount', 'correction', 'price_diff', 'shipping', 'other'],
            },
            description: { type: 'string', maxLength: 1000 },
            items: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['description', 'quantity', 'unit_price'],
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number', exclusiveMinimum: 0 },
                  unit_price: { type: 'number', minimum: 0 },
                  discount_rate: { type: 'number', minimum: 0, maximum: 100 },
                  tax_rate: { type: 'number', minimum: 0, maximum: 100 },
                  product_id: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Delivery Notes
        // ═══════════════════════════════════════════════════════
        DeliveryNoteListItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            delivery_number: { type: 'string', example: 'DN-0001' },
            delivery_date: { type: 'string', format: 'date' },
            status: {
              type: 'string',
              enum: ['draft', 'dispatched', 'delivered', 'invoiced', 'cancelled'],
            },
            customer_id: { type: 'string', format: 'uuid' },
            customer_name: { type: 'string' },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            invoice_id: { type: 'string', format: 'uuid', nullable: true },
            invoice_number: { type: 'string', nullable: true },
            items_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        DeliveryNote: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            delivery_number: { type: 'string' },
            delivery_date: { type: 'string', format: 'date' },
            customer_id: { type: 'string', format: 'uuid' },
            customer_name: { type: 'string' },
            customer_phone: { type: 'string', nullable: true },
            customer_address: { type: 'string', nullable: true },
            sales_order_id: { type: 'string', format: 'uuid', nullable: true },
            invoice_id: { type: 'string', format: 'uuid', nullable: true },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            driver_name: { type: 'string', nullable: true },
            driver_phone: { type: 'string', nullable: true },
            vehicle_number: { type: 'string', nullable: true },
            delivery_address: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['draft', 'dispatched', 'delivered', 'invoiced', 'cancelled'],
            },
            dispatched_at: { type: 'string', format: 'date-time', nullable: true },
            delivered_at: { type: 'string', format: 'date-time', nullable: true },
            delivered_to_name: { type: 'string', nullable: true },
            signature_url: { type: 'string', nullable: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  product_id: { type: 'string', format: 'uuid' },
                  product_name: { type: 'string' },
                  product_sku: { type: 'string' },
                  product_unit: { type: 'string' },
                  batch_id: { type: 'string', format: 'uuid', nullable: true },
                  batch_number: { type: 'string', nullable: true },
                  quantity: { type: 'number' },
                  unit_price: { type: 'number' },
                },
              },
            },
            created_by: { type: 'string', format: 'uuid' },
            created_by_name: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Stock Transfers
        // ═══════════════════════════════════════════════════════
        StockTransferListItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            transfer_number: { type: 'string', example: 'TRF-0001' },
            transfer_date: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            from_warehouse_id: { type: 'string', format: 'uuid' },
            from_warehouse_name: { type: 'string' },
            to_warehouse_id: { type: 'string', format: 'uuid' },
            to_warehouse_name: { type: 'string' },
            items_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        StockTransfer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            transfer_number: { type: 'string' },
            transfer_date: { type: 'string', format: 'date' },
            from_warehouse_id: { type: 'string', format: 'uuid' },
            from_warehouse_name: { type: 'string' },
            to_warehouse_id: { type: 'string', format: 'uuid' },
            to_warehouse_name: { type: 'string' },
            notes: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  product_id: { type: 'string', format: 'uuid' },
                  product_name: { type: 'string' },
                  product_sku: { type: 'string' },
                  product_unit: { type: 'string' },
                  from_batch_id: { type: 'string', format: 'uuid', nullable: true },
                  from_batch_number: { type: 'string', nullable: true },
                  from_batch_expiry: { type: 'string', format: 'date', nullable: true },
                  to_batch_id: { type: 'string', format: 'uuid', nullable: true },
                  to_batch_number: { type: 'string', nullable: true },
                  to_batch_expiry: { type: 'string', format: 'date', nullable: true },
                  quantity: { type: 'number' },
                  unit_cost: { type: 'number', nullable: true },
                },
              },
            },
            created_by: { type: 'string', format: 'uuid' },
            created_by_name: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            confirmed_by: { type: 'string', format: 'uuid', nullable: true },
            confirmed_by_name: { type: 'string', nullable: true },
            confirmed_at: { type: 'string', format: 'date-time', nullable: true },
            cancelled_by: { type: 'string', format: 'uuid', nullable: true },
            cancelled_by_name: { type: 'string', nullable: true },
            cancelled_at: { type: 'string', format: 'date-time', nullable: true },
            cancel_reason: { type: 'string', nullable: true },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Stock Adjustments
        // ═══════════════════════════════════════════════════════
        StockAdjustmentListItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            adjustment_number: { type: 'string', example: 'ADJ-0001' },
            adjustment_date: { type: 'string', format: 'date' },
            reason: {
              type: 'string',
              enum: ['physical_count', 'damage', 'theft', 'expiry', 'error', 'other'],
            },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            items_count: { type: 'integer' },
            total_value: { type: 'number' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        StockAdjustment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            adjustment_number: { type: 'string' },
            adjustment_date: { type: 'string', format: 'date' },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            reason: {
              type: 'string',
              enum: ['physical_count', 'damage', 'theft', 'expiry', 'error', 'other'],
            },
            notes: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            journal_entry_id: { type: 'string', format: 'uuid', nullable: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  product_id: { type: 'string', format: 'uuid' },
                  product_name: { type: 'string' },
                  product_sku: { type: 'string' },
                  batch_id: { type: 'string', format: 'uuid', nullable: true },
                  batch_number: { type: 'string', nullable: true },
                  system_quantity: { type: 'number' },
                  actual_quantity: { type: 'number' },
                  difference: { type: 'number' },
                  unit_cost: { type: 'number', nullable: true },
                },
              },
            },
            created_by: { type: 'string', format: 'uuid' },
            created_by_name: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            confirmed_by: { type: 'string', format: 'uuid', nullable: true },
            confirmed_by_name: { type: 'string', nullable: true },
            confirmed_at: { type: 'string', format: 'date-time', nullable: true },
            cancelled_by: { type: 'string', format: 'uuid', nullable: true },
            cancelled_by_name: { type: 'string', nullable: true },
            cancelled_at: { type: 'string', format: 'date-time', nullable: true },
            cancel_reason: { type: 'string', nullable: true },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Goods Receipts
        // ═══════════════════════════════════════════════════════
        GoodsReceiptListItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            receipt_number: { type: 'string', example: 'GRN-0001' },
            receipt_date: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            supplier_id: { type: 'string', format: 'uuid' },
            supplier_name: { type: 'string' },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            total: { type: 'number' },
            payment_type: { type: 'string', enum: ['cash', 'credit'] },
            items_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        GoodsReceipt: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            receipt_number: { type: 'string' },
            receipt_date: { type: 'string', format: 'date' },
            supplier_id: { type: 'string', format: 'uuid' },
            supplier_name: { type: 'string' },
            purchase_order_id: { type: 'string', format: 'uuid', nullable: true },
            warehouse_id: { type: 'string', format: 'uuid' },
            warehouse_name: { type: 'string' },
            currency_id: { type: 'string', format: 'uuid' },
            currency_code: { type: 'string' },
            subtotal: { type: 'number' },
            tax_total: { type: 'number' },
            total: { type: 'number' },
            payment_type: { type: 'string', enum: ['cash', 'credit'] },
            notes: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] },
            journal_entry_id: { type: 'string', format: 'uuid', nullable: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  product_id: { type: 'string', format: 'uuid' },
                  product_name: { type: 'string' },
                  product_sku: { type: 'string' },
                  batch_id: { type: 'string', format: 'uuid', nullable: true },
                  batch_number: { type: 'string', nullable: true },
                  quantity: { type: 'number' },
                  unit_price: { type: 'number' },
                  line_total: { type: 'number' },
                },
              },
            },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ═══════════════════════════════════════════════════════
        // Documents
        // ═══════════════════════════════════════════════════════
        DocumentItem: {
          type: 'object',
          properties: {
            document_type: {
              type: 'string',
              enum: [
                'invoice_sales',
                'invoice_purchase',
                'payment_receive',
                'payment_pay',
                'payment_refund',
                'payment_credit_apply',
                'expense',
                'return_sale',
                'return_purchase',
                'journal_entry',
                'note_credit',
                'note_debit',
                'delivery_note',
                'stock_transfer',
                'stock_adjustment',
              ],
            },
            document_id: { type: 'string', format: 'uuid' },
            document_number: { type: 'string', example: 'INV-0001' },
            document_date: { type: 'string', format: 'date' },
            amount: { type: 'number' },
            status: { type: 'string' },
            party_name: { type: 'string', nullable: true },
            party_id: { type: 'string', format: 'uuid', nullable: true },
            journal_entry_id: { type: 'string', format: 'uuid', nullable: true },
            source_id: { type: 'string', format: 'uuid', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'التوكن مفقود أو غير صالح',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                message: 'Authentication required',
                code: 401,
              },
            },
          },
        },
        Forbidden: {
          description: 'لا تملك الصلاحية',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                message: 'Forbidden',
                code: 403,
              },
            },
          },
        },
        NotFound: {
          description: 'المورد غير موجود',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                message: 'Not found',
                code: 404,
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Auth',             description: 'المصادقة' },
      { name: 'Companies',        description: 'إدارة الشركة' },
      { name: 'Settings',         description: 'الإعدادات' },
      { name: 'Users',            description: 'المستخدمون' },
      { name: 'Products',         description: 'المنتجات' },
      { name: 'Invoices',         description: 'الفواتير' },
      { name: 'Sales',            description: 'أوامر البيع' },
      { name: 'Purchases',        description: 'أوامر الشراء' },
      { name: 'Payments',         description: 'المدفوعات' },
      { name: 'Expenses',         description: 'المصروفات' },
      { name: 'Returns',          description: 'المرتجعات' },
      { name: 'JournalEntries',   description: 'القيود اليومية' },
      { name: 'Notes',            description: 'إشعارات مدين/دائن' },
      { name: 'DeliveryNotes',    description: 'مذكرات التسليم' },
      { name: 'StockTransfers',   description: 'أذون التحويل' },
      { name: 'StockAdjustments', description: 'تسويات الجرد' },
      { name: 'GoodsReceipts',    description: 'أذون الاستلام' },
      { name: 'Documents',        description: 'المستندات الموحدة' },
      { name: 'PDF',              description: 'ملفات PDF' },
      { name: 'Reports',          description: 'التقارير' },
    ],
  },
  apis: [
    path.join(__dirname, '../routes/*.js'),
    path.join(__dirname, '../controllers/*.js'),
  ],
};

module.exports = swaggerJsdoc(options);