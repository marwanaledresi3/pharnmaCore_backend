const express = require('express');
const router = express.Router();
const PostController = require('../controllers/postController');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireCompany } = require('../middlewares/authMiddleware');

// موجز عام — بدون مصادقة
router.get('/feed', asyncHandler(PostController.getPublicFeed));
router.get('/:postId/comments', asyncHandler(PostController.getComments));

// مسارات تتطلب تسجيل الدخول + company
router.post('/', authenticate, requireCompany, asyncHandler(PostController.createPost));
router.post('/:postId/like', authenticate, requireCompany, asyncHandler(PostController.toggleLike));
router.post('/:postId/comments', authenticate, requireCompany, asyncHandler(PostController.addComment));

module.exports = router;