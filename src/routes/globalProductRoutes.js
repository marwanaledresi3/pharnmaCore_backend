const express = require('express');
const router = express.Router();
const GlobalProductController = require('../controllers/globalProductController');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

router.get('/search', asyncHandler(GlobalProductController.search));
router.post('/', asyncHandler(GlobalProductController.create));

module.exports = router;