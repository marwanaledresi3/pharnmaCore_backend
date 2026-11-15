// controllers/PostsController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/feed
// ═══════════════════════════════════════════════════════════════════════════
const listFeed = asyncHandler(async (req, res) => {
  const userCompanyId = req.user.company_id;
  const { page = 1, limit = 10 } = req.query;

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const rows = await pool.query(
    `SELECT
       p.id,
       p.company_id,
       c.name AS company_name,
       p.title,
       p.content,
       p.media_url,
       p.is_public,
       p.views_count,
       p.created_at,
       p.updated_at,

       -- عدد الإعجابات
       (SELECT COUNT(*)::int FROM company_post_likes
        WHERE post_id = p.id) AS likes_count,

       -- عدد التعليقات
       (SELECT COUNT(*)::int FROM company_post_comments
        WHERE post_id = p.id) AS comments_count,

       -- هل الشركة الحالية أعجبت؟
       EXISTS (
         SELECT 1 FROM company_post_likes
         WHERE post_id = p.id AND company_id = $1
       ) AS is_liked_by_me

     FROM company_posts p
     JOIN companies c ON c.id = p.company_id
     WHERE p.is_public = TRUE
        OR p.company_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userCompanyId, safeLimit, offset]
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM company_posts p
     WHERE p.is_public = TRUE OR p.company_id = $1`,
    [userCompanyId]
  );

  const total = countRes.rows[0].total;

  res.json({
    success: true,
    items: rows.rows.map((r) => ({
      ...r,
      user_has_liked: r.is_liked_by_me,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const { title, content, media_url, is_public } = req.body;

  if (!title || !String(title).trim()) {
    throw new ApiError(400, 'title is required');
  }
  if (!content || !String(content).trim()) {
    throw new ApiError(400, 'content is required');
  }

  const inserted = await pool.query(
    `INSERT INTO company_posts
       (company_id, title, content, media_url, is_public)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, title, content, media_url,
               is_public, views_count, created_at, updated_at`,
    [
      companyId,
      String(title).trim(),
      String(content).trim(),
      media_url ? String(media_url).trim() : null,
      is_public === undefined ? true : Boolean(is_public),
    ]
  );

  res.status(201).json({
    success: true,
    data: {
      ...inserted.rows[0],
      likes_count: 0,
      comments_count: 0,
      is_liked_by_me: false,
      user_has_liked: false,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/like  (toggle)
// ═══════════════════════════════════════════════════════════════════════════
const toggleLike = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params;

  // تحقق من وجود المنشور
  const post = await pool.query(
    `SELECT id FROM company_posts WHERE id = $1 AND is_public = TRUE`,
    [id]
  );
  if (!post.rowCount) {
    throw new ApiError(404, 'Post not found or not public');
  }

  // هل أعجبت سابقاً؟
  const existing = await pool.query(
    `SELECT id FROM company_post_likes
     WHERE post_id = $1 AND company_id = $2`,
    [id, companyId]
  );

  let liked;
  if (existing.rowCount > 0) {
    // إلغاء الإعجاب
    await pool.query(
      `DELETE FROM company_post_likes WHERE id = $1`,
      [existing.rows[0].id]
    );
    liked = false;
  } else {
    // إضافة إعجاب
    await pool.query(
      `INSERT INTO company_post_likes (post_id, company_id)
       VALUES ($1, $2)`,
      [id, companyId]
    );
    liked = true;
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM company_post_likes WHERE post_id = $1`,
    [id]
  );

  res.json({
    success: true,
    data: { liked, likes_count: countRes.rows[0].cnt },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/comments
// ═══════════════════════════════════════════════════════════════════════════
const addComment = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params;
  const { comment_text } = req.body;

  if (!comment_text || !String(comment_text).trim()) {
    throw new ApiError(400, 'comment_text is required');
  }

  const post = await pool.query(
    `SELECT id FROM company_posts WHERE id = $1`,
    [id]
  );
  if (!post.rowCount) {
    throw new ApiError(404, 'Post not found');
  }

  const inserted = await pool.query(
    `INSERT INTO company_post_comments (post_id, company_id, comment_text)
     VALUES ($1, $2, $3)
     RETURNING id, post_id, company_id, comment_text, created_at`,
    [id, companyId, String(comment_text).trim()]
  );

  const companyRes = await pool.query(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId]
  );

  res.status(201).json({
    success: true,
    data: {
      ...inserted.rows[0],
      company_name: companyRes.rows[0]?.name || null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/:id/comments
// ═══════════════════════════════════════════════════════════════════════════
const listComments = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const post = await pool.query(
    `SELECT id FROM company_posts WHERE id = $1`,
    [id]
  );
  if (!post.rowCount) {
    throw new ApiError(404, 'Post not found');
  }

  const rows = await pool.query(
    `SELECT
       c.id,
       c.post_id,
       c.company_id,
       co.name AS company_name,
       c.comment_text,
       c.created_at
     FROM company_post_comments c
     JOIN companies co ON co.id = c.company_id
     WHERE c.post_id = $1
     ORDER BY c.created_at ASC`,
    [id]
  );

  res.json({
    success: true,
    items: rows.rows,
  });
});

module.exports = {
  listFeed,
  create,
  toggleLike,
  addComment,
  listComments,
};