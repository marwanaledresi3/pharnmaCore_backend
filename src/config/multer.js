// config/multer.js
const multer = require('multer');
const ApiError = require('../errors/ApiError');

// نخزن الملفات في الذاكرة (بدون كتابة على القرص)
const storage = multer.memoryStorage();

// فلتر للتحقق من نوع الملف (صور فقط)
const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new ApiError('Please upload an image file only (jpeg, png, gif).'), false);
  }
};

// middleware لرفع الشعار
const uploadLogo = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 1024 * 1024 * 3, // 2 MB limit
  },
});

module.exports = { uploadLogo };
