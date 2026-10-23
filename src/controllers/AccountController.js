const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Account = require('../models/Account');

/**
 * GET /accounts/tree
 */
const getTree = asyncHandler(async (req, res) => {
  const tree = await Account.getTree(req.user.company_id);
  res.json({ success: true, data: tree });
});

/**
 * GET /accounts
 */
const list = asyncHandler(async (req, res) => {
  const { type, is_active, search } = req.query;
  const accounts = await Account.listFiltered(req.user.company_id, {
    type,
    is_active: is_active === undefined ? undefined : is_active === 'true',
    search,
  });
  res.json({ success: true, data: accounts });
});

/**
 * GET /accounts/postable
 */
const listPostable = asyncHandler(async (req, res) => {
  const accounts = await Account.listPostable(req.user.company_id);
  res.json({ success: true, data: accounts });
});

/**
 * GET /accounts/:id
 */
const getOne = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.user.company_id, req.params.id);
  if (!account) throw new ApiError(404, 'Account not found');

  // إضافة معلومات مفيدة
  account.has_children = await Account.hasChildren(req.user.company_id, account.id);
  account.has_journal_lines = await Account.hasJournalLines(account.id);
  account.is_postable = !account.has_children && account.is_active;

  res.json({ success: true, data: account });
});

/**
 * GET /accounts/:id/ledger
 */
const getLedger = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.user.company_id, req.params.id);
  if (!account) throw new ApiError(404, 'Account not found');

  const { date_from, date_to } = req.query;
  const ledger = await Account.getLedger(req.user.company_id, account.id, {
    date_from,
    date_to,
  });

  res.json({
    success: true,
    data: {
      account,
      ...ledger,
    },
  });
});

/**
 * POST /accounts
 */
const create = asyncHandler(async (req, res) => {
  try {
    const account = await Account.createValidated(req.user.company_id, req.body);
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    // نحوّل أخطاء المنطق إلى ApiError
    if (err.message.includes('not found') || err.message.includes('must match')
        || err.message.includes('already exists')) {
      throw new ApiError(400, err.message);
    }
    throw err;
  }
});

/**
 * PATCH /accounts/:id
 */
const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  const existing = await Account.findById(companyId, id);
  if (!existing) throw new ApiError(404, 'Account not found');

  // 1) منع تغيير parent_id إلى نفسه أو أحد أبنائه
  if (req.body.parent_id) {
    if (req.body.parent_id === id) {
      throw new ApiError(400, 'Account cannot be its own parent');
    }
    const isDescendant = await Account.isDescendantOf(companyId, req.body.parent_id, id);
    if (isDescendant) {
      throw new ApiError(400, 'Cannot set a descendant as parent');
    }

    // التحقق من نوع الأب
    const parent = await Account.findById(companyId, req.body.parent_id);
    if (!parent) throw new ApiError(400, 'Parent account not found');
    if (parent.account_type !== existing.account_type) {
      throw new ApiError(400, `Parent type must be ${existing.account_type}`);
    }
  }

  // 2) منع تغيير code إلى كود موجود
  if (req.body.code && req.body.code !== existing.code) {
    if (await Account.existsByCode(companyId, req.body.code)) {
      throw new ApiError(409, 'Account code already exists');
    }
  }

  const updated = await Account.update(companyId, id, req.body);
  if (!updated) throw new ApiError(400, 'No valid fields to update');

  res.json({ success: true, data: updated });
});

/**
 * PATCH /accounts/:id/status
 */
const changeStatus = asyncHandler(async (req, res) => {
  const { is_active } = req.body;
  const updated = await Account.setStatus(req.user.company_id, req.params.id, is_active);
  if (!updated) throw new ApiError(404, 'Account not found');
  res.json({ success: true, data: updated });
});

/**
 * DELETE /accounts/:id
 */
const remove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  const account = await Account.findById(companyId, id);
  if (!account) throw new ApiError(404, 'Account not found');

  // 1) منع الحذف إن كان له أبناء
  if (await Account.hasChildren(companyId, id)) {
    throw new ApiError(400, 'Cannot delete account with children');
  }

  // 2) منع الحذف إن كان له قيود
  if (await Account.hasJournalLines(id)) {
    throw new ApiError(400, 'Cannot delete account with journal entries');
  }

  await Account.delete(companyId, id);
  res.json({ success: true, message: 'Account deleted' });
});

module.exports = {
  getTree,
  list,
  listPostable,
  getOne,
  getLedger,
  create,
  update,
  changeStatus,
  remove,
};