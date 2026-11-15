const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/noteService');
const { generatePdf } = require('../services/pdf');
const { pool } = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  const data = await service.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const { pool } = require('../config/pool');
  const client = await pool.connect();
  try {
    const note = await service.getById(client, req.user.company_id, req.params.id);
    if (!note) throw new ApiError(404, 'Note not found');
    res.json({ success: true, data: note });
  } finally {
    client.release();
  }
});

/**
 * GET /notes/:id/pdf
 */
const getPdf = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    // 1) جلب الإشعار
    const note = await service.getById(client, req.user.company_id, req.params.id);
    if (!note) throw new ApiError(404, 'Note not found');

    // 2) جلب الشركة
    const compRes = await client.query(
      `SELECT * FROM companies WHERE id = $1`,
      [req.user.company_id]
    );
    const company = compRes.rows[0];

    // 3) اختيار نوع القالب
    const pdfType = note.note_type === 'credit' ? 'creditNote' : 'debitNote';

    // 4) توليد PDF
    const pdfBuffer = await generatePdf(pdfType, { company, note });

    // 5) إرسال
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${note.note_number}.pdf"`
    );
    res.send(pdfBuffer);
  } finally {
    client.release();
  }
});
const create = asyncHandler(async (req, res) => {
  const note = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: note });
});

const confirm = asyncHandler(async (req, res) => {
  const note = await service.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: note });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({ success: true, data: result });
});

module.exports = { list, getOne, create, confirm, cancel, getPdf };