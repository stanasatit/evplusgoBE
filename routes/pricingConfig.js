const express = require('express');
const db = require('../database');
const router = express.Router();

const pricingWithStation = `
  SELECT pc.*, cs.name AS station_name
  FROM pricing_config pc
  LEFT JOIN charging_stations cs ON pc.station_id = cs.id
`;

// ============================================================
// GET /pricing-config — ดูทั้งหมด
// ============================================================
/**
 * @swagger
 * /pricing-config:
 *   get:
 *     tags: [Pricing Config]
 *     summary: ดูอัตราค่าบริการทั้งหมด
 *     responses:
 *       200:
 *         description: รายการอัตราค่าบริการ
 */
router.get('/', (req, res) => {
  const list = db.prepare(`${pricingWithStation} ORDER BY pc.station_id, pc.effective_from DESC`).all();
  res.json({ success: true, count: list.length, data: list });
});

// ============================================================
// GET /pricing-config/active — ดูเฉพาะที่ใช้งานอยู่
// ============================================================
/**
 * @swagger
 * /pricing-config/active:
 *   get:
 *     tags: [Pricing Config]
 *     summary: ดูอัตราค่าบริการที่ใช้งานอยู่ปัจจุบัน
 *     responses:
 *       200:
 *         description: รายการอัตราค่าบริการที่ active
 */
router.get('/active', (req, res) => {
  const list = db.prepare(`
    ${pricingWithStation}
    WHERE pc.is_active = 1
      AND pc.effective_from <= date('now', 'localtime')
      AND (pc.effective_to IS NULL OR pc.effective_to >= date('now', 'localtime'))
    ORDER BY pc.station_id
  `).all();
  res.json({ success: true, count: list.length, data: list });
});

// ============================================================
// GET /pricing-config/station/:station_id — ดูตาม station
// ============================================================
/**
 * @swagger
 * /pricing-config/station/{station_id}:
 *   get:
 *     tags: [Pricing Config]
 *     summary: ดูอัตราค่าบริการของสถานีที่ระบุ (ถ้าไม่มีจะใช้อัตรามาตรฐาน)
 *     parameters:
 *       - in: path
 *         name: station_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: อัตราค่าบริการที่ใช้งานของสถานี
 */
router.get('/station/:station_id', (req, res) => {
  // หาอัตราของสถานีก่อน ถ้าไม่มีใช้ global (station_id IS NULL)
  let pricing = db.prepare(`
    ${pricingWithStation}
    WHERE pc.is_active = 1
      AND pc.station_id = ?
      AND pc.effective_from <= date('now', 'localtime')
      AND (pc.effective_to IS NULL OR pc.effective_to >= date('now', 'localtime'))
    ORDER BY pc.effective_from DESC LIMIT 1
  `).get(req.params.station_id);

  if (!pricing) {
    pricing = db.prepare(`
      ${pricingWithStation}
      WHERE pc.is_active = 1 AND pc.station_id IS NULL
        AND pc.effective_from <= date('now', 'localtime')
        AND (pc.effective_to IS NULL OR pc.effective_to >= date('now', 'localtime'))
      ORDER BY pc.effective_from DESC LIMIT 1
    `).get();
  }

  if (!pricing) return res.status(404).json({ success: false, error: 'ไม่พบอัตราค่าบริการที่ใช้งานอยู่' });
  res.json({ success: true, is_global: !pricing.station_id, data: pricing });
});

// ============================================================
// GET /pricing-config/:id — ดูตาม ID
// ============================================================
/**
 * @swagger
 * /pricing-config/{id}:
 *   get:
 *     tags: [Pricing Config]
 *     summary: ดูอัตราค่าบริการตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ข้อมูลอัตราค่าบริการ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare(`${pricingWithStation} WHERE pc.id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลอัตราค่าบริการ' });
  res.json({ success: true, data: item });
});

// ============================================================
// POST /pricing-config — เพิ่มอัตราค่าบริการใหม่
// ============================================================
/**
 * @swagger
 * /pricing-config:
 *   post:
 *     tags: [Pricing Config]
 *     summary: เพิ่มอัตราค่าบริการใหม่
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, rate_per_kwh, effective_from, username]
 *             properties:
 *               station_id:     { type: integer, example: 1, description: ถ้าไม่ระบุ = อัตรามาตรฐานทั่วไป }
 *               name:           { type: string, example: "อัตราพิเศษสาขาสีลม" }
 *               rate_per_kwh:   { type: number, example: 6.5, description: ราคาต่อ kWh (บาท) }
 *               service_fee:    { type: number, example: 10.0, description: ค่าบริการคงที่ต่อครั้ง (บาท) }
 *               min_charge_fee: { type: number, example: 20.0, description: ค่าบริการขั้นต่ำ (บาท) }
 *               vat_percent:    { type: number, example: 7, description: VAT (%) }
 *               effective_from: { type: string, example: "2026-07-01" }
 *               effective_to:   { type: string, example: "2026-12-31", description: วันสิ้นสุด (optional) }
 *               is_active:      { type: integer, example: 1 }
 *               note:           { type: string, example: อัตราพิเศษช่วงโปรโมชั่น }
 *               username:       { type: string, example: admin }
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
router.post('/', (req, res) => {
  const { station_id, name, rate_per_kwh, service_fee, min_charge_fee, vat_percent, effective_from, effective_to, is_active, note, username } = req.body;

  if (!name) return res.status(400).json({ success: false, error: 'name จำเป็นต้องระบุ' });
  if (rate_per_kwh == null) return res.status(400).json({ success: false, error: 'rate_per_kwh จำเป็นต้องระบุ' });
  if (!effective_from) return res.status(400).json({ success: false, error: 'effective_from จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const result = db.prepare(`
    INSERT INTO pricing_config
      (station_id, name, rate_per_kwh, service_fee, min_charge_fee, vat_percent, effective_from, effective_to, is_active, note, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    station_id    || null,
    name,
    rate_per_kwh,
    service_fee   || 0,
    min_charge_fee|| 0,
    vat_percent   ?? 7,
    effective_from,
    effective_to  || null,
    is_active     ?? 1,
    note          || null,
    username,
    username,
  );

  const item = db.prepare(`${pricingWithStation} WHERE pc.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'เพิ่มอัตราค่าบริการสำเร็จ', data: item });
});

// ============================================================
// PUT /pricing-config/:id — แก้ไขอัตราค่าบริการ
// ============================================================
/**
 * @swagger
 * /pricing-config/{id}:
 *   put:
 *     tags: [Pricing Config]
 *     summary: แก้ไขอัตราค่าบริการ
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
 *               rate_per_kwh:   { type: number }
 *               service_fee:    { type: number }
 *               min_charge_fee: { type: number }
 *               vat_percent:    { type: number }
 *               effective_from: { type: string }
 *               effective_to:   { type: string }
 *               is_active:      { type: integer, enum: [0, 1] }
 *               note:           { type: string }
 *               username:       { type: string, example: admin }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const { name, rate_per_kwh, service_fee, min_charge_fee, vat_percent, effective_from, effective_to, is_active, note, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM pricing_config WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลอัตราค่าบริการ' });

  db.prepare(`
    UPDATE pricing_config
    SET name           = COALESCE(?, name),
        rate_per_kwh   = COALESCE(?, rate_per_kwh),
        service_fee    = COALESCE(?, service_fee),
        min_charge_fee = COALESCE(?, min_charge_fee),
        vat_percent    = COALESCE(?, vat_percent),
        effective_from = COALESCE(?, effective_from),
        effective_to   = COALESCE(?, effective_to),
        is_active      = COALESCE(?, is_active),
        note           = COALESCE(?, note),
        updated_at     = datetime('now', 'localtime'),
        updated_by     = ?
    WHERE id = ?
  `).run(name, rate_per_kwh, service_fee, min_charge_fee, vat_percent, effective_from, effective_to, is_active, note, username, req.params.id);

  const item = db.prepare(`${pricingWithStation} WHERE pc.id = ?`).get(req.params.id);
  res.json({ success: true, message: 'แก้ไขอัตราค่าบริการสำเร็จ', data: item });
});

// ============================================================
// GET /pricing-config/calculate/:station_id — คำนวณค่าบริการ
// ============================================================
/**
 * @swagger
 * /pricing-config/calculate/{station_id}:
 *   post:
 *     tags: [Pricing Config]
 *     summary: คำนวณค่าบริการจาก kWh ที่ใช้
 *     parameters:
 *       - in: path
 *         name: station_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [energy_kwh]
 *             properties:
 *               energy_kwh: { type: number, example: 25.5 }
 *               discount:   { type: number, example: 5.0 }
 *     responses:
 *       200:
 *         description: ผลการคำนวณค่าบริการ
 */
router.post('/calculate/:station_id', (req, res) => {
  const { energy_kwh, discount } = req.body;
  if (energy_kwh == null) return res.status(400).json({ success: false, error: 'energy_kwh จำเป็นต้องระบุ' });

  let pricing = db.prepare(`
    SELECT * FROM pricing_config
    WHERE is_active = 1 AND station_id = ?
      AND effective_from <= date('now', 'localtime')
      AND (effective_to IS NULL OR effective_to >= date('now', 'localtime'))
    ORDER BY effective_from DESC LIMIT 1
  `).get(req.params.station_id);

  if (!pricing) {
    pricing = db.prepare(`
      SELECT * FROM pricing_config
      WHERE is_active = 1 AND station_id IS NULL
        AND effective_from <= date('now', 'localtime')
        AND (effective_to IS NULL OR effective_to >= date('now', 'localtime'))
      ORDER BY effective_from DESC LIMIT 1
    `).get();
  }

  if (!pricing) return res.status(404).json({ success: false, error: 'ไม่พบอัตราค่าบริการที่ใช้งานอยู่' });

  const disc       = discount || 0;
  const energy_cost = energy_kwh * pricing.rate_per_kwh;
  const subtotal   = energy_cost + pricing.service_fee;
  const after_disc = Math.max(subtotal - disc, pricing.min_charge_fee);
  const vat        = after_disc * (pricing.vat_percent / 100);
  const total      = after_disc + vat;

  res.json({
    success: true,
    pricing_name: pricing.name,
    is_global: !pricing.station_id,
    breakdown: {
      energy_kwh,
      rate_per_kwh:   pricing.rate_per_kwh,
      energy_cost:    +energy_cost.toFixed(2),
      service_fee:    pricing.service_fee,
      subtotal:       +subtotal.toFixed(2),
      discount:       disc,
      min_charge_fee: pricing.min_charge_fee,
      after_discount: +after_disc.toFixed(2),
      vat_percent:    pricing.vat_percent,
      vat_amount:     +vat.toFixed(2),
      total_amount:   +total.toFixed(2),
    },
  });
});

module.exports = router;
