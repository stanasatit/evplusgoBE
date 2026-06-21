const express = require('express');
const db = require('../database');
const router = express.Router();

/**
 * @swagger
 * /ev-car:
 *   get:
 *     tags: [Master - EV Car]
 *     summary: ดูรายการรถ EV ทั้งหมด
 *     responses:
 *       200:
 *         description: รายการรถ EV
 */
router.get('/', (req, res) => {
  const cars = db.prepare('SELECT * FROM ev_car_master ORDER BY brand, model').all();
  res.json({ success: true, count: cars.length, data: cars });
});

/**
 * @swagger
 * /ev-car/{id}:
 *   get:
 *     tags: [Master - EV Car]
 *     summary: ดูข้อมูลรถ EV ตาม ID
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
  const car = db.prepare('SELECT * FROM ev_car_master WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลรถ EV' });
  res.json({ success: true, data: car });
});

/**
 * @swagger
 * /ev-car:
 *   post:
 *     tags: [Master - EV Car]
 *     summary: เพิ่มรถ EV ใหม่
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [brand, model, username]
 *             properties:
 *               brand:            { type: string, example: BYD }
 *               model:            { type: string, example: Seal }
 *               year:             { type: integer, example: 2024 }
 *               battery_capacity: { type: number, example: 82.56 }
 *               range_km:         { type: integer, example: 570 }
 *               charge_type:      { type: string, example: AC/DC }
 *               image_car_url:     { type: string, example: "https://example.com/car.png", description: รูปรถ EV (optional) }
 *               username:         { type: string, example: admin }
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
router.post('/', (req, res) => {
  const { brand, model, year, battery_capacity, range_km, charge_type, image_car_url, username } = req.body;
  if (!brand || !model) return res.status(400).json({ success: false, error: 'brand และ model จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO ev_car_master (brand, model, year, battery_capacity, range_km, charge_type, image_car_url, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(brand, model, year || null, battery_capacity || null, range_km || null, charge_type || null, image_car_url || null, username, username);

  const car = db.prepare('SELECT * FROM ev_car_master WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'เพิ่มรถ EV สำเร็จ', data: car });
});

/**
 * @swagger
 * /ev-car/{id}:
 *   put:
 *     tags: [Master - EV Car]
 *     summary: แก้ไขข้อมูลรถ EV
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
 *               brand:            { type: string }
 *               model:            { type: string }
 *               year:             { type: integer }
 *               battery_capacity: { type: number }
 *               range_km:         { type: integer }
 *               charge_type:      { type: string }
 *               image_car_url:     { type: string, description: รูปรถ EV (optional) }
 *               username:         { type: string, example: admin }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const { brand, model, year, battery_capacity, range_km, charge_type, image_car_url, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM ev_car_master WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลรถ EV' });

  db.prepare(`
    UPDATE ev_car_master
    SET brand = COALESCE(?, brand), model = COALESCE(?, model), year = COALESCE(?, year),
        battery_capacity = COALESCE(?, battery_capacity), range_km = COALESCE(?, range_km),
        charge_type = COALESCE(?, charge_type), image_car_url = COALESCE(?, image_car_url),
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(brand, model, year, battery_capacity, range_km, charge_type, image_car_url, username, req.params.id);

  const car = db.prepare('SELECT * FROM ev_car_master WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'แก้ไขข้อมูลรถ EV สำเร็จ', data: car });
});

module.exports = router;
