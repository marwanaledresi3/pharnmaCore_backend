const Post = require('../models/Post');
const ApiError = require('../errors/ApiError');

class PostController {
  static async createPost(req, res) {
    const companyId = req.user.company_id;
    const data = await Post.create(companyId, req.body);
    res.status(201).json({ success: true, data });
  }

  static async getPublicFeed(req, res) {
    const data = await Post.getPublicFeed(req.query);
    res.json({ success: true, data });
  }

  static async toggleLike(req, res) {
    const { postId } = req.params;
    const companyId = req.user.company_id;
    const result = await Post.toggleLike(postId, companyId);
    res.json({ success: true, ...result });
  }

  static async addComment(req, res) {
    const { postId } = req.params;
    const companyId = req.user.company_id;
    const { comment_text } = req.body;

    if (!comment_text) throw new ApiError(400, 'نص التعليق مطلوب');

    const data = await Post.addComment(postId, companyId, comment_text);
    res.status(201).json({ success: true, data });
  }

  static async getComments(req, res) {
    const { postId } = req.params;
    const data = await Post.getComments(postId);
    res.json({ success: true, data });
  }
}

module.exports = PostController;