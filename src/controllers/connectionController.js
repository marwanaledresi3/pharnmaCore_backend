// controllers/ConnectionController.js
const Connection = require('../models/Connection');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');

class ConnectionController {
  // ═══════════════════════════════════════════════════════════════════════
  // POST /connections/request
  // ═══════════════════════════════════════════════════════════════════════
  static async sendRequest(req, res) {
    const requesterId = req.user.company_id;
    const { receiver_company_id } = req.body;

    if (requesterId === receiver_company_id) {
      throw new ApiError(400, 'لا يمكنك إرسال طلب ربط لنفس الشركة');
    }

    const data = await Connection.createRequest(
      requesterId,
      receiver_company_id
    );

    res.status(201).json({ success: true, data });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PATCH /connections/:id/status
  // ═══════════════════════════════════════════════════════════════════════
  static async updateStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.company_id;

    if (!['accepted', 'rejected', 'blocked'].includes(status)) {
      throw new ApiError(400, 'حالة غير صالحة');
    }

    // جلب الاتصال للتحقق من الصلاحية
    const conn = await Connection.findById(companyId, id);
    if (!conn) {
      throw new ApiError(404, 'الطلب غير موجود أو ليس لديك صلاحية');
    }

    // ⚠️ قاعدة عمل: `accepted` يُسمح فقط للشركة المستقبلة
    if (status === 'accepted' && conn.receiver_company_id !== companyId) {
      throw new ApiError(
        403,
        'فقط الشركة المستقبلة يمكنها قبول طلب الاتصال'
      );
    }

    const data = await Connection.updateStatus(companyId, id, status);
    if (!data) {
      throw new ApiError(404, 'الطلب غير موجود أو ليس لديك صلاحية');
    }

    res.json({ success: true, data });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GET /connections
  // ✅ يُرجع { items, pagination } (وليس مصفوفة مباشرة)
  // ═══════════════════════════════════════════════════════════════════════
  static async listConnections(req, res) {
    const companyId = req.user.company_id;
    const { status, search, direction, page, limit } = req.query;

    const result = await Connection.findAll(companyId, {
      status,
      search,
      direction,
      page,
      limit,
    });

    res.json({ success: true, ...result });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GET /connections/:id
  // ═══════════════════════════════════════════════════════════════════════
  static async getOne(req, res) {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const conn = await Connection.findById(companyId, id);
    if (!conn) {
      throw new ApiError(404, 'الاتصال غير موجود');
    }

    res.json({ success: true, data: conn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GET /connections/accepted
  // (للاستخدام الداخلي — قائمة الشركات المتصلة)
  // ═══════════════════════════════════════════════════════════════════════
  static async listAccepted(req, res) {
    const companyId = req.user.company_id;
    const data = await Connection.listAccepted(companyId);
    res.json({ success: true, data });
  }
}

module.exports = ConnectionController;