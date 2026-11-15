// routes/postsRoutes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl = require('../controllers/PostsController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/feed
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/feed',
  authorize('b2b.view'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  ctrl.listFeed
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/',
  authorize('b2b.create'),
  [
    body('title').isString().trim().notEmpty().isLength({ max: 255 }),
    body('content').isString().trim().notEmpty(),
    body('media_url').optional().isString().trim().isLength({ max: 500 }),
    body('is_public').optional().isBoolean(),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/like
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/:id/like',
  authorize('b2b.create'),
  [param('id').isUUID()],
  validate,
  ctrl.toggleLike
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/comments
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/:id/comments',
  authorize('b2b.create'),
  [
    param('id').isUUID(),
    body('comment_text').isString().trim().notEmpty().isLength({ max: 2000 }),
  ],
  validate,
  ctrl.addComment
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/:id/comments
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/:id/comments',
  authorize('b2b.view'),
  [param('id').isUUID()],
  validate,
  ctrl.listComments
);

module.exports = router;