const router = require('express').Router();
const ctrl = require('../controllers/PublicController');
const dashboardCtrl = require('../controllers/DashboardController');
const validate = require('../middlewares/validateMiddleware');
const { param, query } = require('express-validator');

// إحصائيات النظام العامة
router.get('/stats', dashboardCtrl.publicStats);

// كتالوج المنتجات العامة
router.get('/products',
  [
    query('search').optional().trim().isLength({ max: 100 }),
    query('category').optional().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate, ctrl.listProducts
);

// التصنيفات
router.get('/categories', ctrl.listCategories);

// منشورات الشركات
router.get('/posts',
  [
    query('search').optional().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate, ctrl.listPosts
);

// زيادة المشاهدات
router.post('/posts/:id/view', [param('id').isUUID()], validate, ctrl.viewPost);

module.exports = router;