// services/hr/notificationHelper.js
const { pool } = require('../../config/pool');
const settingsService = require('../settingsService');
const NotificationService = require('../notificationService');

const log = (msg, meta) => {
  if (meta) console.log(`[hr-notifications] ${msg}`, meta);
  else       console.log(`[hr-notifications] ${msg}`);
};

/**
 * إرسال إشعار HR مع احترام الإعدادات.
 *
 * ⚠️ يستخدم pool.connect() داخل transaction منفصلة — لا يعتمد على client
 *    لأن الإشعارات تُرسل بعد COMMIT في الخدمات المستدعية.
 *
 * @param {object} params
 *   - companyId, settingKey, userId (المستلم)
 *   - type (نوع الإشعار — مثل 'hr.leave_request')
 *   - title, message
 *   - referenceType, referenceId
 *   - metadata
 *   - uniqueKey (لمنع التكرار — اختياري)
 */
async function sendHrNotification({
  companyId,
  settingKey,
  userId,
  type,
  title,
  message,
  referenceType,
  referenceId,
  metadata,
  uniqueKey,
}) {
  if (!userId) {
    log(`skipped — no userId`, { settingKey });
    return null;
  }

  // 1) فحص الإعداد
  try {
    const enabled = await settingsService.getOne(companyId, settingKey, true);
    if (enabled === false) {
      log(`skipped — ${settingKey} disabled`);
      return null;
    }
  } catch (err) {
    log(`settings check failed — ${settingKey}: ${err.message}`);
    // نكمل — الإشعار أفضل من لا شيء
  }

  // 2) إرسال عبر NotificationService
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await NotificationService.create(client, {
      companyId,
      userId,
      type,
      title,
      message,
      metadata,
      referenceType,
      referenceId,
      uniqueKey,
    });

    await client.query('COMMIT');
    log(`sent — ${settingKey} → user ${userId}`);
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    log(`failed — ${settingKey}: ${err.message}`);
    return null;
  } finally {
    client.release();
  }
}

/**
 * إرسال إشعار لكل مدراء الشركة (Owner, Manager, HR Manager).
 * يستثني مستخدماً واحداً (عادةً مُنشئ الطلب).
 */
async function notifyManagers({
  companyId,
  settingKey,
  type,
  title,
  message,
  referenceType,
  referenceId,
  metadata,
  excludeUserId,
  uniqueKey,
}) {
  try {
    // جلب مدراء الشركة
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.company_id = $1
          AND u.is_active = true
          AND r.name IN ('Owner', 'Manager', 'HR Manager')
          AND ($2::uuid IS NULL OR u.id <> $2)`,
      [companyId, excludeUserId || null]
    );

    if (rows.length === 0) {
      log(`skipped — no managers found for ${companyId}`);
      return [];
    }

    const results = [];
    for (const row of rows) {
      const n = await sendHrNotification({
        companyId,
        settingKey,
        userId: row.id,
        type,
        title,
        message,
        referenceType,
        referenceId,
        metadata,
        // uniqueKey معرّف لكل مستخدم لتجنب التعارض
        uniqueKey: uniqueKey ? `${uniqueKey}:user:${row.id}` : null,
      });
      if (n) results.push(n);
    }
    return results;
  } catch (err) {
    log(`notifyManagers failed: ${err.message}`);
    return [];
  }
}

/**
 * جلب user_id من employee_id.
 */
async function getUserIdForEmployee(companyId, employeeId) {
  try {
    const { rows } = await pool.query(
      `SELECT user_id FROM employees
        WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [employeeId, companyId]
    );
    return rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

module.exports = {
  sendHrNotification,
  notifyManagers,
  getUserIdForEmployee,
};