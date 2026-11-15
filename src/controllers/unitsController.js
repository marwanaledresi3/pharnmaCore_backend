
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const UnitsModel = require('../models/units');

// GET /units
const list = asyncHandler(async (req, res) => {
  const { search, is_active } = req.query;

  try{
   const data = await UnitsModel.findAll(
    req.user.company_id,
    {
      search,
      is_active:
        is_active === undefined
          ? undefined
          : is_active === 'true',
    }
  );

  res.json({
    success: true,
    data,
  });
  } catch (error) {
    console.error('Error fetching units:', error);
    throw new ApiError(400, error.message);
  }
});

// GET /units/:id
const getById = asyncHandler(async (req, res) => {
  const unit = await UnitsModel.findById(
    req.params.id,
    req.user.company_id
  );

  if (!unit) {
    throw new ApiError(404, 'Unit not found');
  }

  res.json({
    success: true,
    data: unit,
  });
});

// POST /units
const create = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;

  const { code, name, name_en } = req.body;

  const normalized = {
    code: String(code).trim(),
    name: String(name).trim(),
    name_en: name_en ? String(name_en).trim() : null,
  };

  const exists = await UnitsModel.findDuplicate(
    companyId,
    normalized.code,
    normalized.name
  );

  if (exists) {
    throw new ApiError(409, 'Unit code or name already exists');
  }

  const unit = await UnitsModel.create(
    companyId,
    normalized
  );

  res.status(201).json({
    success: true,
    data: unit,
  });
});

// PATCH /units/:id
const update = asyncHandler(async (req, res) => {
  const unit = await UnitsModel.update(
    req.params.id,
    req.user.company_id,
    req.body
  );

  if (!unit) {
    const hasFields = Object.keys(req.body).some(
      key => ['code', 'name', 'name_en', 'is_active']
        .includes(key)
    );

    if (!hasFields) {
      throw new ApiError(400, 'No fields to update');
    }

    throw new ApiError(404, 'Unit not found');
  }

  res.json({
    success: true,
    data: unit,
  });
});

// DELETE /units/:id
const remove = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const id = req.params.id;

  const used = await UnitsModel.isUsed(id, companyId);

  if (used) {
    throw new ApiError(
      400,
      'Cannot delete unit: used by one or more products'
    );
  }

  const deleted = await UnitsModel.delete(id, companyId);

  if (!deleted) {
    throw new ApiError(404, 'Unit not found');
  }

  res.json({
    success: true,
    message: 'Unit deleted',
    data: { id: deleted.id },
  });
});

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
};
