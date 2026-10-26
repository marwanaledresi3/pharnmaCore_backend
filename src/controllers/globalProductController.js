const GlobalProduct = require('../models/GlobalProduct');
const ApiError = require('../errors/ApiError');

class GlobalProductController {
  static async search(req, res) {
    const data = await GlobalProduct.search(req.query);
    res.json({ success: true, data });
  }

  static async create(req, res) {
    const companyId = req.user.company_id;
    const { name, unit } = req.body;
    
    if (!name || !unit) {
      throw new ApiError(400, 'اسم الدواء ووحدة القياس أساسيان');
    }

    const data = await GlobalProduct.create(companyId, req.body);
    res.status(201).json({ success: true, data });
  }
}

module.exports = GlobalProductController;