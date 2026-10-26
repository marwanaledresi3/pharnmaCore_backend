const express = require('express');
const router = express.Router();
const ConnectionController = require('../controllers/connectionController');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

router.post('/request', asyncHandler(ConnectionController.sendRequest));
router.patch('/:id/status', asyncHandler(ConnectionController.updateStatus));
router.get('/', asyncHandler(ConnectionController.listConnections));

module.exports = router;