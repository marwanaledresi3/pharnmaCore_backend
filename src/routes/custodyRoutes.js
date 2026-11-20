// routes/custodyRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/custodyController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate);

// أنواع العهد
router.get('/types', authorize('custody.read'), ctrl.listCustodyTypes);
router.post('/types', authorize('custody.create'), ctrl.createCustodyType);

// العهد وحركاتها
router.get('/', authorize('custody.read'), ctrl.listCustodies);
router.get('/:id', authorize('custody.read'), ctrl.getCustodyById);
router.post('/', authorize('custody.create'), ctrl.createCustody);
router.post('/:id/transactions', authorize('custody.settle'), ctrl.addCustodyTransaction);

// السلف والأقساط
router.get('/advances/list', authorize('advances.read'), ctrl.listAdvances);
router.get('/advances/:id', authorize('advances.read'), ctrl.getAdvanceById);
router.post('/advances', authorize('advances.create'), ctrl.createAdvance);
router.post('/advances/:id/approve', authorize('advances.approve'), ctrl.approveAdvance);
router.post('/advances/:id/reject', authorize('advances.approve'), ctrl.rejectAdvance);
router.post('/advances/:id/cancel', authorize('advances.approve'), ctrl.cancelAdvance);
router.post('/advances/installments/:installmentId/pay', authorize('advances.pay'), ctrl.payInstallment);

module.exports = router;