const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');

const router = express.Router();

// ============================================================
// POST /user/register — สมัครสมาชิก
// ============================================================
/**
 * @swagger
 * /user/register:
 *   post:
 *     tags: [User]
 *     summary: สมัครสมาชิกเข้าใช้งาน app
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserRegisterRequest'
 *     responses:
 *       201:
 *         description: สมัครสมาชิกสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserRegisterResponse'
 *       400:
 *         description: ข้อมูลไม่ครบหรือ username ซ้ำ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register', async (req, res) => {
  const { username, password, birthday, phone, line_id, email, image_base64 } = req.body;

  if (!username || !password)
    return res.status(400).json({ success: false, error: 'username และ password จำเป็นต้องระบุ' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (username, password, birthday, phone, line_id, email, image_base64, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      username,
      hashedPassword,
      birthday || null,
      phone || null,
      line_id || null,
      email || null,
      image_base64 || null,
      username,
      username,
    );
    const user = db.prepare(`
      SELECT id, username, birthday, phone, line_id, email, image_base64, created_at, created_by, updated_at, updated_by
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ success: true, message: 'สมัครสมาชิกสำเร็จ', user });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed'))
      return res.status(400).json({ success: false, error: 'username หรือ email นี้ถูกใช้งานแล้ว' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// GET /user/list — ดูรายชื่อ users ทั้งหมด
// ============================================================
/**
 * @swagger
 * /user/list:
 *   get:
 *     tags: [User]
 *     summary: ดูรายชื่อผู้ใช้ทั้งหมด
 *     responses:
 *       200:
 *         description: รายชื่อผู้ใช้ทั้งหมด
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserListResponse'
 */
router.get('/list', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, birthday, phone, line_id, email, image_base64, created_at, created_by, updated_at, updated_by
    FROM users
  `).all();
  res.json({ success: true, count: users.length, users });
});

// ============================================================
// GET /user/:id — ดูข้อมูล user คนเดียว
// ============================================================
/**
 * @swagger
 * /user/{id}:
 *   get:
 *     tags: [User]
 *     summary: ดูข้อมูลผู้ใช้ตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: ข้อมูลผู้ใช้
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 user:
 *                   $ref: '#/components/schemas/UserObject'
 *       404:
 *         description: ไม่พบผู้ใช้
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', (req, res) => {
  const user = db.prepare(`
    SELECT id, username, birthday, phone, line_id, email, image_base64, created_at, created_by, updated_at, updated_by
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });
  res.json({ success: true, user });
});

module.exports = router;
