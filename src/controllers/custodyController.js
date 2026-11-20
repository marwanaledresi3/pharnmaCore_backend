// controllers/custodyController.js
const custodyService = require('../services/custody/custodyService');
const advanceService = require('../services/custody/advanceService');

const listCustodyTypes = async (req, res, next) => {
  try {
    const data = await custodyService.listCustodyTypes(req.companyId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const createCustodyType = async (req, res, next) => {
  try {
    const data = await custodyService.createCustodyType(req.companyId, req.user?.id, req.body);
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

const listCustodies = async (req, res, next) => {
  try {
    const data = await custodyService.listCustodies(req.companyId, req.query);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const getCustodyById = async (req, res, next) => {
  try {
    const data = await custodyService.getCustodyById(req.companyId, req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const createCustody = async (req, res, next) => {
  try {
    const data = await custodyService.createCustody(req.companyId, req.user?.id, req.body);
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

const addCustodyTransaction = async (req, res, next) => {
  try {
    const data = await custodyService.addCustodyTransaction(
      req.companyId,
      req.user?.id,
      req.params.id,
      req.body
    );
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

const listAdvances = async (req, res, next) => {
  try {
    const data = await advanceService.listAdvances(req.companyId, req.query);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const getAdvanceById = async (req, res, next) => {
  try {
    const data = await advanceService.getAdvanceById(req.companyId, req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const createAdvance = async (req, res, next) => {
  try {
    const data = await advanceService.createAdvance(req.companyId, req.user?.id, req.body);
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

const approveAdvance = async (req, res, next) => {
  try {
    const data = await advanceService.approveAdvance(
      req.companyId,
      req.user?.id,
      req.params.id,
      req.body?.approval_date
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const rejectAdvance = async (req, res, next) => {
  try {
    const data = await advanceService.rejectOrCancelAdvance(
      req.companyId,
      req.user?.id,
      req.params.id,
      'rejected',
      req.body?.notes
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const cancelAdvance = async (req, res, next) => {
  try {
    const data = await advanceService.rejectOrCancelAdvance(
      req.companyId,
      req.user?.id,
      req.params.id,
      'cancelled',
      req.body?.notes
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const payInstallment = async (req, res, next) => {
  try {
    const data = await advanceService.payInstallment(
      req.companyId,
      req.user?.id,
      req.params.installmentId,
      req.body
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listCustodyTypes,
  createCustodyType,
  listCustodies,
  getCustodyById,
  createCustody,
  addCustodyTransaction,
  listAdvances,
  getAdvanceById,
  createAdvance,
  approveAdvance,
  rejectAdvance,
  cancelAdvance,
  payInstallment,
};