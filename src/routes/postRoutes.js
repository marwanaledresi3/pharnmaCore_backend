const express = require('express');
const router = express.Router();
const PostController = require('../controllers/postController');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middlewares/auth');

// موجز عام مرئي للجميع (بدون اشتراط مصادقة إجبارية إن أردت، أو مع مصادقة)
router.get('/feed', asyncHandler(PostController.getPublicFeed));
router.get('/:postId/comments', asyncHandler(PostController.getComments));

// مسارات تتطلب تسجيل الدخول
router.post('/', authenticate, asyncHandler(PostController.createPost));
router.post('/:postId/like', authenticate, asyncHandler(PostController.toggleLike));
router.post('/:postId/comments', authenticate, asyncHandler(PostController.addComment));

module.exports = router;