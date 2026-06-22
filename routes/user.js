const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET          = process.env.JWT_SECRET || 'evplusgo_jwt_secret_change_me';
const JWT_EXPIRES_IN      = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

function signTokens(user) {
  const payload = { id: user.id, username: user.username };
  return {
    access_token:  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
    refresh_token: jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES }),
    token_type:    'Bearer',
    expires_in:    JWT_EXPIRES_IN,
  };
}

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
    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUsername)
      return res.status(400).json({ success: false, error: 'username นี้ถูกใช้งานแล้ว' });

    if (email) {
      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existingEmail)
        return res.status(400).json({ success: false, error: 'email นี้ถูกใช้งานแล้ว' });
    }

    if (phone) {
      const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
      if (existingPhone)
        return res.status(400).json({ success: false, error: 'เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว' });
    }

    if (line_id) {
      const existingLineId = db.prepare('SELECT id FROM users WHERE line_id = ?').get(line_id);
      if (existingLineId)
        return res.status(400).json({ success: false, error: 'Line ID นี้ถูกใช้งานแล้ว' });
    }

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
// POST /user/login — เข้าสู่ระบบ
// ============================================================
/**
 * @swagger
 * /user/login:
 *   post:
 *     tags: [User]
 *     summary: เข้าสู่ระบบ (Login)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: john_doe }
 *               password: { type: string, example: "secret123" }
 *     responses:
 *       200:
 *         description: Login สำเร็จ ได้รับ access_token และ refresh_token
 *       401:
 *         description: username หรือ password ไม่ถูกต้อง
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, error: 'กรุณาระบุ username และ password' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ success: false, error: 'username หรือ password ไม่ถูกต้อง' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, error: 'username หรือ password ไม่ถูกต้อง' });

    const tokens = signTokens(user);
    const profile = db.prepare(
      'SELECT id, username, birthday, phone, line_id, email, image_base64 FROM users WHERE id = ?'
    ).get(user.id);

    res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', ...tokens, user: profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /user/refresh — ต่ออายุ access_token
// ============================================================
/**
 * @swagger
 * /user/refresh:
 *   post:
 *     tags: [User]
 *     summary: ต่ออายุ access_token ด้วย refresh_token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: ได้รับ access_token ใหม่
 *       401:
 *         description: refresh_token ไม่ถูกต้องหรือหมดอายุ
 */
router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ success: false, error: 'กรุณาระบุ refresh_token' });

  try {
    const payload = jwt.verify(refresh_token, JWT_SECRET);
    if (payload.type !== 'refresh')
      return res.status(401).json({ success: false, error: 'token ประเภทไม่ถูกต้อง' });

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ success: false, error: 'ไม่พบผู้ใช้งานในระบบ' });

    const access_token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ success: true, access_token, token_type: 'Bearer', expires_in: JWT_EXPIRES_IN });
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'refresh_token หมดอายุ กรุณา login ใหม่' : 'refresh_token ไม่ถูกต้อง';
    res.status(401).json({ success: false, error: msg });
  }
});

// ============================================================
// GET /user/me — ดูโปรไฟล์ตัวเอง (ต้อง login)
// ============================================================
/**
 * @swagger
 * /user/me:
 *   get:
 *     tags: [User]
 *     summary: ดูโปรไฟล์ผู้ใช้ที่ login อยู่
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ข้อมูลโปรไฟล์
 *       401:
 *         description: ไม่ได้ login
 */
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, birthday, phone, line_id, email, image_base64, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานในระบบ' });
  res.json({ success: true, user });
});

// ============================================================
// PUT /user/me — แก้ไขโปรไฟล์ตัวเอง (ต้อง login)
// ============================================================
/**
 * @swagger
 * /user/me:
 *   put:
 *     tags: [User]
 *     summary: แก้ไขโปรไฟล์ผู้ใช้ที่ login อยู่
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               birthday:     { type: string, example: "1995-06-15" }
 *               phone:        { type: string, example: "081-234-5678" }
 *               line_id:      { type: string }
 *               email:        { type: string }
 *               image_base64: { type: string }
 *               new_password: { type: string }
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 *       401:
 *         description: ไม่ได้ login
 */
router.put('/me', authenticate, async (req, res) => {
  const { birthday, phone, line_id, email, image_base64, new_password } = req.body;
  try {
    let hashedPassword = undefined;
    if (new_password) hashedPassword = await bcrypt.hash(new_password, 10);

    db.prepare(`
      UPDATE users SET
        birthday     = COALESCE(?, birthday),
        phone        = COALESCE(?, phone),
        line_id      = COALESCE(?, line_id),
        email        = COALESCE(?, email),
        image_base64 = COALESCE(?, image_base64),
        password     = COALESCE(?, password),
        updated_at   = datetime('now','localtime'),
        updated_by   = ?
      WHERE id = ?
    `).run(birthday ?? null, phone ?? null, line_id ?? null, email ?? null,
           image_base64 ?? null, hashedPassword ?? null,
           req.user.username, req.user.id);

    const updated = db.prepare(
      'SELECT id, username, birthday, phone, line_id, email, image_base64, updated_at FROM users WHERE id = ?'
    ).get(req.user.id);
    res.json({ success: true, message: 'อัปเดตโปรไฟล์สำเร็จ', user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /user/forgot-password — ค้นหาผู้ใช้จาก username
// ============================================================
/**
 * @swagger
 * /user/forgot-password:
 *   post:
 *     tags: [User]
 *     summary: ค้นหาข้อมูลผู้ใช้จาก username สำหรับ forgot password flow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: พบผู้ใช้
 *       400:
 *         description: ไม่ได้ระบุ username
 *       404:
 *         description: ไม่พบผู้ใช้งานในระบบ
 */
router.post('/forgot-password', (req, res) => {
  const { username } = req.body;

  if (!username)
    return res.status(400).json({ success: false, error: 'กรุณาระบุ username' });

  const user = db.prepare(
    'SELECT id, username, email, phone FROM users WHERE username = ?'
  ).get(username);

  if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานในระบบ' });

  res.json({ success: true, user });
});

// ============================================================
// POST /user/reset-password — รีเซ็ตรหัสผ่าน (ไม่ต้องยืนยันตัวตน)
// ============================================================
/**
 * @swagger
 * /user/reset-password:
 *   post:
 *     tags: [User]
 *     summary: รีเซ็ตรหัสผ่านด้วย username
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, new_password]
 *             properties:
 *               username:     { type: string, example: john_doe }
 *               new_password: { type: string, example: "newSecret123" }
 *     responses:
 *       200:
 *         description: รีเซ็ตรหัสผ่านสำเร็จ
 *       400:
 *         description: ข้อมูลไม่ครบถ้วน
 *       404:
 *         description: ไม่พบผู้ใช้งานในระบบ
 */
router.post('/reset-password', async (req, res) => {
  const { username, new_password } = req.body;

  if (!username || !new_password)
    return res.status(400).json({ success: false, error: 'กรุณาระบุ username และ new_password' });

  try {
    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานในระบบ' });

    const hashedPassword = await bcrypt.hash(new_password, 10);
    db.prepare(`
      UPDATE users SET password = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?
    `).run(hashedPassword, user.username, user.id);

    res.json({ success: true, message: 'รีเซ็ตรหัสผ่านสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
 *         description: ไม่พบผู้ใช้งานในระบบ
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
  if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานในระบบ' });
  res.json({ success: true, user });
});

module.exports = router;
