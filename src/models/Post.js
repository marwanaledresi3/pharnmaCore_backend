const {pool} = require('../config/pool');

class Post {
  static async create(companyId, { title, content, media_url, is_public }) {
    const r = await pool.query(
      `INSERT INTO company_posts (company_id, title, content, media_url, is_public)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, title, content, media_url || null, is_public ?? true]
    );
    return r.rows[0];
  }

  static async getPublicFeed({ page = 1, limit = 20 }) {
    const offset = (Number(page) - 1) * Number(limit);
    const r = await pool.query(
      `SELECT p.*, c.name AS company_name,
              (SELECT COUNT(*) FROM company_post_likes l WHERE l.post_id = p.id) AS likes_count,
              (SELECT COUNT(*) FROM company_post_comments cm WHERE cm.post_id = p.id) AS comments_count
       FROM company_posts p
       JOIN companies c ON c.id = p.company_id
       WHERE p.is_public = TRUE
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return r.rows;
  }

  static async toggleLike(postId, companyId) {
    const existing = await pool.query(
      `SELECT id FROM company_post_likes WHERE post_id = $1 AND company_id = $2`,
      [postId, companyId]
    );

    if (existing.rowCount > 0) {
      await pool.query(`DELETE FROM company_post_likes WHERE post_id = $1 AND company_id = $2`, [postId, companyId]);
      return { liked: false };
    } else {
      await pool.query(
        `INSERT INTO company_post_likes (post_id, company_id) VALUES ($1, $2)`,
        [postId, companyId]
      );
      return { liked: true };
    }
  }

  static async addComment(postId, companyId, commentText) {
    const r = await pool.query(
      `INSERT INTO company_post_comments (post_id, company_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [postId, companyId, commentText]
    );
    return r.rows[0];
  }

  static async getComments(postId) {
    const r = await pool.query(
      `SELECT cm.*, c.name AS company_name
       FROM company_post_comments cm
       JOIN companies c ON c.id = cm.company_id
       WHERE cm.post_id = $1
       ORDER BY cm.created_at ASC`,
      [postId]
    );
    return r.rows;
  }
}

module.exports = Post;