const Connection = require('../models/Connection');
const ApiError = require('../errors/ApiError');

class ConnectionController {
  static async sendRequest(req, res) {
    const requesterId = req.user.company_id;
    const { receiver_company_id } = req.body;

    if (requesterId === receiver_company_id) {
      throw new ApiError(400, 'لا يمكنك إرسال طلب ربط لنفس الشركة');
    }

    const data = await Connection.createRequest(requesterId, receiver_company_id);
    res.status(201).json({ success: true, data });
  }

  static async updateStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.company_id;

    if (!['accepted', 'rejected', 'blocked'].includes(status)) {
      throw new ApiError(400, 'حالة غير صالحة');
    }

    const data = await Connection.updateStatus(companyId, id, status);
    if (!data) {
      throw new ApiError(404, 'الطلب غير موجود أو ليس لديك صلاحية');
    }

    res.json({ success: true, data });
  }

  static async listConnections(req, res) {
    const companyId = req.user.company_id;
    const { status, search } = req.query; // جلب المعاملات من الرابط

    // استخدام دالة findAll التي تم إضافتها للمودل لدعم البحث والفلترة
    const data = await Connection.findAll(companyId, { status, search });
    res.json({ success: true, data });
  }
}

module.exports = ConnectionController;