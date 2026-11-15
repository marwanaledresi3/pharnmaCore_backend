// routes/connectionRoutes.js
const express = require('express');
const router = express.Router();
const ConnectionController = require('../controllers/connectionController');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middlewares/validateMiddleware');
const {
  authenticate,
  requireCompany,
} = require('../middlewares/authMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /connections
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/',
  [
    query('status')
      .optional()
      .isIn(['pending', 'accepted', 'rejected', 'blocked']),
    query('direction').optional().isIn(['sent', 'received']),
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  asyncHandler(ConnectionController.listConnections)
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /connections/accepted
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/accepted',
  asyncHandler(ConnectionController.listAccepted)
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /connections/request
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/request',
  [body('receiver_company_id').isUUID()],
  validate,
  asyncHandler(ConnectionController.sendRequest)
);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /connections/:id/status
// ═══════════════════════════════════════════════════════════════════════════
router.patch(
  '/:id/status',
  [
    param('id').isUUID(),
    body('status').isIn(['accepted', 'rejected', 'blocked']),
  ],
  validate,
  asyncHandler(ConnectionController.updateStatus)
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /connections/:id
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(ConnectionController.getOne)
);

module.exports = router;