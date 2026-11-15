// services/purchaseOrder/helpers/customers.js
const ApiError = require('../../../errors/ApiError');

async function ensureCustomer(client, { supplierCompanyId, buyerCompanyId }) {
  if (!supplierCompanyId) throw new ApiError(400, 'supplierCompanyId is required');
  if (!buyerCompanyId) throw new ApiError(400, 'buyerCompanyId is required');
  if (supplierCompanyId === buyerCompanyId) {
    throw new ApiError(400, 'supplierCompanyId and buyerCompanyId must be different');
  }

  const buyer = await client.query(
    `SELECT name, name_en, phone, email, address, tax_number FROM companies WHERE id = $1`,
    [buyerCompanyId]
  );
  if (!buyer.rowCount) {
    throw new ApiError(500, `Buyer company ${buyerCompanyId} not found`);
  }
  const b = buyer.rows[0];

  const ins = await client.query(
    `INSERT INTO customers
       (company_id, source_company_id, name, phone, email, address, tax_number, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     ON CONFLICT (company_id, source_company_id) WHERE source_company_id IS NOT NULL
     DO UPDATE SET is_active = TRUE
     RETURNING id`,
    [supplierCompanyId, buyerCompanyId, b.name || b.name_en || 'عميل شبكي', b.phone || null, b.email || null, b.address || null, b.tax_number || null]
  );

  return ins.rows[0].id;
}

module.exports = { ensureCustomer };