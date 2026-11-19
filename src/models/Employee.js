// models/Employee.js
const { pool } = require('../config/pool');

class Employee {
  static async list(companyId, { search, status, department_id, page = 1, limit = 20 } = {}) {
    const params = [companyId];
    const conds = ['e.company_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(e.full_name ILIKE $${params.length}
                   OR e.employee_number ILIKE $${params.length}
                   OR e.national_id ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      conds.push(`e.status = $${params.length}`);
    }
    if (department_id) {
      params.push(department_id);
      conds.push(`e.department_id = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT e.id, e.employee_number, e.full_name, e.full_name_en,
              e.national_id, e.phone, e.email, e.hire_date,
              e.basic_salary, e.housing_allowance, e.transport_allowance,
              e.other_allowances, e.employment_type, e.status,
              e.department_id, d.name AS department_name,
              e.job_title_id, j.name AS job_title_name,
              e.branch_id, b.name AS branch_name,
              e.created_at
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN job_titles  j ON j.id = e.job_title_id
         LEFT JOIN branches    b ON b.id = e.branch_id
        WHERE ${conds.join(' AND ')}
        ORDER BY e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM employees e WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  static async findById(companyId, id, client = null) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT e.*,
              d.name AS department_name,
              j.name AS job_title_name,
              b.name AS branch_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN job_titles  j ON j.id = e.job_title_id
         LEFT JOIN branches    b ON b.id = e.branch_id
        WHERE e.id = $1 AND e.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO employees (
         company_id, user_id, employee_number, full_name, full_name_en,
         national_id, passport_number, nationality, gender, birth_date,
         marital_status, phone, email, address, hire_date,
         department_id, job_title_id, manager_id, branch_id,
         basic_salary, housing_allowance, transport_allowance, other_allowances,
         currency_id, bank_name, bank_account, iban,
         employment_type, status, salary_account_id
       ) VALUES (
         $1, $2,
         COALESCE($3, 'EMP-' || LPAD((
           SELECT COALESCE(MAX(
             NULLIF(regexp_replace(employee_number, '\\D', '', 'g'), '')::int
           ), 0) + 1
           FROM employees WHERE company_id = $1
         )::text, 4, '0')),
         $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16, $17, $18, $19,
         $20, $21, $22, $23,
         $24, $25, $26, $27,
         $28, COALESCE($29, 'active'), $30
       )
       RETURNING *`,
      [
        companyId,
        data.user_id || null,
        data.employee_number || null,
        data.full_name,
        data.full_name_en || null,
        data.national_id || null,
        data.passport_number || null,
        data.nationality || null,
        data.gender || null,
        data.birth_date || null,
        data.marital_status || null,
        data.phone || null,
        data.email || null,
        data.address || null,
        data.hire_date,
        data.department_id || null,
        data.job_title_id || null,
        data.manager_id || null,
        data.branch_id || null,
        data.basic_salary || 0,
        data.housing_allowance || 0,
        data.transport_allowance || 0,
        data.other_allowances || 0,
        data.currency_id || null,
        data.bank_name || null,
        data.bank_account || null,
        data.iban || null,
        data.employment_type || 'full_time',
        data.status,
        data.salary_account_id || null,
      ]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = [
      'user_id', 'full_name', 'full_name_en', 'national_id', 'passport_number',
      'nationality', 'gender', 'birth_date', 'marital_status', 'phone', 'email',
      'address', 'hire_date', 'termination_date', 'department_id', 'job_title_id',
      'manager_id', 'branch_id', 'basic_salary', 'housing_allowance',
      'transport_allowance', 'other_allowances', 'currency_id', 'bank_name',
      'bank_account', 'iban', 'employment_type', 'status', 'salary_account_id',
    ];

    const fields = [];
    const params = [];
    for (const k of allowed) {
      if (payload[k] !== undefined) {
        params.push(payload[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return null;

    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE employees SET ${fields.join(', ')}
        WHERE id = $${params.length - 1} AND company_id = $${params.length}
        RETURNING *`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM employees WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * جلب الموظفين النشطين لمسير رواتب
   */
  static async findActiveForPayroll(client, companyId) {
    const r = await client.query(
      `SELECT id, employee_number, full_name,
              basic_salary, housing_allowance, transport_allowance, other_allowances
         FROM employees
        WHERE company_id = $1
          AND status IN ('active', 'on_leave')
        ORDER BY employee_number`,
      [companyId]
    );
    return r.rows;
  }
}

module.exports = Employee;