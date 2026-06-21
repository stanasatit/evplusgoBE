const express = require('express');
const db = require('../database');
const router = express.Router();

/**
 * @swagger
 * /station-status:
 *   get:
 *     tags: [Master - Station Status]
 *     summary: ดูสถานะตู้บริการทั้งหมด
 *     responses:
 *       200:
 *         description: รายการสถานะตู้บริการ
 */
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM station_service_status ORDER BY id').all();
  res.json({ success: true, count: list.length, data: list });
});

/**
 * @swagger
 * /station-status/{id}:
 *   get:
 *     tags: [Master - Station Status]
 *     summary: ดูสถานะตู้บริการตาม ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ข้อมูลสถานะ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM station_service_status WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลสถานะ' });
  res.json({ success: true, data: item });
});

/**
 * @swagger
 * /station-status:
 *   post:
 *     tags: [Master - Station Status]
 *     summary: เพิ่มสถานะตู้บริการใหม่
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, username]
 *             properties:
 *               code:        { type: string, example: CHARGING }
 *               name:        { type: string, example: กำลังชาร์จ }
 *               description: { type: string, example: ตู้กำลังให้บริการชาร์จ }
 *               username:    { type: string, example: admin }
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
router.post('/', (req, res) => {
  const { code, name, description, username } = req.body;
  if (!code || !name) return res.status(400).json({ success: false, error: 'code และ name จำเป็นต้องระบุ' });
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  try {
    const result = db.prepare(`
      INSERT INTO station_service_status (code, name, description, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(code, name, description || null, username, username);

    const item = db.prepare('SELECT * FROM station_service_status WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, message: 'เพิ่มสถานะสำเร็จ', data: item });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed'))
      return res.status(400).json({ success: false, error: 'code นี้มีอยู่แล้ว' });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /station-status/{id}:
 *   put:
 *     tags: [Master - Station Status]
 *     summary: แก้ไขสถานะตู้บริการ
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
 *               name:        { type: string }
 *               description: { type: string }
 *               username:    { type: string, example: admin }
 *     responses:
 *       200:
 *         description: แก้ไขสำเร็จ
 *       404:
 *         description: ไม่พบข้อมูล
 */
router.put('/:id', (req, res) => {
  const { name, description, username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username จำเป็นต้องระบุ' });

  const existing = db.prepare('SELECT id FROM station_service_status WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลสถานะ' });

  db.prepare(`
    UPDATE station_service_status
    SET name = COALESCE(?, name), description = COALESCE(?, description),
        updated_at = datetime('now', 'localtime'), updated_by = ?
    WHERE id = ?
  `).run(name, description, username, req.params.id);

  const item = db.prepare('SELECT * FROM station_service_status WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'แก้ไขสถานะสำเร็จ', data: item });
});

module.exports = router;
