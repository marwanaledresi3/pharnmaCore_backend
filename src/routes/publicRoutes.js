// routes/publicRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/PublicController');
const dashboardCtrl = require('../controllers/DashboardController');
const validate = require('../middlewares/validateMiddleware');
const { param, query } = require('express-validator');

// ⚠️ ملاحظة: هذه المسارات عامة (بدون authenticate)
// لكن بعضها قد يستخدم authenticate اختيارياً

// ═══════════════════════════════════════════════════════════════════════════
// GET /public/stats — إحصائيات النظام العامة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /public/stats:
 *   get:
 *     summary: إحصائيات النظام العامة
 *     description: |
 *       إحصائيات عامة (بدون مصادقة):
 *       - عدد الشركات النشطة.
 *       - عدد المنتجات في الكتالوج العالمي.
 *       - عدد المنشورات.
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: الإحصائيات العامة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     companies:
 *                       type: integer
 *                     global_products:
 *                       type: integer
 *                     posts:
 *                       type: integer
 */
router.get('/stats', dashboardCtrl.publicStats);

// ═══════════════════════════════════════════════════════════════════════════
// GET /public/products — كتالوج المنتجات العامة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /public/products:
 *   get:
 *     summary: كتالوج المنتجات العامة
 *     description: |
 *       يعرض المنتجات العالمية (global_products) للعامة.
 *       مفيد للبحث قبل تسجيل الدخول.
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: category
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المنتجات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           name_en: { type: string }
 *                           scientific_name: { type: string }
 *                           category: { type: string }
 *                           image_url: { type: string }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 */
router.get(
  '/products',
  [
    query('search').optional().trim().isLength({ max: 100 }),
    query('category').optional().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  ctrl.listProducts
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /public/categories — التصنيفات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /public/categories:
 *   get:
 *     summary: تصنيفات المنتجات العامة
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: قائمة التصنيفات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/categories', ctrl.listCategories);

// ═══════════════════════════════════════════════════════════════════════════
// GET /public/posts — منشورات الشركات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /public/posts:
 *   get:
 *     summary: منشورات الشركات العامة
 *     description: منشورات B2B من الشركات (is_public = true).
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المنشورات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           title: { type: string }
 *                           content: { type: string }
 *                           media_url: { type: string, nullable: true }
 *                           views_count: { type: integer }
 *                           company_name: { type: string }
 *                           created_at: { type: string, format: date-time }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 */
router.get(
  '/posts',
  [
    query('search').optional().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  ctrl.listPosts
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /public/posts/:id/view — زيادة المشاهدات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /public/posts/{id}/view:
 *   post:
 *     summary: زيادة عدد مشاهدات منشور
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تمت الزيادة
 *       404:
 *         description: المنشور غير موجود
 */
router.post(
  '/posts/:id/view',
  [param('id').isUUID()],
  validate,
  ctrl.viewPost
);

module.exports = router;