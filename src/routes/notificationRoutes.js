const router = require('express').Router();
const ctrl = require('../controllers/NotificationController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('notifications.view'),
  [query('is_read').optional().isBoolean(),
   query('type').optional().isIn([
     'low_stock', 'expiry_warning', 'expired_batch',
     'invoice_overdue', 'invoice_due_soon', 'payment_received', 'general',
   ]),
   query('page').optional().isInt({ min: 1 }),
   query('limit').optional().isInt({ min: 1, max: 100 })],
  validate, ctrl.list);

router.get('/unread-count', authorize('notifications.view'), ctrl.unreadCount);

router.patch('/:id/read', authorize('notifications.mark_read'),
  [param('id').isUUID()], validate, ctrl.markRead);

router.post('/mark-all-read', authorize('notifications.mark_read'), ctrl.markAllRead);

router.delete('/:id', authorize('notifications.mark_read'),
  [param('id').isUUID()], validate, ctrl.remove);

router.post('/scan', ctrl.scan); // حماية إضافية عبر requireCompany + يمكن إضافة authorize لاحقاً

module.exports = router;