const express = require('express');
const db = require('../database');
const router = express.Router();

const bookingWithDetails = `
  SELECT b.*,
    u.username,
    cs.name AS station_name, cs.address AS station_address, cs.lat, cs.long,
    uv.license_plate, uv.color, uv.nickname,
    ec.brand, ec.model,
    sss.code AS status_code, sss.name AS status_name
  FROM bookings b
  LEFT JOIN users u ON b.user_id = u.id
  LEFT JOIN charging_stations cs ON b.station_id = cs.id
  LEFT JOIN user_vehicles uv ON b.vehicle_id = uv.id
  LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
  LEFT JOIN station_service_status sss ON b.status_id = sss.id
`;

/**
 * @swagger
 * /booking:
 *   get:
 *     tags: [Booking]
 *     summary: ดูการจองทั้งหมด
 *     responses:
 *       200:
 *         description: รายการการจอง
 */
router.get('/', (req, res) => {
  const list = db.prepare(`${bookingWithDetails} ORDER BY b.booking_date DESC, b.start_time DESC`).all();
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /booking/user/{user_id}:
 *   get:
 *     tags: [Booking]
 *     summary: ดูการจองตาม user_id
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: รายการการจองของผู้ใช้
 */
router.get('/user/:user_id', (req, res) => {
  const list = db.prepare(`${bookingWithDetails} WHERE b.user_id = ? ORDER BY b.booking_date DESC`).all(req.params.user_id);
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /booking/{id}:
 *   get:
 *     tags: [Booking]
 *     summary: ดูการจองตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ข้อมูลการจอง
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลการจอง' });
  res.json({ success: true, data: item });
});

/**
 * @swagger
 * /booking:
 *   post:
 *     tags: [Booking]
 *     summary: สร้างการจองใหม่
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, station_id, booking_date, start_time, username]
 *             properties:
 *               user_id:      { type: integer, example: 1 }
 *               station_id:   { type: integer, example: 1 }
 *               vehicle_id:   { type: integer, example: 1 }
 *               booking_date: { type: string, example: "2026-07-01" }
 *               start_time:   { type: string, example: "10:00" }
 *               end_time:     { type: string, example: "11:00" }
 *               status_id:    { type: integer, example: 3 }
 *               note:         { type: string, example: ขอจองตู้ที่ใกล้ทางเข้า }
 *               username:     { type: string, example: john_doe }
 *     responses:
 *       201:
 *         description: จองสำเร็จ
 */
router.post('/', (req, res) => {
  const { user_id, station_id, vehicle_id, booking_date, start_time, end_time, status_id, note, username } = req.body;
  if (!user_id || !station_id) return res.status(400).json({ success: false, error: 'user_id และ station_id จำเป็นต้องระบุ' });
  if (!booking_date || !start_time) return res.status(400).json({ success: false, error: 'booking_date และ start_time จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO bookings (user_id, station_id, vehicle_id, booking_date, start_time, end_time, status_id, note, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user_id, station_id, vehicle_id || null, booking_date, start_time, end_time || null, status_id || null, note || null, username, username);

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'จองสำเร็จ', data: item });
});

/**
 * @swagger
 * /booking/{id}:
 *   put:
 *     tags: [Booking]
 *     summary: แก้ไขการจอง / อัปเดตสถานะ
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
 *             required: [username]
 *             properties:
 *               station_id:   { type: integer }
 *               vehicle_id:   { type: integer }
 *               booking_date: { type: string }
 *               start_time:   { type: string }
 *               end_time:     { type: string }
 *               status_id:    { type: integer }
 *               note:         { type: string }
 *               username:     { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const { station_id, vehicle_id, booking_date, start_time, end_time, status_id, note, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลการจอง' });

  db.prepare(`
    UPDATE bookings
    SET station_id = COALESCE(?, station_id), vehicle_id = COALESCE(?, vehicle_id),
        booking_date = COALESCE(?, booking_date), start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time), status_id = COALESCE(?, status_id),
        note = COALESCE(?, note),
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(station_id, vehicle_id, booking_date, start_time, end_time, status_id, note, username, req.params.id);

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'แก้ไขการจองสำเร็จ', data: item });
});

module.exports = router;
