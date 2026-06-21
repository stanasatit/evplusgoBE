const express = require('express');
const db = require('../database');
const router = express.Router();

const sessionWithDetails = `
  SELECT
    cs.*,
    u.username,
    st.name  AS station_name, st.address AS station_address,
    uv.license_plate, uv.color, uv.nickname,
    ec.brand, ec.model,
    b.booking_date, b.start_time AS booking_start, b.end_time AS booking_end
  FROM charging_sessions cs
  LEFT JOIN users u              ON cs.user_id    = u.id
  LEFT JOIN charging_stations st ON cs.station_id = st.id
  LEFT JOIN user_vehicles uv     ON cs.vehicle_id = uv.id
  LEFT JOIN ev_car_master ec     ON uv.ev_car_id  = ec.id
  LEFT JOIN bookings b           ON cs.booking_id = b.id
`;

// ============================================================
// GET /charging-session — ดู sessions ทั้งหมด
// ============================================================
/**
 * @swagger
 * /charging-session:
 *   get:
 *     tags: [Charging Session]
 *     summary: ดูประวัติการชาร์จและค่าบริการทั้งหมด
 *     responses:
 *       200:
 *         description: รายการ charging sessions
 */
router.get('/', (req, res) => {
  const list = db.prepare(`${sessionWithDetails} ORDER BY cs.created_at DESC`).all();
  res.json({ success: true, count: list.length, data: list });
});

// ============================================================
// GET /charging-session/user/:user_id — ดูตาม user
// ============================================================
/**
 * @swagger
 * /charging-session/user/{user_id}:
 *   get:
 *     tags: [Charging Session]
 *     summary: ดูประวัติการชาร์จตาม user_id
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ประวัติการชาร์จของผู้ใช้
 */
router.get('/user/:user_id', (req, res) => {
  const list = db.prepare(`${sessionWithDetails} WHERE cs.user_id = ? ORDER BY cs.created_at DESC`).all(req.params.user_id);
  res.json({ success: true, count: list.length, data: list });
});

// ============================================================
// GET /charging-session/:id — ดูตาม ID
// ============================================================
/**
 * @swagger
 * /charging-session/{id}:
 *   get:
 *     tags: [Charging Session]
 *     summary: ดูรายละเอียด session ตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: รายละเอียด session
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare(`${sessionWithDetails} WHERE cs.id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล session' });
  res.json({ success: true, data: item });
});

// ============================================================
// POST /charging-session — เริ่ม session (เริ่มชาร์จ)
// ============================================================
/**
 * @swagger
 * /charging-session:
 *   post:
 *     tags: [Charging Session]
 *     summary: เริ่ม session การชาร์จ
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, station_id, username]
 *             properties:
 *               user_id:       { type: integer, example: 1 }
 *               station_id:    { type: integer, example: 1 }
 *               booking_id:    { type: integer, example: 1, description: ID การจอง (optional) }
 *               vehicle_id:    { type: integer, example: 1 }
 *               actual_start:  { type: string, example: "2026-07-01 10:00:00" }
 *               rate_per_kwh:  { type: number, example: 6.5, description: ราคาต่อ kWh (บาท) }
 *               service_fee:   { type: number, example: 10.0, description: ค่าบริการคงที่ (บาท) }
 *               payment_method: { type: string, example: QR_CODE, description: วิธีชำระเงิน }
 *               note:          { type: string, example: ชาร์จที่จอดรถชั้น B1 }
 *               username:      { type: string, example: john_doe }
 *     responses:
 *       201:
 *         description: เริ่ม session สำเร็จ
 */
router.post('/', (req, res) => {
  const { user_id, station_id, booking_id, vehicle_id, actual_start, rate_per_kwh, service_fee, payment_method, note, username } = req.body;

  if (!user_id || !station_id) return res.status(400).json({ success: false, error: 'user_id และ station_id จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO charging_sessions
      (booking_id, user_id, station_id, vehicle_id, actual_start, rate_per_kwh, service_fee, payment_method, note, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    booking_id   || null,
    user_id,
    station_id,
    vehicle_id   || null,
    actual_start || null,
    rate_per_kwh || 0,
    service_fee  || 0,
    payment_method || null,
    note         || null,
    username,
    username,
  );

  const item = db.prepare(`${sessionWithDetails} WHERE cs.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'เริ่ม session การชาร์จสำเร็จ', data: item });
});

// ============================================================
// PUT /charging-session/:id/finish — สิ้นสุดการชาร์จ + คำนวณค่าบริการ
// ============================================================
/**
 * @swagger
 * /charging-session/{id}/finish:
 *   put:
 *     tags: [Charging Session]
 *     summary: สิ้นสุดการชาร์จ และคำนวณค่าบริการอัตโนมัติ
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [actual_end, energy_kwh, username]
 *             properties:
 *               actual_end:  { type: string, example: "2026-07-01 11:30:00" }
 *               energy_kwh:  { type: number, example: 25.5, description: พลังงานที่ใช้ (kWh) }
 *               discount:    { type: number, example: 5.0, description: ส่วนลด (บาท) }
 *               username:    { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: สิ้นสุดและคำนวณค่าบริการสำเร็จ
 *       404:
 *         description: ไม่พบ session
 */
router.put('/:id/finish', (req, res) => {
  const { actual_end, energy_kwh, discount, username } = req.body;

  if (!actual_end || energy_kwh == null) return res.status(400).json({ success: false, error: 'actual_end และ energy_kwh จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const session = db.prepare('SELECT * FROM charging_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล session' });

  const disc = discount || 0;
  const total = (energy_kwh * session.rate_per_kwh) + session.service_fee - disc;

  db.prepare(`
    UPDATE charging_sessions
    SET actual_end = ?, energy_kwh = ?, discount = ?, total_amount = ?,
        payment_status = 'COMPLETED',
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(actual_end, energy_kwh, disc, total < 0 ? 0 : total, username, req.params.id);

  const item = db.prepare(`${sessionWithDetails} WHERE cs.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'สิ้นสุดการชาร์จสำเร็จ', data: item });
});

// ============================================================
// PUT /charging-session/:id/payment — อัปเดตสถานะการชำระเงิน
// ============================================================
/**
 * @swagger
 * /charging-session/{id}/payment:
 *   put:
 *     tags: [Charging Session]
 *     summary: อัปเดตสถานะการชำระเงิน
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [payment_status, username]
 *             properties:
 *               payment_status:
 *                 type: string
 *                 enum: [PENDING, COMPLETED, FAILED, REFUNDED]
 *                 example: COMPLETED
 *               payment_method: { type: string, example: QR_CODE }
 *               username: { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 *       404:
 *         description: ไม่พบ session
 */
router.put('/:id/payment', (req, res) => {
  const { payment_status, payment_method, username } = req.body;

  if (!payment_status) return res.status(400).json({ success: false, error: 'payment_status จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const valid = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'];
  if (!valid.includes(payment_status))
    return res.status(400).json({ success: false, error: `payment_status ต้องเป็น: ${valid.join(', ')}` });

  const session = db.prepare('SELECT id FROM charging_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล session' });

  const paidAt = payment_status === 'COMPLETED' ? `datetime('now', 'localtime')` : 'NULL';

  db.prepare(`
    UPDATE charging_sessions
    SET payment_status = ?, payment_method = COALESCE(?, payment_method),
        paid_at = ${paidAt},
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(payment_status, payment_method || null, username, req.params.id);

  const item = db.prepare(`${sessionWithDetails} WHERE cs.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'อัปเดตสถานะการชำระเงินสำเร็จ', data: item });
});

module.exports = router;
