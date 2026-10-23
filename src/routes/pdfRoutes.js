const router = require('express').Router();
const ctrl = require('../controllers/PdfController');
const { authenticate, requireCompany, requireInternal } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { param, query } = require('express-validator');

router.use(authenticate, requireCompany, requireInternal);

router.get('/invoice/:id',
  [param('id').isUUID()], validate, ctrl.invoicePdf);

router.get('/return/:id',
  [param('id').isUUID()], validate, ctrl.returnPdf);

router.get('/statement/:customerId',
  [param('customerId').isUUID()], validate, ctrl.statementPdf);

router.get('/report/sales',
  [query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601(),
   query('group_by').optional().isIn(['day', 'month', 'year'])],
  validate, ctrl.salesReportPdf);

module.exports = router;