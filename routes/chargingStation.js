const express = require('express');
const db = require('../database');
const router = express.Router();

const stationWithStatus = `
  SELECT cs.*, sss.code AS status_code, sss.name AS status_name
  FROM charging_stations cs
  LEFT JOIN station_service_status sss ON cs.status_id = sss.id
`;

/**
 * @swagger
 * /charging-station:
 *   get:
 *     tags: [Charging Station]
 *     summary: ดูสถานีชาร์จทั้งหมด
 *     parameters:
 *       - in: query
 *         name: provider_code
 *         schema: { type: string }
 *         description: กรองตาม provider (เช่น PEA_VOLTA, EA_ANYWHERE)
 *       - in: query
 *         name: charge_type
 *         schema: { type: string }
 *         description: กรองตามประเภทชาร์จ (AC, DC, AC/DC)
 *       - in: query
 *         name: pricing_model
 *         schema: { type: string }
 *         description: กรองตามรูปแบบคิดราคา (kWh, time)
 *     responses:
 *       200:
 *         description: รายการสถานีชาร์จ
 */
router.get('/', (req, res) => {
  const { provider_code, charge_type, pricing_model } = req.query;
  let sql = `${stationWithStatus}`;
  const params = [];
  const conditions = [];

  if (provider_code)  { conditions.push('cs.provider_code = ?');  params.push(provider_code); }
  if (charge_type)    { conditions.push('cs.charge_type = ?');    params.push(charge_type); }
  if (pricing_model)  { conditions.push('cs.pricing_model = ?');  params.push(pricing_model); }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY cs.id';

  const list = db.prepare(sql).all(...params);
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /charging-station/{id}:
 *   get:
 *     tags: [Charging Station]
 *     summary: ดูสถานีชาร์จตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ข้อมูลสถานีชาร์จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare(`${stationWithStatus} WHERE cs.id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบสถานีชาร์จ' });
  res.json({ success: true, data: item });
});

/**
 * @swagger
 * /charging-station:
 *   post:
 *     tags: [Charging Station]
 *     summary: เพิ่มสถานีชาร์จใหม่
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, lat, long, username]
 *             properties:
 *               name:           { type: string, example: "PEA VOLTA สาขา CentralWorld" }
 *               address:        { type: string, example: "ถ.ราชดำริ แขวงลุมพินี กทม." }
 *               lat:            { type: number, example: 13.7466 }
 *               long:           { type: number, example: 100.5395 }
 *               total_chargers: { type: integer, example: 4 }
 *               status_id:      { type: integer, example: 1, description: "FK → station_service_status" }
 *               provider_code:  { type: string, example: "PEA_VOLTA", description: "รหัสผู้ให้บริการ" }
 *               provider_name:  { type: string, example: "PEA VOLTA" }
 *               charge_type:    { type: string, example: "DC", description: "AC / DC / AC/DC" }
 *               power_min_kw:   { type: number, example: 50, description: "กำลังไฟขั้นต่ำ (kW)" }
 *               power_max_kw:   { type: number, example: 180, description: "กำลังไฟสูงสุด (kW)" }
 *               pricing_model:  { type: string, example: "kWh", description: "kWh หรือ time" }
 *               price_peak:     { type: number, example: 6.90, description: "ราคาช่วง Peak (THB/kWh)" }
 *               price_offpeak:  { type: number, example: 5.90, description: "ราคาช่วง Off-Peak (THB/kWh)" }
 *               idle_fee:       { type: number, example: 80, description: "ค่าบริการตามชั่วโมง (THB/hr) สำหรับ pricing_model=time" }
 *               username:       { type: string, example: admin }
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
router.post('/', (req, res) => {
  const {
    name, address, lat, long, total_chargers, status_id,
    provider_code, provider_name, charge_type,
    power_min_kw, power_max_kw, pricing_model,
    price_peak, price_offpeak, idle_fee,
    username,
  } = req.body;

  if (!name) return res.status(400).json({ success: false, error: 'name จำเป็นต้องระบุ' });
  if (lat == null || long == null) return res.status(400).json({ success: false, error: 'lat และ long จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO charging_stations
      (name, address, lat, long, total_chargers, status_id,
       provider_code, provider_name, charge_type,
       power_min_kw, power_max_kw, pricing_model,
       price_peak, price_offpeak, idle_fee,
       created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, address || null, lat, long, total_chargers || 1, status_id || null,
    provider_code || null, provider_name || null, charge_type || null,
    power_min_kw || null, power_max_kw || null, pricing_model || null,
    price_peak || null, price_offpeak || null, idle_fee || null,
    username, username,
  );

  const item = db.prepare(`${stationWithStatus} WHERE cs.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'เพิ่มสถานีชาร์จสำเร็จ', data: item });
});

/**
 * @swagger
 * /charging-station/{id}:
 *   put:
 *     tags: [Charging Station]
 *     summary: แก้ไขข้อมูลสถานีชาร์จ
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
 *               name:           { type: string }
 *               address:        { type: string }
 *               lat:            { type: number }
 *               long:           { type: number }
 *               total_chargers: { type: integer }
 *               status_id:      { type: integer }
 *               provider_code:  { type: string }
 *               provider_name:  { type: string }
 *               charge_type:    { type: string, description: "AC / DC / AC/DC" }
 *               power_min_kw:   { type: number }
 *               power_max_kw:   { type: number }
 *               pricing_model:  { type: string, description: "kWh หรือ time" }
 *               price_peak:     { type: number }
 *               price_offpeak:  { type: number }
 *               idle_fee:       { type: number }
 *               username:       { type: string, example: admin }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const {
    name, address, lat, long, total_chargers, status_id,
    provider_code, provider_name, charge_type,
    power_min_kw, power_max_kw, pricing_model,
    price_peak, price_offpeak, idle_fee,
    username,
  } = req.body;

  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM charging_stations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบสถานีชาร์จ' });

  db.prepare(`
    UPDATE charging_stations
    SET name           = COALESCE(?, name),
        address        = COALESCE(?, address),
        lat            = COALESCE(?, lat),
        long           = COALESCE(?, long),
        total_chargers = COALESCE(?, total_chargers),
        status_id      = COALESCE(?, status_id),
        provider_code  = COALESCE(?, provider_code),
        provider_name  = COALESCE(?, provider_name),
        charge_type    = COALESCE(?, charge_type),
        power_min_kw   = COALESCE(?, power_min_kw),
        power_max_kw   = COALESCE(?, power_max_kw),
        pricing_model  = COALESCE(?, pricing_model),
        price_peak     = COALESCE(?, price_peak),
        price_offpeak  = COALESCE(?, price_offpeak),
        idle_fee       = COALESCE(?, idle_fee),
        updated_at     = datetime('now', 'localtime'),
        updated_by     = ?
    WHERE id = ?
  `).run(
    name, address, lat, long, total_chargers, status_id,
    provider_code, provider_name, charge_type,
    power_min_kw, power_max_kw, pricing_model,
    price_peak, price_offpeak, idle_fee,
    username, req.params.id,
  );

  const item = db.prepare(`${stationWithStatus} WHERE cs.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'แก้ไขสถานีชาร์จสำเร็จ', data: item });
});

module.exports = router;
