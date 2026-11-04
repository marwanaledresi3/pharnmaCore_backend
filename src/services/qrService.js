require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const ApiError = require('../errors/ApiError');

const SECRET = process.env.QR_SIGNING_SECRET || 'your-super-secret-key-change-this-in-production-min-32-chars';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const DEFAULT_TTL_DAYS = 7;

if (!SECRET) {
  throw new Error('[qrService] QR_SIGNING_SECRET أو JWT_SECRET غير معرّف في البيئة');
}

/**
 * خدمة توليد والتحقق من رموز QR للتسليم.
 *
 * الوضع:
 * - authenticated: يتطلب تسجيل دخول مستخدم من شركة المشتري
 * - public: رابط عام + PIN (6 أرقام)
 * - both: يدعم الاثنين
 */
class QRService {
  /**
   * يولّد token + QR image data URL.
   *
   * @param {object} client - pg client (داخل معاملة)
   * @param {object} params
   * @param {object} params.order - صف purchase_orders (يحتوي id, order_number, company_id, supplier_company_id, total)
   * @param {string} params.mode - 'authenticated' | 'public' | 'both'
   * @param {number} [params.ttlDays] - صلاحية بالأيام (افتراضي 7)
   * @param {string} params.createdBy - user id للمورد
   * @returns {Promise<{token, url, qrDataUrl, pin, expiresAt, deliveryTokenId}>}
   */
  static async generateForOrder(client, { order, mode = 'both', ttlDays = DEFAULT_TTL_DAYS, createdBy }) {
    if (!order || !order.id) {
      throw new ApiError(400, 'Order is required to generate QR');
    }

    const jti = crypto.randomBytes(16).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresInSec = Math.max(1, Math.floor(ttlDays * 24 * 60 * 60));
    const expiresAt = new Date((issuedAt + expiresInSec) * 1000);

    // PIN للوضع العام فقط
    let pin = null;
    let pinHash = null;
    if (mode === 'public' || mode === 'both') {
      pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      pinHash = await QRService._hashPin(pin);
    }

    // JWT payload
    const payload = {
      jti,
      order_id: order.id,
      order_number: order.order_number,
      supplier_company_id: order.supplier_company_id,
      buyer_company_id: order.company_id,
      total: Number(order.total) || 0,
      mode,
    };

    const token = jwt.sign(payload, SECRET, {
      expiresIn: expiresInSec,
      issuer: 'pharma-core',
      audience: 'delivery-qr',
    });

    const tokenHash = QRService._sha256(token);

    // احفظ في قاعدة البيانات
    const ins = await client.query(
      `INSERT INTO delivery_tokens
         (order_id, token_hash, token_jti, mode, pin_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, expires_at`,
      [order.id, tokenHash, jti, mode, pinHash, expiresAt, createdBy]
    );

    const deliveryTokenId = ins.rows[0].id;

    // رابط QR
    const url = `${FRONTEND_URL}/deliveries/confirm?token=${encodeURIComponent(token)}`;

    // صورة QR
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });

    return {
      deliveryTokenId,
      token,
      url,
      qrDataUrl,
      pin,           // يُعرض مرة واحدة للمورد
      expiresAt,
      mode,
    };
  }

  /**
   * يتحقق من token ويعيد الحمولة + صف delivery_tokens.
   * لا يعلّم كمستخدم — هذا يتم في confirm.
   *
   * @param {object} client
   * @param {string} token
   * @param {object} opts
   * @param {'authenticated'|'public'} opts.mode - وضع التحقق
   * @param {string} [opts.pin] - مطلوب للوضع العام
   * @param {string} [opts.userCompanyId] - مطلوب للوضع المصادق
   * @returns {Promise<{payload, deliveryToken}>}
   */
  static async verify(client, token, opts = {}) {
    const { mode = 'authenticated', pin, userCompanyId } = opts;

    if (!token || typeof token !== 'string') {
      throw new ApiError(400, 'Missing delivery token');
    }

    // 1. تحقق من التوقيع
    let payload;
    try {
      payload = jwt.verify(token, SECRET, {
        issuer: 'pharma-core',
        audience: 'delivery-qr',
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new ApiError(410, 'انتهت صلاحية رمز التسليم');
      }
      throw new ApiError(401, 'رمز التسليم غير صالح');
    }

    // 2. ابحث في قاعدة البيانات
    const tokenHash = QRService._sha256(token);
    const r = await client.query(
      `SELECT * FROM delivery_tokens
       WHERE order_id = $1 AND token_jti = $2 AND token_hash = $3
       FOR UPDATE`,
      [payload.order_id, payload.jti, tokenHash]
    );
    const deliveryToken = r.rows[0];

    if (!deliveryToken) {
      throw new ApiError(404, 'رمز التسليم غير موجود');
    }
    if (deliveryToken.revoked_at) {
      throw new ApiError(410, 'تم إلغاء رمز التسليم');
    }
    if (deliveryToken.used_at) {
      throw new ApiError(409, 'تم استخدام رمز التسليم مسبقاً');
    }
    if (new Date(deliveryToken.expires_at).getTime() < Date.now()) {
      throw new ApiError(410, 'انتهت صلاحية رمز التسليم');
    }

    // 3. تحقق من الوضع
    const allowedModes = deliveryToken.mode === 'both'
      ? ['authenticated', 'public']
      : [deliveryToken.mode];

    if (!allowedModes.includes(mode)) {
      throw new ApiError(403, `رمز التسليم لا يدعم وضع "${mode}"`);
    }

    // 4. وضع المصادقة: تحقق أن المستخدم من شركة المشتري
    if (mode === 'authenticated') {
      if (!userCompanyId) {
        throw new ApiError(401, 'تسجيل الدخول مطلوب');
      }
      if (userCompanyId !== payload.buyer_company_id) {
        throw new ApiError(403, 'هذا الرمز لا يخص شركتك');
      }
    }

    // 5. وضع عام: تحقق من PIN
    if (mode === 'public') {
      if (!deliveryToken.pin_hash) {
        throw new ApiError(403, 'هذا الرمز لا يدعم الوضع العام');
      }
      if (!pin) {
        throw new ApiError(400, 'رمز PIN مطلوب');
      }
      const ok = await QRService._verifyPin(pin, deliveryToken.pin_hash);
      if (!ok) {
        throw new ApiError(401, 'رمز PIN غير صحيح');
      }
    }

    return { payload, deliveryToken };
  }

  /**
   * يعلّم token كمستخدم (يُستدعى داخل confirm).
   */
  static async markUsed(client, deliveryTokenId, { userId, mode }) {
    await client.query(
      `UPDATE delivery_tokens
       SET used_at = NOW(), used_by = $1, used_mode = $2
       WHERE id = $3 AND used_at IS NULL`,
      [userId || null, mode || null, deliveryTokenId]
    );
  }

  /**
   * يلغي كل الرموز النشطة لطلب (مثلاً عند cancel).
   */
  static async revokeForOrder(client, orderId, { userId, reason }) {
    await client.query(
      `UPDATE delivery_tokens
       SET revoked_at = NOW(), revoked_by = $1, revoked_reason = $2
       WHERE order_id = $3 AND used_at IS NULL AND revoked_at IS NULL`,
      [userId || null, reason || null, orderId]
    );
  }

  /**
   * يتحقق من صلاحية token دون استهلاكه (للمعاينة).
   */
  static async peek(client, token) {
    let payload;
    try {
      payload = jwt.verify(token, SECRET, {
        issuer: 'pharma-core',
        audience: 'delivery-qr',
      });
    } catch {
      return null;
    }

    const tokenHash = QRService._sha256(token);
    const r = await client.query(
      `SELECT dt.*, po.order_number, po.total, po.status,
              bc.name AS buyer_company_name, sc.name AS supplier_company_name
       FROM delivery_tokens dt
       JOIN purchase_orders po ON po.id = dt.order_id
       JOIN companies bc ON bc.id = po.company_id
       LEFT JOIN companies sc ON sc.id = po.supplier_company_id
       WHERE dt.order_id = $1 AND dt.token_jti = $2 AND dt.token_hash = $3`,
      [payload.order_id, payload.jti, tokenHash]
    );

    if (!r.rowCount) return null;
    return { payload, deliveryToken: r.rows[0] };
  }

  // ============ Helpers ============

  static _sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  static async _hashPin(pin) {
    // bcrypt اختياري — نستخدم scrypt المدمج
    const salt = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
      crypto.scrypt(pin, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      });
    });
  }

  static async _verifyPin(pin, stored) {
    const [salt, keyHex] = String(stored).split(':');
    if (!salt || !keyHex) return false;
    const key = Buffer.from(keyHex, 'hex');
    return new Promise((resolve) => {
      crypto.scrypt(pin, salt, 64, (err, derivedKey) => {
        if (err) return resolve(false);
        try {
          resolve(crypto.timingSafeEqual(key, derivedKey));
        } catch {
          resolve(false);
        }
      });
    });
  }
}

module.exports = QRService;