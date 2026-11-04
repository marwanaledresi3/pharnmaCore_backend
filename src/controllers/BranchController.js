const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Branch = require('../models/Branch');
const { pool } = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Branch.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const b = await Branch.findById(req.user.company_id, req.params.id);
  if (!b) throw new ApiError(404, 'الفرع غير موجود');
  res.json({ success: true, data: b });
});

const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branch = await Branch.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: branch });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ApiError(409, 'يوجد فرع رئيسي بالفعل. ألغِ تعيينه أولاً أو عيّن هذا بدلاً منه.');
    }
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branch = await Branch.update(client, req.user.company_id, req.params.id, req.body);
    if (!branch) throw new ApiError(404, 'الفرع غير موجود');
    await client.query('COMMIT');
    res.json({ success: true, data: branch });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ApiError(409, 'يوجد فرع رئيسي بالفعل.');
    }
    // خطأ "لا يمكن إلغاء تعيين الفرع الرئيسي الوحيد"
    if (err.message && err.message.includes('الفرع الرئيسي الوحيد')) {
      throw new ApiError(400, err.message);
    }
    throw err;
  } finally {
    client.release();
  }
});

const remove = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) اجلب الفرع للتأكد من أنه غير رئيسي وحيد
    const existing = await Branch.findById(req.user.company_id, req.params.id);
    if (!existing) throw new ApiError(404, 'الفرع غير موجود');

    if (existing.is_main) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS mains FROM branches
         WHERE company_id = $1 AND is_main = TRUE`,
        [req.user.company_id]
      );
      if (rows[0].mains <= 1) {
        // اسمح بالحذف لكن عيّن فرعاً آخر رئيسياً تلقائياً
        const { rows: others } = await client.query(
          `SELECT id FROM branches
           WHERE company_id = $1 AND id <> $2
           ORDER BY created_at ASC LIMIT 1`,
          [req.user.company_id, req.params.id]
        );
        if (others.length === 0) {
          // آخر فرع → احذفه، لا مشكلة (لن يبقى شيء)
        } else {
          await client.query(
            `UPDATE branches SET is_main = TRUE, updated_at = NOW() WHERE id = $1`,
            [others[0].id]
          );
        }
      }
    }

    const r = await Branch.delete(client, req.user.company_id, req.params.id);
    if (!r) throw new ApiError(404, 'الفرع غير موجود');
    await client.query('COMMIT');
    res.json({ success: true, message: 'تم حذف الفرع' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});



module.exports = { list, getOne, create, update, remove };