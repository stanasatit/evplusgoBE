const express = require('express');
const db = require('../database');

const router = express.Router();

// ============================================================
// POST /device-token — Insert FCM Token
// ============================================================
/**
 * @swagger
 * /device-token:
 *   post:
 *     tags: [DeviceToken]
 *     summary: บันทึก UUID และ FCM Token ของ device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uuid, fcm_token, username]
 *             properties:
 *               uuid:
 *                 type: string
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: UUID ของ device
 *               fcm_token:
 *                 type: string
 *                 example: "FCM_TOKEN_HERE"
 *                 description: FCM Token ของ device
 *               user_id:
 *                 type: integer
 *                 example: 1
 *                 description: ID ของ user (optional)
 *               platform:
 *                 type: string
 *                 enum: [android, ios]
 *                 example: "android"
 *                 description: ระบบปฏิบัติการของ device
 *               username:
 *                 type: string
 *                 example: "john_doe"
 *                 description: ชื่อผู้บันทึก (ใช้เป็น created_by)
 *     responses:
 *       201:
 *         description: บันทึกสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceTokenResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: UUID นี้มีอยู่แล้ว ให้ใช้ PUT เพื่ออัปเดต
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', (req, res) => {
  const { uuid, fcm_token, user_id, platform, username } = req.body;

  if (!uuid) return res.status(400).json({ success: false, error: 'uuid is required' });
  if (!fcm_token) return res.status(400).json({ success: false, error: 'fcm_token is required' });
  if (!username) return res.status(400).json({ success: false, error: 'username is required' });

  try {
    const stmt = db.prepare(`
      INSERT INTO device_tokens (uuid, fcm_token, user_id, platform, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      uuid,
      fcm_token,
      user_id || null,
      platform || null,
      username,
      username,
    );

    const record = db.prepare('SELECT * FROM device_tokens WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, message: 'บันทึก FCM Token สำเร็จ', data: record });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed'))
      return res.status(409).json({ success: false, error: 'UUID นี้มีอยู่แล้ว กรุณาใช้ PUT /device-token/:uuid เพื่ออัปเดต' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// PUT /device-token/:uuid — Update FCM Token
// ============================================================
/**
 * @swagger
 * /device-token/{uuid}:
 *   put:
 *     tags: [DeviceToken]
 *     summary: อัปเดต FCM Token ตาม UUID
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcm_token, username]
 *             properties:
 *               fcm_token:
 *                 type: string
 *                 example: "NEW_FCM_TOKEN_HERE"
 *                 description: FCM Token ใหม่
 *               platform:
 *                 type: string
 *                 enum: [android, ios]
 *                 example: "android"
 *               username:
 *                 type: string
 *                 example: "john_doe"
 *                 description: ชื่อผู้แก้ไข (ใช้เป็น updated_by)
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceTokenResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: ไม่พบ UUID นี้
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { fcm_token, platform, username } = req.body;

  if (!fcm_token) return res.status(400).json({ success: false, error: 'fcm_token is required' });
  if (!username) return res.status(400).json({ success: false, error: 'username is required' });

  const existing = db.prepare('SELECT id FROM device_tokens WHERE uuid = ?').get(uuid);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบ UUID นี้ในระบบ' });

  const fields = ['fcm_token = ?', "updated_at = datetime('now', 'localtime')", 'updated_by = ?'];
  const values = [fcm_token, username];

  if (platform !== undefined) {
    fields.push('platform = ?');
    values.push(platform);
  }

  values.push(uuid);
  db.prepare(`UPDATE device_tokens SET ${fields.join(', ')} WHERE uuid = ?`).run(...values);

  const record = db.prepare('SELECT * FROM device_tokens WHERE uuid = ?').get(uuid);
  res.json({ success: true, message: 'อัปเดต FCM Token สำเร็จ', data: record });
});

// ============================================================
// GET /device-token — ดู tokens ทั้งหมด
// ============================================================
/**
 * @swagger
 * /device-token:
 *   get:
 *     tags: [DeviceToken]
 *     summary: ดู FCM Tokens ทั้งหมด
 *     responses:
 *       200:
 *         description: รายการ FCM Tokens
 */
router.get('/', (req, res) => {
  const records = db.prepare('SELECT * FROM device_tokens ORDER BY created_at DESC').all();
  res.json({ success: true, count: records.length, data: records });
});

// ============================================================
// GET /device-token/:uuid — ดู token ตาม UUID
// ============================================================
/**
 * @swagger
 * /device-token/{uuid}:
 *   get:
 *     tags: [DeviceToken]
 *     summary: ดู FCM Token ตาม UUID
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       200:
 *         description: ข้อมูล FCM Token
 *       404:
 *         description: ไม่พบ UUID นี้
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:uuid', (req, res) => {
  const record = db.prepare('SELECT * FROM device_tokens WHERE uuid = ?').get(req.params.uuid);
  if (!record) return res.status(404).json({ success: false, error: 'ไม่พบ UUID นี้ในระบบ' });
  res.json({ success: true, data: record });
});

module.exports = router;
