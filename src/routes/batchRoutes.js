const router = require('express').Router();
const ctrl = require('../controllers/BatchController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('batches.view'),
  [query('product_id').optional().isUUID(),
   query('warehouse_id').optional().isUUID(),
   query('expiring_soon').optional().isBoolean()],
  validate, ctrl.list);

router.post('/', authorize('batches.create'),
  [body('product_id').isUUID(),
   body('warehouse_id').isUUID(),
   body('batch_number').trim().notEmpty(),
   body('expiry_date').isISO8601(),
   body('quantity').isFloat({ gt: 0 }),
   body('cost_price').optional().isFloat({ min: 0 })],
  validate, ctrl.create);

module.exports = router;