const express = require('express');
const db = require('../database');
const router = express.Router();

/**
 * @swagger
 * /user-vehicle:
 *   get:
 *     tags: [User Vehicle]
 *     summary: ดูรถ EV ของผู้ใช้ทั้งหมด
 *     responses:
 *       200:
 *         description: รายการรถ EV ของผู้ใช้
 */
router.get('/', (req, res) => {
  const list = db.prepare(`
    SELECT uv.*, u.username, ec.brand, ec.model, ec.year, ec.battery_capacity, ec.range_km, ec.charge_type
    FROM user_vehicles uv
    LEFT JOIN users u ON uv.user_id = u.id
    LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
    ORDER BY uv.id
  `).all();
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /user-vehicle/user/{user_id}:
 *   get:
 *     tags: [User Vehicle]
 *     summary: ดูรถ EV ของผู้ใช้ตาม user_id
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: รายการรถ EV ของผู้ใช้
 */
router.get('/user/:user_id', (req, res) => {
  const list = db.prepare(`
    SELECT uv.*, ec.brand, ec.model, ec.year, ec.battery_capacity, ec.range_km, ec.charge_type
    FROM user_vehicles uv
    LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
    WHERE uv.user_id = ?
    ORDER BY uv.id
  `).all(req.params.user_id);
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /user-vehicle/{id}:
 *   get:
 *     tags: [User Vehicle]
 *     summary: ดูรถ EV ตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ข้อมูลรถ EV
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare(`
    SELECT uv.*, u.username, ec.brand, ec.model, ec.year, ec.battery_capacity, ec.range_km, ec.charge_type
    FROM user_vehicles uv
    LEFT JOIN users u ON uv.user_id = u.id
    LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
    WHERE uv.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลรถ EV' });
  res.json({ success: true, data: item });
});

/**
 * @swagger
 * /user-vehicle:
 *   post:
 *     tags: [User Vehicle]
 *     summary: เพิ่มรถ EV ให้ผู้ใช้
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, username]
 *             properties:
 *               user_id:       { type: integer, example: 1 }
 *               ev_car_id:     { type: integer, example: 1 }
 *               license_plate: { type: string, example: กข 1234 }
 *               color:         { type: string, example: สีขาว }
 *               nickname:      { type: string, example: รถคันโปรด }
 *               username:      { type: string, example: john_doe }
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
router.post('/', (req, res) => {
  const { user_id, ev_car_id, license_plate, color, nickname, username } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO user_vehicles (user_id, ev_car_id, license_plate, color, nickname, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user_id, ev_car_id || null, license_plate || null, color || null, nickname || null, username, username);

  const item = db.prepare(`
    SELECT uv.*, ec.brand, ec.model, ec.year
    FROM user_vehicles uv
    LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
    WHERE uv.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'เพิ่มรถ EV สำเร็จ', data: item });
});

/**
 * @swagger
 * /user-vehicle/{id}:
 *   put:
 *     tags: [User Vehicle]
 *     summary: แก้ไขข้อมูลรถ EV ของผู้ใช้
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
 *               ev_car_id:     { type: integer }
 *               license_plate: { type: string }
 *               color:         { type: string }
 *               nickname:      { type: string }
 *               username:      { type: string, example: john_doe }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const { ev_car_id, license_plate, color, nickname, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM user_vehicles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลรถ EV' });

  db.prepare(`
    UPDATE user_vehicles
    SET ev_car_id = COALESCE(?, ev_car_id), license_plate = COALESCE(?, license_plate),
        color = COALESCE(?, color), nickname = COALESCE(?, nickname),
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(ev_car_id, license_plate, color, nickname, username, req.params.id);

  const item = db.prepare(`
    SELECT uv.*, ec.brand, ec.model, ec.year
    FROM user_vehicles uv
    LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
    WHERE uv.id = ?
  `).get(req.params.id);
  res.json({ success: true, message: 'แก้ไขข้อมูลรถ EV สำเร็จ', data: item });
});

/**
 * @swagger
 * /user-vehicle/{id}:
 *   delete:
 *     tags: [User Vehicle]
 *     summary: ลบข้อมูลรถ EV ตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: ID ของรถ EV ที่ต้องการลบ
 *     responses:
 *       200:
 *         description: ลบสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM user_vehicles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลรถ EV' });

  db.prepare('DELETE FROM user_vehicles WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'ลบข้อมูลรถ EV สำเร็จ' });
});

module.exports = router;
