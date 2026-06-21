const express = require('express');
const db = require('../database');
const router = express.Router();

// ============================================================
// Peak / Off-Peak ตามมาตรฐาน PEA Thailand
//   Peak    : จันทร์-เสาร์  09:00–22:00
//   Off-Peak: จันทร์-เสาร์  22:00–09:00  และ อาทิตย์ทั้งวัน
// ============================================================
function getPeriod(datetime) {
  const d = datetime ? new Date(datetime.replace(' ', 'T')) : new Date();
  const day  = d.getDay();   // 0=อาทิตย์
  const hour = d.getHours();
  if (day === 0) return 'OFF_PEAK';
  return (hour >= 9 && hour < 22) ? 'PEAK' : 'OFF_PEAK';
}

// ดึง pricing_config ที่ active ของสถานี (fallback → global)
function getActivePricing(station_id) {
  const byStation = db.prepare(`
    SELECT * FROM pricing_config
    WHERE is_active = 1 AND station_id = ?
      AND effective_from <= date('now','localtime')
      AND (effective_to IS NULL OR effective_to >= date('now','localtime'))
    ORDER BY effective_from DESC LIMIT 1
  `).get(station_id);

  return byStation || db.prepare(`
    SELECT * FROM pricing_config
    WHERE is_active = 1 AND station_id IS NULL
      AND effective_from <= date('now','localtime')
      AND (effective_to IS NULL OR effective_to >= date('now','localtime'))
    ORDER BY effective_from DESC LIMIT 1
  `).get();
}

// คำนวณยอดสุดท้าย
function calcTotal(chargeCost, serviceFee, discount, minChargeFee, vatPercent) {
  const subtotal      = chargeCost + serviceFee;
  const afterDiscount = Math.max(subtotal - discount, minChargeFee);
  const vatAmount     = afterDiscount * (vatPercent / 100);
  const totalAmount   = afterDiscount + vatAmount;
  return { subtotal, afterDiscount, vatAmount, totalAmount };
}

// ============================================================
// GET /charging-fee/peak-hours — แสดงช่วงเวลา Peak / Off-Peak
// ============================================================
/**
 * @swagger
 * /charging-fee/peak-hours:
 *   get:
 *     tags: [Charging Fee]
 *     summary: แสดงตารางช่วงเวลา Peak และ Off-Peak (มาตรฐาน PEA Thailand)
 *     responses:
 *       200:
 *         description: ตารางช่วงเวลา Peak/Off-Peak
 */
router.get('/peak-hours', (req, res) => {
  const now = new Date();
  res.json({
    success: true,
    standard: 'PEA Thailand',
    current_period: getPeriod(),
    current_time: now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    schedule: {
      PEAK:     'จันทร์ – เสาร์  เวลา 09:00 – 22:00 น.',
      OFF_PEAK: 'จันทร์ – เสาร์  เวลา 22:00 – 09:00 น. / อาทิตย์ทั้งวัน',
    },
  });
});

// ============================================================
// POST /charging-fee/calculate — คำนวณค่าบริการหลัก
// ============================================================
/**
 * @swagger
 * /charging-fee/calculate:
 *   post:
 *     tags: [Charging Fee]
 *     summary: คำนวณค่าบริการชาร์จ (รองรับ kWh และ time-based)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [station_id]
 *             properties:
 *               station_id:
 *                 type: integer
 *                 example: 1
 *               energy_kwh:
 *                 type: number
 *                 example: 30.5
 *                 description: พลังงานที่ใช้ (kWh) — required สำหรับ pricing_model=kWh
 *               duration_minutes:
 *                 type: number
 *                 example: 90
 *                 description: เวลาชาร์จ (นาที) — required สำหรับ pricing_model=time
 *               start_datetime:
 *                 type: string
 *                 example: "2026-06-23 10:00:00"
 *                 description: เวลาเริ่มชาร์จ (ใช้คำนวณ Peak/Off-Peak) ถ้าไม่ระบุ = ปัจจุบัน
 *               discount:
 *                 type: number
 *                 example: 10.0
 *                 description: ส่วนลด (บาท)
 *     responses:
 *       200:
 *         description: ผลการคำนวณค่าบริการพร้อม breakdown
 *       400:
 *         description: ข้อมูลไม่ครบ
 *       404:
 *         description: ไม่พบสถานี
 */
router.post('/calculate', (req, res) => {
  const { station_id, energy_kwh, duration_minutes, start_datetime, discount } = req.body;
  if (!station_id) return res.status(400).json({ success: false, error: 'station_id จำเป็นต้องระบุ' });

  const station = db.prepare(`
    SELECT cs.*, sss.code AS status_code, sss.name AS status_name
    FROM charging_stations cs
    LEFT JOIN station_service_status sss ON cs.status_id = sss.id
    WHERE cs.id = ?
  `).get(station_id);
  if (!station) return res.status(404).json({ success: false, error: 'ไม่พบสถานีชาร์จ' });

  const pricing       = getActivePricing(station_id);
  const pricingModel  = station.pricing_model || 'kWh';
  const period        = getPeriod(start_datetime);
  const disc          = discount || 0;
  const serviceFee    = pricing?.service_fee    || 0;
  const minChargeFee  = pricing?.min_charge_fee || 0;
  const vatPercent    = pricing?.vat_percent     ?? 7;

  let chargeCost = 0;
  let chargeBreakdown = {};

  if (pricingModel === 'kWh') {
    if (energy_kwh == null)
      return res.status(400).json({ success: false, error: 'energy_kwh จำเป็นต้องระบุสำหรับ pricing_model=kWh' });

    const rate = period === 'PEAK' ? station.price_peak : station.price_offpeak;
    if (!rate)
      return res.status(422).json({ success: false, error: `สถานีนี้ไม่มีราคา ${period} กำหนดไว้` });

    chargeCost = energy_kwh * rate;
    chargeBreakdown = {
      energy_kwh,
      rate_per_kwh: rate,
      price_peak:     station.price_peak,
      price_offpeak:  station.price_offpeak,
      energy_cost:    +chargeCost.toFixed(2),
    };
  } else {
    // time-based
    if (duration_minutes == null)
      return res.status(400).json({ success: false, error: 'duration_minutes จำเป็นต้องระบุสำหรับ pricing_model=time' });

    if (!station.idle_fee)
      return res.status(422).json({ success: false, error: 'สถานีนี้ไม่มี idle_fee กำหนดไว้' });

    const billedHours = Math.ceil(duration_minutes / 60);
    chargeCost = billedHours * station.idle_fee;
    chargeBreakdown = {
      duration_minutes,
      duration_hours:     +(duration_minutes / 60).toFixed(2),
      billed_hours:       billedHours,
      idle_fee_per_hour:  station.idle_fee,
      charge_cost:        +chargeCost.toFixed(2),
    };
  }

  const { subtotal, afterDiscount, vatAmount, totalAmount } = calcTotal(
    chargeCost, serviceFee, disc, minChargeFee, vatPercent
  );

  res.json({
    success: true,
    station: {
      id:            station.id,
      name:          station.name,
      provider_name: station.provider_name,
      charge_type:   station.charge_type,
      pricing_model: pricingModel,
      status:        station.status_name,
    },
    pricing_config: pricing
      ? { name: pricing.name, is_global: !pricing.station_id }
      : null,
    period,
    breakdown: {
      pricing_model: pricingModel,
      ...chargeBreakdown,
      service_fee:    serviceFee,
      subtotal:       +subtotal.toFixed(2),
      discount:       disc,
      min_charge_fee: minChargeFee,
      after_discount: +afterDiscount.toFixed(2),
      vat_percent:    vatPercent,
      vat_amount:     +vatAmount.toFixed(2),
      total_amount:   +totalAmount.toFixed(2),
    },
  });
});

// ============================================================
// POST /charging-fee/estimate — ประมาณค่าใช้จ่ายจากแบตฯ ที่ต้องการชาร์จ
//   รองรับ 3 แบบ (ตาม flow หน้าแอป):
//   1. vehicle_id  → รถที่ลงทะเบียนของผู้ใช้ (user_vehicles → ev_car_master)
//   2. ev_car_id   → เลือกรุ่นรถจาก master โดยตรง (สำหรับ quick estimate ก่อนสมัคร)
//   3. battery_capacity_kwh → ระบุความจุเองโดยตรง
// ============================================================
/**
 * @swagger
 * /charging-fee/estimate:
 *   post:
 *     tags: [Charging Fee]
 *     summary: ประมาณค่าใช้จ่ายและเวลาชาร์จ (เลือกรุ่นรถ + สถานี + วันเวลา)
 *     description: |
 *       **Flow หน้าแอป:** ผู้ใช้เลือกรุ่นรถ, สถานีที่บริการ, วันเวลาที่ต้องการเข้าใช้
 *       ระบบคำนวณประมาณค่าบริการและเวลาที่ใช้ชาร์จ
 *
 *       **ลำดับความสำคัญของแหล่งข้อมูลรถ:**
 *       1. `vehicle_id` — รถที่ลงทะเบียนของผู้ใช้ (ดึง battery_capacity อัตโนมัติ)
 *       2. `ev_car_id` — เลือกรุ่นรถจาก master list (สำหรับ quick estimate)
 *       3. `battery_capacity_kwh` — ระบุความจุเองโดยตรง
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [station_id, current_percent, target_percent]
 *             properties:
 *               station_id:
 *                 type: integer
 *                 example: 1
 *                 description: สถานีที่ต้องการเข้าใช้บริการ
 *               vehicle_id:
 *                 type: integer
 *                 example: 1
 *                 description: "[ตัวเลือก 1] ID รถที่ลงทะเบียนของผู้ใช้ (user_vehicles)"
 *               ev_car_id:
 *                 type: integer
 *                 example: 1
 *                 description: "[ตัวเลือก 2] ID รุ่นรถจาก master (ev_car_master)"
 *               battery_capacity_kwh:
 *                 type: number
 *                 example: 75.0
 *                 description: "[ตัวเลือก 3] ความจุแบตเตอรี่ (kWh) — ระบุเองโดยตรง"
 *               current_percent:
 *                 type: number
 *                 example: 20
 *                 description: ระดับแบตปัจจุบัน (%)
 *               target_percent:
 *                 type: number
 *                 example: 80
 *                 description: ระดับแบตที่ต้องการ (%)
 *               charge_efficiency:
 *                 type: number
 *                 example: 0.9
 *                 description: ประสิทธิภาพการชาร์จ 0.0–1.0 (default 0.9)
 *               start_datetime:
 *                 type: string
 *                 example: "2026-06-23 10:00:00"
 *                 description: วันเวลาที่ต้องการเข้าใช้บริการ (ใช้คำนวณ Peak/Off-Peak)
 *               discount:
 *                 type: number
 *                 example: 0
 *     responses:
 *       200:
 *         description: ผลการประมาณค่าใช้จ่ายและเวลาชาร์จ
 *       400:
 *         description: ข้อมูลไม่ครบหรือไม่ถูกต้อง
 *       404:
 *         description: ไม่พบสถานีหรือรถ
 */
router.post('/estimate', (req, res) => {
  const {
    station_id,
    vehicle_id,
    ev_car_id,
    battery_capacity_kwh: manualCapacity,
    current_percent,
    target_percent,
    charge_efficiency = 0.9,
    start_datetime,
    discount,
  } = req.body;

  if (!station_id)
    return res.status(400).json({ success: false, error: 'station_id จำเป็นต้องระบุ' });
  if (current_percent == null || target_percent == null)
    return res.status(400).json({ success: false, error: 'current_percent และ target_percent จำเป็นต้องระบุ' });
  if (!vehicle_id && !ev_car_id && manualCapacity == null)
    return res.status(400).json({ success: false, error: 'ต้องระบุ vehicle_id, ev_car_id หรือ battery_capacity_kwh อย่างน้อยหนึ่งอย่าง' });
  if (current_percent >= target_percent)
    return res.status(400).json({ success: false, error: 'target_percent ต้องมากกว่า current_percent' });
  if (current_percent < 0 || target_percent > 100)
    return res.status(400).json({ success: false, error: 'ระดับแบตต้องอยู่ระหว่าง 0–100' });

  let vehicleInfo = null;
  let battery_capacity_kwh = manualCapacity;

  if (vehicle_id) {
    // แบบที่ 1: รถที่ลงทะเบียนของผู้ใช้
    const vehicle = db.prepare(`
      SELECT uv.id, uv.license_plate, uv.color, uv.nickname,
             ec.brand, ec.model, ec.year, ec.battery_capacity, ec.range_km,
             ec.charge_type AS car_charge_type, ec.image_car_url
      FROM user_vehicles uv
      LEFT JOIN ev_car_master ec ON uv.ev_car_id = ec.id
      WHERE uv.id = ?
    `).get(vehicle_id);

    if (!vehicle)
      return res.status(404).json({ success: false, error: 'ไม่พบรถที่ระบุ (vehicle_id)' });
    if (!vehicle.battery_capacity)
      return res.status(422).json({ success: false, error: `ไม่มีข้อมูลความจุแบตของรถ ${vehicle.brand} ${vehicle.model}` });

    battery_capacity_kwh = vehicle.battery_capacity;
    vehicleInfo = {
      source:        'user_vehicle',
      id:            vehicle.id,
      brand:         vehicle.brand,
      model:         vehicle.model,
      year:          vehicle.year,
      license_plate: vehicle.license_plate,
      nickname:      vehicle.nickname,
      battery_capacity_kwh: vehicle.battery_capacity,
      range_km:      vehicle.range_km,
      image_car_url: vehicle.image_car_url,
    };
  } else if (ev_car_id) {
    // แบบที่ 2: เลือกรุ่นรถจาก master (quick estimate)
    const car = db.prepare(`SELECT * FROM ev_car_master WHERE id = ?`).get(ev_car_id);

    if (!car)
      return res.status(404).json({ success: false, error: 'ไม่พบรุ่นรถที่ระบุ (ev_car_id)' });
    if (!car.battery_capacity)
      return res.status(422).json({ success: false, error: `ไม่มีข้อมูลความจุแบตของรถ ${car.brand} ${car.model}` });

    battery_capacity_kwh = car.battery_capacity;
    vehicleInfo = {
      source:        'ev_car_master',
      ev_car_id:     car.id,
      brand:         car.brand,
      model:         car.model,
      year:          car.year,
      battery_capacity_kwh: car.battery_capacity,
      range_km:      car.range_km,
      image_car_url: car.image_car_url,
    };
  }

  // ดึงข้อมูลสถานี
  const station = db.prepare(`
    SELECT cs.*, sss.name AS status_name
    FROM charging_stations cs
    LEFT JOIN station_service_status sss ON cs.status_id = sss.id
    WHERE cs.id = ?
  `).get(station_id);
  if (!station) return res.status(404).json({ success: false, error: 'ไม่พบสถานีชาร์จ' });

  const pricing      = getActivePricing(station_id);
  const pricingModel = station.pricing_model || 'kWh';
  const period       = getPeriod(start_datetime);
  const disc         = discount || 0;
  const serviceFee   = pricing?.service_fee    || 0;
  const minChargeFee = pricing?.min_charge_fee || 0;
  const vatPercent   = pricing?.vat_percent    ?? 7;

  // พลังงานที่ต้องชาร์จเข้าแบต
  const neededKwh  = battery_capacity_kwh * (target_percent - current_percent) / 100;
  // พลังงานที่ดึงจากตู้ชาร์จ (รวม loss)
  const actualKwh  = neededKwh / charge_efficiency;
  // เวลาที่ใช้ (นาที)
  const powerKw    = station.power_max_kw || station.power_min_kw || 7.4;
  const estMinutes = Math.ceil((actualKwh / powerKw) * 60);

  let chargeCost = 0;
  let chargeBreakdown = {};

  if (pricingModel === 'kWh') {
    const rate = period === 'PEAK' ? station.price_peak : station.price_offpeak;
    if (!rate)
      return res.status(422).json({ success: false, error: `สถานีนี้ไม่มีราคา ${period} กำหนดไว้` });

    chargeCost = actualKwh * rate;
    chargeBreakdown = {
      energy_needed_kwh: +neededKwh.toFixed(3),
      energy_actual_kwh: +actualKwh.toFixed(3),
      charge_efficiency,
      rate_per_kwh:      rate,
      price_peak:        station.price_peak,
      price_offpeak:     station.price_offpeak,
      energy_cost:       +chargeCost.toFixed(2),
    };
  } else {
    if (!station.idle_fee)
      return res.status(422).json({ success: false, error: 'สถานีนี้ไม่มี idle_fee กำหนดไว้' });

    const billedHours = Math.ceil(estMinutes / 60);
    chargeCost = billedHours * station.idle_fee;
    chargeBreakdown = {
      billed_hours:      billedHours,
      idle_fee_per_hour: station.idle_fee,
      charge_cost:       +chargeCost.toFixed(2),
    };
  }

  const { subtotal, afterDiscount, vatAmount, totalAmount } = calcTotal(
    chargeCost, serviceFee, disc, minChargeFee, vatPercent
  );

  res.json({
    success: true,
    vehicle: vehicleInfo,
    station: {
      id:            station.id,
      name:          station.name,
      provider_name: station.provider_name,
      charge_type:   station.charge_type,
      power_max_kw:  powerKw,
      pricing_model: pricingModel,
    },
    battery: {
      capacity_kwh:   battery_capacity_kwh,
      current_percent,
      target_percent,
      charge_percent: target_percent - current_percent,
    },
    estimated_time: {
      minutes: estMinutes,
      hours:   +(estMinutes / 60).toFixed(2),
      label:   `${Math.floor(estMinutes / 60)} ชม. ${estMinutes % 60} นาที`,
    },
    period,
    breakdown: {
      pricing_model: pricingModel,
      ...chargeBreakdown,
      service_fee:    serviceFee,
      subtotal:       +subtotal.toFixed(2),
      discount:       disc,
      min_charge_fee: minChargeFee,
      after_discount: +afterDiscount.toFixed(2),
      vat_percent:    vatPercent,
      vat_amount:     +vatAmount.toFixed(2),
      total_amount:   +totalAmount.toFixed(2),
    },
  });
});

// ============================================================
// POST /charging-fee/compare — เปรียบเทียบราคาหลายสถานี
// ============================================================
/**
 * @swagger
 * /charging-fee/compare:
 *   post:
 *     tags: [Charging Fee]
 *     summary: เปรียบเทียบค่าบริการของหลายสถานี
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [station_ids, energy_kwh]
 *             properties:
 *               station_ids:
 *                 type: array
 *                 items: { type: integer }
 *                 example: [1, 2, 3]
 *               energy_kwh:
 *                 type: number
 *                 example: 30.0
 *               start_datetime:
 *                 type: string
 *                 example: "2026-06-23 10:00:00"
 *     responses:
 *       200:
 *         description: ผลเปรียบเทียบเรียงจากถูกไปแพง
 */
router.post('/compare', (req, res) => {
  const { station_ids, energy_kwh, start_datetime } = req.body;

  if (!Array.isArray(station_ids) || station_ids.length === 0)
    return res.status(400).json({ success: false, error: 'station_ids ต้องเป็น array และมีอย่างน้อย 1 สถานี' });
  if (energy_kwh == null)
    return res.status(400).json({ success: false, error: 'energy_kwh จำเป็นต้องระบุ' });

  const period = getPeriod(start_datetime);
  const results = [];

  for (const sid of station_ids) {
    const station = db.prepare(`SELECT * FROM charging_stations WHERE id = ?`).get(sid);
    if (!station) { results.push({ station_id: sid, error: 'ไม่พบสถานี' }); continue; }

    if (station.pricing_model === 'time') {
      results.push({
        station_id:    sid,
        name:          station.name,
        provider_name: station.provider_name,
        pricing_model: 'time',
        note:          'คิดตามเวลา ไม่สามารถเปรียบเทียบด้วย kWh ได้',
        idle_fee:      station.idle_fee,
      });
      continue;
    }

    const rate = period === 'PEAK' ? station.price_peak : station.price_offpeak;
    if (!rate) { results.push({ station_id: sid, name: station.name, error: 'ไม่มีราคากำหนด' }); continue; }

    const pricing      = getActivePricing(sid);
    const serviceFee   = pricing?.service_fee    || 0;
    const minChargeFee = pricing?.min_charge_fee || 0;
    const vatPercent   = pricing?.vat_percent    ?? 7;

    const energyCost = energy_kwh * rate;
    const { subtotal, afterDiscount, vatAmount, totalAmount } = calcTotal(
      energyCost, serviceFee, 0, minChargeFee, vatPercent
    );

    results.push({
      station_id:    sid,
      name:          station.name,
      provider_name: station.provider_name,
      charge_type:   station.charge_type,
      power_max_kw:  station.power_max_kw,
      pricing_model: 'kWh',
      period,
      rate_per_kwh:  rate,
      energy_cost:   +energyCost.toFixed(2),
      service_fee:   serviceFee,
      vat_amount:    +vatAmount.toFixed(2),
      total_amount:  +totalAmount.toFixed(2),
    });
  }

  results.sort((a, b) => (a.total_amount || Infinity) - (b.total_amount || Infinity));

  res.json({
    success: true,
    energy_kwh,
    period,
    count: results.length,
    cheapest: results.find(r => r.total_amount)?.name || null,
    results,
  });
});

// ============================================================
// POST /charging-fee/session/start — ผู้ใช้กด "เริ่มชาร์จ"
//   บันทึกเวลาเริ่ม, ดึงอัตราค่าบริการจากสถานีอัตโนมัติ
//   ยังไม่คิดค่าใช้จ่าย — รอผู้ใช้กด stop
// ============================================================
/**
 * @swagger
 * /charging-fee/session/start:
 *   post:
 *     tags: [Charging Fee]
 *     summary: เริ่มการชาร์จ — บันทึกเวลาเริ่ม (ไม่กำหนดเวลาสิ้นสุด)
 *     description: |
 *       ผู้ใช้ไปถึงตู้ชาร์จแล้วกด "เริ่มชาร์จ" ระบบบันทึกเวลาเริ่มและดึงอัตราค่าบริการจากสถานีอัตโนมัติ
 *       เมื่อผู้ใช้กด "สิ้นสุด" ให้ call `PUT /charging-fee/session/:id/stop`
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [station_id, user_id, username]
 *             properties:
 *               station_id:    { type: integer, example: 1, description: สถานีที่เข้าใช้บริการ }
 *               user_id:       { type: integer, example: 1 }
 *               vehicle_id:    { type: integer, example: 1, description: รถของผู้ใช้ (optional) }
 *               booking_id:    { type: integer, example: 1, description: ID การจอง (optional) }
 *               payment_method: { type: string, example: QR_CODE, description: วิธีชำระเงิน }
 *               note:          { type: string, example: "ตู้ชาร์จหมายเลข 3" }
 *               username:      { type: string, example: john_doe }
 *     responses:
 *       201:
 *         description: เริ่มชาร์จสำเร็จ พร้อม session_id สำหรับ call stop
 *       404:
 *         description: ไม่พบสถานี
 */
router.post('/session/start', (req, res) => {
  const { station_id, user_id, vehicle_id, booking_id, payment_method, note, username } = req.body;

  if (!station_id || !user_id)
    return res.status(400).json({ success: false, error: 'station_id และ user_id จำเป็นต้องระบุ' });
  if (!username)
    return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const station = db.prepare(`
    SELECT cs.*, sss.name AS status_name
    FROM charging_stations cs
    LEFT JOIN station_service_status sss ON cs.status_id = sss.id
    WHERE cs.id = ?
  `).get(station_id);
  if (!station) return res.status(404).json({ success: false, error: 'ไม่พบสถานีชาร์จ' });

  // ดึง rate จากสถานี ณ เวลาปัจจุบัน (Peak/Off-Peak)
  const period   = getPeriod();
  const rate     = period === 'PEAK' ? station.price_peak : station.price_offpeak;
  const startAt  = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const result = db.prepare(`
    INSERT INTO charging_sessions
      (booking_id, user_id, station_id, vehicle_id,
       actual_start, rate_per_kwh, service_fee,
       payment_status, payment_method, note,
       created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).run(
    booking_id    || null,
    user_id,
    station_id,
    vehicle_id    || null,
    startAt,
    rate          || 0,
    0,
    payment_method || null,
    note          || null,
    username,
    username,
  );

  const session = db.prepare(`
    SELECT cs.*, u.username AS user_name,
           st.name AS station_name, st.provider_name, st.charge_type,
           st.power_max_kw, st.pricing_model, st.price_peak, st.price_offpeak, st.idle_fee
    FROM charging_sessions cs
    LEFT JOIN users u              ON cs.user_id    = u.id
    LEFT JOIN charging_stations st ON cs.station_id = st.id
    WHERE cs.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    success: true,
    message: 'เริ่มการชาร์จสำเร็จ กรุณากด "สิ้นสุด" เมื่อชาร์จเสร็จ',
    session_id:  session.id,
    actual_start: session.actual_start,
    period,
    station: {
      id:            station.id,
      name:          station.name,
      provider_name: station.provider_name,
      charge_type:   station.charge_type,
      power_max_kw:  station.power_max_kw,
      pricing_model: station.pricing_model,
      rate_at_start: rate,
    },
    note: station.pricing_model === 'kWh'
      ? `อัตราที่ใช้: ${rate} THB/kWh (${period})`
      : `อัตราที่ใช้: ${station.idle_fee} THB/ชม.`,
  });
});

// ============================================================
// PUT /charging-fee/session/:id/stop — ผู้ใช้กด "สิ้นสุดการชาร์จ"
//   คำนวณค่าใช้จ่ายอัตโนมัติจากเวลาจริง
//   kWh-based: ต้องระบุ energy_kwh ที่ใช้จริง
//   time-based: คำนวณจาก duration (actual_end - actual_start)
// ============================================================
/**
 * @swagger
 * /charging-fee/session/{id}/stop:
 *   put:
 *     tags: [Charging Fee]
 *     summary: สิ้นสุดการชาร์จ — คำนวณค่าบริการอัตโนมัติ
 *     description: |
 *       ผู้ใช้กด "สิ้นสุด" ระบบบันทึกเวลาสิ้นสุดและคำนวณค่าใช้จ่ายทันที
 *       - **kWh-based**: ต้องส่ง `energy_kwh` ที่ใช้จริง (อ่านจากหน้าจอตู้ชาร์จ)
 *       - **time-based**: ระบบคำนวณจากเวลาจริง (actual_end - actual_start) อัตโนมัติ
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: session_id ที่ได้จาก /session/start
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               energy_kwh:
 *                 type: number
 *                 example: 18.5
 *                 description: พลังงานที่ใช้จริง (kWh) — required สำหรับ pricing_model=kWh
 *               discount:
 *                 type: number
 *                 example: 0
 *                 description: ส่วนลด (บาท)
 *               username:
 *                 type: string
 *                 example: john_doe
 *     responses:
 *       200:
 *         description: สิ้นสุดการชาร์จพร้อม breakdown ค่าใช้จ่าย
 *       400:
 *         description: ข้อมูลไม่ครบ
 *       404:
 *         description: ไม่พบ session
 *       409:
 *         description: session สิ้นสุดไปแล้ว
 */
router.put('/session/:id/stop', (req, res) => {
  const { energy_kwh, discount, username } = req.body;
  if (!username)
    return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const session = db.prepare('SELECT * FROM charging_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'ไม่พบ session' });
  if (session.actual_end)
    return res.status(409).json({ success: false, error: 'session นี้สิ้นสุดไปแล้ว' });

  const station = db.prepare('SELECT * FROM charging_stations WHERE id = ?').get(session.station_id);
  const pricing = getActivePricing(session.station_id);

  const pricingModel = station?.pricing_model || 'kWh';
  const serviceFee   = pricing?.service_fee    || 0;
  const minChargeFee = pricing?.min_charge_fee || 0;
  const vatPercent   = pricing?.vat_percent    ?? 7;
  const disc         = discount || 0;

  const stopAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // คำนวณ duration จริง
  const startMs    = new Date(session.actual_start.replace(' ', 'T')).getTime();
  const stopMs     = new Date(stopAt.replace(' ', 'T')).getTime();
  const durationMs = stopMs - startMs;
  const durationMin = Math.max(Math.ceil(durationMs / 60000), 1);
  const durationHrs = +(durationMin / 60).toFixed(2);

  let chargeCost = 0;
  let chargeBreakdown = {};

  if (pricingModel === 'kWh') {
    if (energy_kwh == null)
      return res.status(400).json({ success: false, error: 'energy_kwh จำเป็นต้องระบุสำหรับสถานีแบบ kWh' });

    const rate = session.rate_per_kwh || (station?.price_peak || 0);
    chargeCost = energy_kwh * rate;
    chargeBreakdown = {
      pricing_model: 'kWh',
      energy_kwh,
      rate_per_kwh:  rate,
      energy_cost:   +chargeCost.toFixed(2),
      duration_min:  durationMin,
      duration_hrs:  durationHrs,
    };
  } else {
    // time-based — คำนวณจาก duration จริง
    const idleFee   = station?.idle_fee || 0;
    const billedHrs = Math.ceil(durationMin / 60);
    chargeCost      = billedHrs * idleFee;
    chargeBreakdown = {
      pricing_model:     'time',
      duration_min:       durationMin,
      duration_hrs:       durationHrs,
      billed_hours:       billedHrs,
      idle_fee_per_hour:  idleFee,
      charge_cost:        +chargeCost.toFixed(2),
    };
  }

  const { subtotal, afterDiscount, vatAmount, totalAmount } = calcTotal(
    chargeCost, serviceFee, disc, minChargeFee, vatPercent
  );

  // บันทึกลง DB
  db.prepare(`
    UPDATE charging_sessions
    SET actual_end      = ?,
        energy_kwh      = ?,
        total_amount    = ?,
        discount        = ?,
        payment_status  = 'PENDING',
        updated_at      = datetime('now','localtime'),
        updated_by      = ?
    WHERE id = ?
  `).run(
    stopAt,
    pricingModel === 'kWh' ? energy_kwh : null,
    totalAmount,
    disc,
    username,
    session.id,
  );

  res.json({
    success: true,
    message: 'สิ้นสุดการชาร์จสำเร็จ',
    session_id:    session.id,
    actual_start:  session.actual_start,
    actual_end:    stopAt,
    station: {
      id:            station?.id,
      name:          station?.name,
      provider_name: station?.provider_name,
      charge_type:   station?.charge_type,
    },
    breakdown: {
      ...chargeBreakdown,
      service_fee:    serviceFee,
      subtotal:       +subtotal.toFixed(2),
      discount:       disc,
      min_charge_fee: minChargeFee,
      after_discount: +afterDiscount.toFixed(2),
      vat_percent:    vatPercent,
      vat_amount:     +vatAmount.toFixed(2),
      total_amount:   +totalAmount.toFixed(2),
    },
    payment: {
      status:  'PENDING',
      message: 'กรุณาชำระเงิน',
      amount:  +totalAmount.toFixed(2),
    },
  });
});

module.exports = router;
