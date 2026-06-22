const express = require('express');
const db = require('../database');
const { notifyBookingManual } = require('../services/bookingNotifier');
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

// ============================================================
// GET /booking/available — ดูช่วงเวลาว่างของสถานีในวันที่ระบุ
//   พร้อมตรวจสอบ overlap อัตโนมัติ
// ============================================================
/**
 * @swagger
 * /booking/available:
 *   get:
 *     tags: [Booking]
 *     summary: ดูช่วงเวลาว่างของสถานีในวันที่ระบุ (สำหรับแสดง time picker ในแอป)
 *     parameters:
 *       - in: query
 *         name: station_id
 *         required: true
 *         schema: { type: integer }
 *         example: 1
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string }
 *         example: "2026-07-01"
 *       - in: query
 *         name: slot_minutes
 *         schema: { type: integer }
 *         description: ขนาด time slot (นาที) default=60
 *     responses:
 *       200:
 *         description: ช่วงเวลาว่างและที่จองไปแล้ว
 */
router.get('/available', (req, res) => {
  const { station_id, date, slot_minutes = 60 } = req.query;
  if (!station_id || !date)
    return res.status(400).json({ success: false, error: 'station_id และ date จำเป็นต้องระบุ' });

  const station = db.prepare('SELECT id, name, total_chargers, provider_name FROM charging_stations WHERE id = ?').get(station_id);
  if (!station) return res.status(404).json({ success: false, error: 'ไม่พบสถานี' });

  // ดึงการจองในวันนั้น (ไม่รวม WALKIN และ OFFLINE)
  const offlineId = db.prepare("SELECT id FROM station_service_status WHERE code='OFFLINE'").get()?.id;
  const booked = db.prepare(`
    SELECT b.id, b.start_time, b.end_time, b.status_id,
           u.username, sss.code AS status_code
    FROM bookings b
    LEFT JOIN users u ON b.user_id = u.id
    LEFT JOIN station_service_status sss ON b.status_id = sss.id
    WHERE b.station_id = ? AND b.booking_date = ?
      AND b.booking_type != 'WALKIN'
      AND b.start_time != 'WALKIN'
      AND (? IS NULL OR b.status_id != ?)
    ORDER BY b.start_time
  `).all(station_id, date, offlineId, offlineId);

  // สร้าง time slots 06:00–22:00
  const slotMin = parseInt(slot_minutes);
  const slots = [];
  for (let h = 6; h < 22; h++) {
    for (let m = 0; m < 60; m += slotMin) {
      const start = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const endTotal = h * 60 + m + slotMin;
      if (endTotal > 22 * 60) break;
      const end = `${String(Math.floor(endTotal/60)).padStart(2,'0')}:${String(endTotal%60).padStart(2,'0')}`;

      // ตรวจ overlap: slot [start,end) ชนกับการจอง [b.start_time, b.end_time)
      const conflicts = booked.filter(b => {
        if (!b.end_time) return b.start_time === start;
        return b.start_time < end && b.end_time > start;
      });

      slots.push({
        start,
        end,
        is_available: conflicts.length < (station.total_chargers || 1),
        booking_count: conflicts.length,
        charger_total: station.total_chargers || 1,
      });
    }
  }

  res.json({
    success: true,
    station: { id: station.id, name: station.name, total_chargers: station.total_chargers },
    date,
    slot_minutes: slotMin,
    booked_count: booked.length,
    booked,
    slots,
  });
});

// ============================================================
// GET /booking/walkin/queue — ดูคิว Walk-in ของสถานี
// ============================================================
/**
 * @swagger
 * /booking/walkin/queue:
 *   get:
 *     tags: [Booking]
 *     summary: ดูคิว Walk-in ของสถานี (จองแบบไม่ระบุเวลา)
 *     parameters:
 *       - in: query
 *         name: station_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: รายการคิว walk-in
 */
router.get('/walkin/queue', (req, res) => {
  const { station_id } = req.query;
  if (!station_id) return res.status(400).json({ success: false, error: 'station_id จำเป็นต้องระบุ' });

  const queue = db.prepare(`
    ${bookingWithDetails}
    WHERE b.station_id = ?
      AND b.booking_date = date('now','localtime')
      AND b.booking_type = 'WALKIN'
      AND (b.status_id IS NULL OR b.status_id = (
        SELECT id FROM station_service_status WHERE code = 'RESERVED' LIMIT 1
      ))
    ORDER BY b.queue_number ASC, b.created_at ASC
  `).all(station_id);

  res.json({ success: true, count: queue.length, queue });
});

// ============================================================
// GET /booking — ดูการจองทั้งหมด
// ============================================================
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

// ============================================================
// GET /booking/pending-notify — ดูรายการที่ยังไม่ได้แจ้งเตือน
// (ต้องอยู่ก่อน /:id เพื่อกัน route conflict)
// ============================================================
/**
 * @swagger
 * /booking/pending-notify:
 *   get:
 *     tags: [Booking]
 *     summary: ดูการจองที่ยังไม่ได้ส่ง notification (pending)
 *     responses:
 *       200:
 *         description: รายการ booking ที่ end_time ผ่านมาแล้วแต่ยังไม่ได้แจ้ง
 */
router.get('/pending-notify', (req, res) => {
  const remind = db.prepare(`
    ${bookingWithDetails}
    WHERE b.notify_remind_sent_at IS NULL
      AND b.booking_date = date('now','localtime')
      AND b.start_time BETWEEN time('now','localtime') AND time('now','localtime','+15 minutes')
    ORDER BY b.booking_date, b.start_time
  `).all();

  const end = db.prepare(`
    ${bookingWithDetails}
    WHERE b.end_time IS NOT NULL
      AND b.notify_end_sent_at IS NULL
      AND (
        b.booking_date < date('now','localtime')
        OR (b.booking_date = date('now','localtime') AND b.end_time <= time('now','localtime'))
      )
    ORDER BY b.booking_date, b.end_time
  `).all();

  res.json({
    success: true,
    pending_remind: { count: remind.length, data: remind },
    pending_end:    { count: end.length,    data: end },
  });
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
 *               booking_type: { type: string, example: SCHEDULED }
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
  const { station_id, vehicle_id, booking_date, start_time, end_time, booking_type, status_id, note, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลการจอง' });

  db.prepare(`
    UPDATE bookings
    SET station_id = COALESCE(?, station_id), vehicle_id = COALESCE(?, vehicle_id),
        booking_date = COALESCE(?, booking_date), start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time), status_id = COALESCE(?, status_id),
        note = COALESCE(?, note), booking_type = COALESCE(?, booking_type),
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(station_id, vehicle_id, booking_date, start_time, end_time, status_id, note, booking_type, username, req.params.id);

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'แก้ไขการจองสำเร็จ', data: item });
});

// ============================================================
// POST /booking/walkin — จองคิว Walk-in (ไม่ระบุเวลา รอเรียกคิว)
// ============================================================
/**
 * @swagger
 * /booking/walkin:
 *   post:
 *     tags: [Booking]
 *     summary: จองคิว Walk-in (ไม่กำหนดเวลา — รอเรียกคิวถัดไป)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, station_id, username]
 *             properties:
 *               user_id:    { type: integer, example: 1 }
 *               station_id: { type: integer, example: 1 }
 *               vehicle_id: { type: integer, example: 1 }
 *               note:       { type: string, example: "มาถึงแล้ว รอคิว" }
 *               username:   { type: string, example: john_doe }
 *     responses:
 *       201:
 *         description: จองคิวสำเร็จ พร้อมหมายเลขคิว
 */
router.post('/walkin', (req, res) => {
  const { user_id, station_id, vehicle_id, note, username } = req.body;
  if (!user_id || !station_id) return res.status(400).json({ success: false, error: 'user_id และ station_id จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  // หาหมายเลขคิวถัดไปของสถานีในวันนี้
  const lastQueue = db.prepare(`
    SELECT MAX(queue_number) as max_q FROM bookings
    WHERE station_id = ? AND booking_date = date('now','localtime') AND booking_type = 'WALKIN'
  `).get(station_id);
  const nextQueue = (lastQueue?.max_q || 0) + 1;

  const reservedStatus = db.prepare("SELECT id FROM station_service_status WHERE code = 'RESERVED'").get();
  const today = new Date().toISOString().substring(0, 10);

  const result = db.prepare(`
    INSERT INTO bookings
      (user_id, station_id, vehicle_id, booking_date, start_time, end_time,
       status_id, note, booking_type, queue_number, created_by, updated_by)
    VALUES (?, ?, ?, ?, 'WALKIN', NULL, ?, ?, 'WALKIN', ?, ?, ?)
  `).run(user_id, station_id, vehicle_id || null, today,
    reservedStatus?.id || null, note || null, nextQueue, username, username);

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({
    success: true,
    message: `จองคิว Walk-in สำเร็จ คิวที่ ${nextQueue}`,
    queue_number: nextQueue,
    data: item,
  });
});

// ============================================================
// PUT /booking/:id/confirm — ยืนยันการจอง
// ============================================================
/**
 * @swagger
 * /booking/{id}/confirm:
 *   put:
 *     tags: [Booking]
 *     summary: ยืนยันการจอง (สถานะ → IN_USE)
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
 *               username: { type: string, example: admin }
 *     responses:
 *       200:
 *         description: ยืนยันสำเร็จ
 */
router.put('/:id/confirm', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id, user_id FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบการจอง' });

  const inUseStatus = db.prepare("SELECT id FROM station_service_status WHERE code = 'IN_USE'").get();
  db.prepare(`
    UPDATE bookings
    SET status_id = ?, updated_at = datetime('now','localtime'), updated_by = ?
    WHERE id = ?
  `).run(inUseStatus?.id || null, username, req.params.id);

  // ส่ง notification แจ้งผู้ใช้ว่าการจองยืนยันแล้ว
  try {
    await notifyBookingManual(req.params.id, 'remind');
  } catch (_) {}

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'ยืนยันการจองสำเร็จ', data: item });
});

// ============================================================
// PUT /booking/:id/cancel — ยกเลิกการจอง
// ============================================================
/**
 * @swagger
 * /booking/{id}/cancel:
 *   put:
 *     tags: [Booking]
 *     summary: ยกเลิกการจอง (สถานะ → OFFLINE / cancelled)
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
 *               reason:   { type: string, example: "ไม่สะดวกเข้าใช้บริการ" }
 *               username: { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: ยกเลิกสำเร็จ
 *       404:
 *         description: ไม่พบการจอง
 */
router.put('/:id/cancel', (req, res) => {
  const { reason, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบการจอง' });

  const offlineStatus = db.prepare("SELECT id FROM station_service_status WHERE code = 'OFFLINE'").get();
  db.prepare(`
    UPDATE bookings
    SET status_id = ?,
        note = COALESCE(?, note),
        updated_at = datetime('now','localtime'),
        updated_by = ?
    WHERE id = ?
  `).run(offlineStatus?.id || null, reason || null, username, req.params.id);

  const item = db.prepare(`${bookingWithDetails} WHERE b.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'ยกเลิกการจองสำเร็จ', data: item });
});

// ============================================================
// POST /booking/:id/notify — manual trigger ส่ง notification ทันที
// ============================================================
/**
 * @swagger
 * /booking/{id}/notify:
 *   post:
 *     tags: [Booking]
 *     summary: ส่ง notification สำหรับการจองทันที (manual trigger)
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
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [remind, end]
 *                 example: end
 *                 description: ประเภท notification (remind=ก่อนถึงเวลา / end=ครบกำหนด)
 *     responses:
 *       200:
 *         description: ส่ง notification สำเร็จ
 *       404:
 *         description: ไม่พบการจอง
 */
router.post('/:id/notify', async (req, res) => {
  const type = req.body?.type || 'end';
  if (!['remind', 'end'].includes(type))
    return res.status(400).json({ success: false, error: 'type ต้องเป็น remind หรือ end' });

  try {
    const result = await notifyBookingManual(req.params.id, type);
    res.json({
      success: true,
      message: `ส่ง notification แบบ "${type}" สำเร็จ`,
      ...result,
    });
  } catch (err) {
    res.status(err.message.includes('ไม่พบ') ? 404 : 500)
      .json({ success: false, error: err.message });
  }
});

module.exports = router;
