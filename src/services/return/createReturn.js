// services/return/createReturn.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const Return = require('../../models/Return');
const { round2 } = require('./helpers/rounding');
const { resolveBaseQuantity } = require('../helpers/units');

const createSaleReturn = async (companyId, userId, payload) =>
  createReturn(companyId, userId, 'sale', payload);

const createPurchaseReturn = async (companyId, userId, payload) =>
  createReturn(companyId, userId, 'purchase', payload);

const createReturn = async (companyId, userId, returnType, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) تحقق من الفاتورة
    const invoiceType = returnType === 'sale' ? 'sales' : 'purchase';

    const invRes = await client.query(
      `SELECT * FROM invoices
       WHERE id = $1 AND company_id = $2 AND invoice_type = $3 AND status <> 'cancelled'
       FOR UPDATE`,
      [payload.invoice_id, companyId, invoiceType]
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw new ApiError(400, 'Invoice not found or invalid type');

    // 2) تحقق من الطرف
    if (returnType === 'sale' && !invoice.customer_id) {
      throw new ApiError(400, 'Sales invoice must have customer');
    }
    if (returnType === 'purchase' && !invoice.supplier_id) {
      throw new ApiError(400, 'Purchase invoice must have supplier');
    }

    // 3) الفاتورة لها reference
    if (!invoice.reference_type || !invoice.reference_id) {
      throw new ApiError(400, 'Invoice has no reference to source order');
    }

    // 4) اقرأ سطور الأمر الأصلي
    const sourceOrderId = invoice.reference_id;
    const sourceItemsTable =
      returnType === 'sale' ? 'sales_order_items' : 'purchase_order_items';

    const enrichedItems = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of payload.items) {
      // 4a) السطر الأصلي
      const origRes = await client.query(
        `SELECT * FROM ${sourceItemsTable}
         WHERE order_id = $1 AND product_id = $2
         LIMIT 1`,
        [sourceOrderId, item.product_id]
      );
      if (!origRes.rowCount) {
        throw new ApiError(400, `Product ${item.product_id} not found in original order`);
      }
      const orig = origRes.rows[0];

      // 4b) الكمية
      const qty = Number(item.quantity);
      const bonusQty = Number(item.bonus_quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) throw new ApiError(400, 'Quantity must be > 0');
      if (!Number.isFinite(bonusQty) || bonusQty < 0) throw new ApiError(400, 'Bonus quantity must be >= 0');

      // 4c) الوحدة + conversion_factor
      const unitId = item.unit_id || orig.unit_id || null;
      let conversionFactor = 1;
      if (unitId) {
        const resolved = await resolveBaseQuantity(client, {
          productId: item.product_id,
          unitId,
          quantity: 1,
        });
        conversionFactor = resolved.conversionFactor;
      }

      // 4d) الكمية الأساسية المطلوبة (paid + bonus)
      const totalQty = qty + bonusQty;
      const baseQty = round2(totalQty * conversionFactor);

      // 5) الكمية الأصلية
      const origUnitFactor = Number(orig.conversion_factor) || 1;
      const origPaidQty = Number(orig.paid_quantity ?? orig.quantity);
      const origBonusQty = Number(orig.bonus_quantity || 0);
      const origTotalQty = origPaidQty + origBonusQty;
      const origBaseQty = round2(origTotalQty * origUnitFactor);

      if (baseQty > origBaseQty + 0.001) {
        throw new ApiError(
          400,
          `Quantity cannot exceed original (${origBaseQty} in base units)`
        );
      }

      // 6) تحقق من المرتجعات السابقة
      const prevRes = await client.query(
        `SELECT COALESCE(SUM(ri.quantity * ri.conversion_factor + COALESCE(ri.bonus_quantity, 0) * ri.conversion_factor), 0)::numeric AS total_returned
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE r.invoice_id = $1
           AND ri.product_id = $2
           AND r.return_type = $3
           AND r.status <> 'cancelled'`,
        [payload.invoice_id, item.product_id, returnType]
      );
      const alreadyReturnedBase = Number(prevRes.rows[0].total_returned);

      if (alreadyReturnedBase + baseQty > origBaseQty + 0.001) {
        throw new ApiError(
          400,
          `Total returned (${round2(alreadyReturnedBase + baseQty)}) exceeds original (${origBaseQty})`
        );
      }

      // 7) السعر والضريبة
      const netUnitPrice = Number(item.unit_price || orig.net_unit_price || orig.unit_price);
      if (!Number.isFinite(netUnitPrice) || netUnitPrice < 0) {
        throw new ApiError(400, 'Unit price must be >= 0');
      }

      const taxRate = Number(item.tax_rate ?? orig.tax_rate ?? 0);
      const discountRate = Number(item.discount_rate ?? orig.discount_rate ?? 0);
      const gross = round2(qty * netUnitPrice);
      const disc = round2(gross * discountRate / 100);
      const net = round2(gross - disc);
      const taxAmount = round2(net * (taxRate / 100));
      const lineTotal = round2(net + taxAmount);
      const netUnitPriceAfterDisc = qty > 0 ? round2(net / qty) : 0;

      // 8) تكلفة الوحدة الأساسية
      let costPrice = 0;

      if (returnType === 'sale') {
        const batchId = item.batch_id || orig.batch_id || null;
        if (batchId) {
          const batchRes = await client.query(
            `SELECT cost_price, cost_price_base FROM product_batches
             WHERE id = $1 AND company_id = $2`,
            [batchId, companyId]
          );
          if (batchRes.rowCount) {
            const b = batchRes.rows[0];
            costPrice = Number(b.cost_price_base)
              || round2(Number(b.cost_price || 0) * (Number(invoice.exchange_rate) || 1));
          }
        }
        if (costPrice === 0) {
          costPrice = round2(netUnitPrice / conversionFactor);
        }
      } else {
        const origNetUnitPrice = Number(orig.net_unit_price || orig.unit_price || 0);
        costPrice = round2(origNetUnitPrice / origUnitFactor);
      }

      // 9) تجميع البند
      subtotal = round2(subtotal + net);
      taxTotal = round2(taxTotal + taxAmount);

      enrichedItems.push({
        original_item_id: orig.id,
        product_id: item.product_id,
        batch_id: item.batch_id || orig.batch_id || null,
        unit_id: unitId,
        conversion_factor: conversionFactor,
        quantity: qty,
        bonus_quantity: bonusQty,
        base_quantity: baseQty,
        unit_price: netUnitPrice,
        net_unit_price: netUnitPriceAfterDisc,
        discount_rate: discountRate,
        discount_amount: disc,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        line_total: lineTotal,
        cost_price: costPrice,
      });
    }

    // 10) إنشاء المرتجع
    const ret = await Return.create(client, companyId, {
      return_type: returnType,
      invoice_id: invoice.id,
      reference_type: invoice.reference_type,
      reference_id: invoice.reference_id,
      customer_id: invoice.customer_id,
      supplier_id: invoice.supplier_id,
      return_date: payload.return_date || new Date().toISOString().slice(0, 10),
      currency_id: invoice.currency_id,
      exchange_rate: invoice.exchange_rate || 1,
      subtotal,
      tax_total: taxTotal,
      total: round2(subtotal + taxTotal),
      reason: payload.reason,
      created_by: userId,
      items: enrichedItems,
    });

    await client.query('COMMIT');
    return Return.findById(companyId, ret.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { createSaleReturn, createPurchaseReturn };