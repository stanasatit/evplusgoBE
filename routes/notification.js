const express = require('express');
const router = express.Router();

let messaging;

const setMessaging = (m) => { messaging = m; };

// ============================================================
// POST /notification/send/token
// ============================================================
/**
 * @swagger
 * /notification/send/token:
 *   post:
 *     tags: [Notification]
 *     summary: ส่ง notification ไปยัง device token เดียว
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendTokenRequest'
 *     responses:
 *       200:
 *         description: ส่งสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Firebase error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/send/token', async (req, res) => {
  const { token, title, body, data, imageUrl } = req.body;

  if (!token) return res.status(400).json({ success: false, error: 'token is required' });
  if (!title || !body) return res.status(400).json({ success: false, error: 'title and body are required' });

  const message = {
    token,
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    android: { notification: { channelId: 'default', priority: 'high', sound: 'default' } },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    ...(data && { data }),
  };

  try {
    const response = await messaging.send(message);
    res.json({ success: true, messageId: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, code: error.code });
  }
});

// ============================================================
// POST /notification/send/topic
// ============================================================
/**
 * @swagger
 * /notification/send/topic:
 *   post:
 *     tags: [Notification]
 *     summary: ส่ง notification ไปยัง topic
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendTopicRequest'
 *     responses:
 *       200:
 *         description: ส่งสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Firebase error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/send/topic', async (req, res) => {
  const { topic, title, body, data, imageUrl } = req.body;

  if (!topic) return res.status(400).json({ success: false, error: 'topic is required' });
  if (!title || !body) return res.status(400).json({ success: false, error: 'title and body are required' });

  const message = {
    topic,
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    android: { notification: { channelId: 'default', priority: 'high', sound: 'default' } },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    ...(data && { data }),
  };

  try {
    const response = await messaging.send(message);
    res.json({ success: true, messageId: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, code: error.code });
  }
});

// ============================================================
// POST /notification/send/multiple
// ============================================================
/**
 * @swagger
 * /notification/send/multiple:
 *   post:
 *     tags: [Notification]
 *     summary: ส่ง notification ไปยังหลาย device tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendMultipleRequest'
 *     responses:
 *       200:
 *         description: ส่งสำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MultipleResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Firebase error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/send/multiple', async (req, res) => {
  const { tokens, title, body, data, imageUrl } = req.body;

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0)
    return res.status(400).json({ success: false, error: 'tokens array is required' });
  if (!title || !body)
    return res.status(400).json({ success: false, error: 'title and body are required' });

  const message = {
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    android: { notification: { channelId: 'default', priority: 'high', sound: 'default' } },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    ...(data && { data }),
  };

  try {
    const response = await messaging.sendEachForMulticast({ tokens, ...message });
    const results = response.responses.map((r, idx) => ({
      token: tokens[idx],
      success: r.success,
      messageId: r.messageId || null,
      error: r.error ? r.error.message : null,
    }));
    res.json({ success: true, successCount: response.successCount, failureCount: response.failureCount, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, code: error.code });
  }
});

// ============================================================
// POST /notification/topic/subscribe
// ============================================================
/**
 * @swagger
 * /notification/topic/subscribe:
 *   post:
 *     tags: [Notification]
 *     summary: Subscribe tokens เข้า topic
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TopicRequest'
 *     responses:
 *       200:
 *         description: Subscribe สำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TopicResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/topic/subscribe', async (req, res) => {
  const { tokens, topic } = req.body;

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0)
    return res.status(400).json({ success: false, error: 'tokens array is required' });
  if (!topic) return res.status(400).json({ success: false, error: 'topic is required' });

  try {
    const response = await messaging.subscribeToTopic(tokens, topic);
    res.json({ success: true, successCount: response.successCount, failureCount: response.failureCount, errors: response.errors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// POST /notification/topic/unsubscribe
// ============================================================
/**
 * @swagger
 * /notification/topic/unsubscribe:
 *   post:
 *     tags: [Notification]
 *     summary: Unsubscribe tokens ออกจาก topic
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TopicRequest'
 *     responses:
 *       200:
 *         description: Unsubscribe สำเร็จ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TopicResponse'
 *       400:
 *         description: ข้อมูลไม่ครบ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/topic/unsubscribe', async (req, res) => {
  const { tokens, topic } = req.body;

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0)
    return res.status(400).json({ success: false, error: 'tokens array is required' });
  if (!topic) return res.status(400).json({ success: false, error: 'topic is required' });

  try {
    const response = await messaging.unsubscribeFromTopic(tokens, topic);
    res.json({ success: true, successCount: response.successCount, failureCount: response.failureCount, errors: response.errors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = { router, setMessaging };
