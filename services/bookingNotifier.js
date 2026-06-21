const db = require('../database');

let _messaging = null;
let _schedulerTimer = null;

const CHECK_INTERVAL_MS  = 60 * 1000;  // ตรวจทุก 1 นาที
const REMIND_BEFORE_MIN  = 15;          // แจ้งเตือนก่อนเริ่ม N นาที

function setMessaging(m) {
  _messaging = m;
}

// ส่ง FCM ไปยังทุก device ของ user คนนั้น
async function sendToUser(userId, message) {
  const tokens = db
    .prepare('SELECT fcm_token FROM device_tokens WHERE user_id = ? AND fcm_token IS NOT NULL')
    .all(userId)
    .map((r) => r.fcm_token);

  if (tokens.length === 0) return { sent: 0, skipped: true };

  const payload = {
    notification: message.notification,
    data:         message.data || {},
    android:      { priority: 'high' },
    apns:         { payload: { aps: { sound: 'default', badge: 1 } } },
  };

  let successCount = 0;
  if (tokens.length === 1) {
    await _messaging.send({ ...payload, token: tokens[0] });
    successCount = 1;
  } else {
    const result = await _messaging.sendEachForMulticast({ ...payload, tokens });
    successCount = result.successCount;
  }

  return { sent: successCount, total: tokens.length };
}

// ============================================================
// ตรวจสอบและส่ง Remind (15 นาทีก่อนเริ่ม)
// ============================================================
async function checkRemind() {
  const rows = db.prepare(`
    SELECT b.id, b.user_id, b.booking_date, b.start_time, b.end_time,
           cs.name AS station_name, cs.address AS station_address,
           cs.provider_name
    FROM bookings b
    JOIN charging_stations cs ON b.station_id = cs.id
    WHERE b.notify_remind_sent_at IS NULL
      AND b.booking_date = date('now', 'localtime')
      AND b.start_time BETWEEN
            time('now', 'localtime')
            AND time('now', 'localtime', '+${REMIND_BEFORE_MIN} minutes')
  `.replace('${REMIND_BEFORE_MIN}', REMIND_BEFORE_MIN)).all();

  for (const b of rows) {
    try {
      const result = await sendToUser(b.user_id, {
        notification: {
          title: '⚡ ใกล้ถึงเวลาชาร์จแล้ว!',
          body:  `อีก ${REMIND_BEFORE_MIN} นาที — ${b.station_name} เวลา ${b.start_time}`,
        },
        data: {
          type:         'BOOKING_REMIND',
          booking_id:   String(b.id),
          booking_date: b.booking_date,
          start_time:   b.start_time,
          end_time:     b.end_time || '',
          station_name: b.station_name,
          screen:       'BookingDetail',
        },
      });

      db.prepare(`
        UPDATE bookings SET notify_remind_sent_at = datetime('now','localtime') WHERE id = ?
      `).run(b.id);

      console.log(`[Notifier] REMIND booking #${b.id} → ${result.sent} device(s)`);
    } catch (err) {
      console.error(`[Notifier] REMIND failed booking #${b.id}:`, err.message);
    }
  }
}

// ============================================================
// ตรวจสอบและส่ง End (ครบเวลาสิ้นสุด)
// ============================================================
async function checkEnd() {
  const rows = db.prepare(`
    SELECT b.id, b.user_id, b.booking_date, b.start_time, b.end_time,
           cs.name AS station_name, cs.address AS station_address,
           cs.provider_name
    FROM bookings b
    JOIN charging_stations cs ON b.station_id = cs.id
    WHERE b.end_time IS NOT NULL
      AND b.notify_end_sent_at IS NULL
      AND (
        b.booking_date < date('now','localtime')
        OR (
          b.booking_date = date('now','localtime')
          AND b.end_time <= time('now','localtime')
        )
      )
  `).all();

  for (const b of rows) {
    try {
      const result = await sendToUser(b.user_id, {
        notification: {
          title: '🔔 ครบกำหนดการจองแล้ว',
          body:  `${b.station_name} — ${b.start_time}–${b.end_time} กรุณาหยุดชาร์จและออกจากตู้`,
        },
        data: {
          type:         'BOOKING_END',
          booking_id:   String(b.id),
          booking_date: b.booking_date,
          start_time:   b.start_time,
          end_time:     b.end_time,
          station_name: b.station_name,
          screen:       'BookingDetail',
        },
      });

      db.prepare(`
        UPDATE bookings SET notify_end_sent_at = datetime('now','localtime') WHERE id = ?
      `).run(b.id);

      console.log(`[Notifier] END booking #${b.id} → ${result.sent} device(s)`);
    } catch (err) {
      console.error(`[Notifier] END failed booking #${b.id}:`, err.message);
    }
  }
}

// ============================================================
// รัน scheduler — เรียกทุก CHECK_INTERVAL_MS
// ============================================================
async function runCheck() {
  if (!_messaging) return;
  try {
    await checkRemind();
    await checkEnd();
  } catch (err) {
    console.error('[Notifier] runCheck error:', err.message);
  }
}

function startScheduler() {
  if (_schedulerTimer) clearInterval(_schedulerTimer);
  runCheck(); // รันทันทีเมื่อ start
  _schedulerTimer = setInterval(runCheck, CHECK_INTERVAL_MS);
  console.log(`[Notifier] Scheduler started — checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

function stopScheduler() {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
  }
}

// ============================================================
// Manual trigger — trigger notification สำหรับ booking เดียว
// ============================================================
async function notifyBookingManual(bookingId, type = 'end') {
  if (!_messaging) throw new Error('Firebase Messaging ยังไม่ได้ initialize');

  const b = db.prepare(`
    SELECT b.*, cs.name AS station_name, cs.provider_name
    FROM bookings b
    JOIN charging_stations cs ON b.station_id = cs.id
    WHERE b.id = ?
  `).get(bookingId);

  if (!b) throw new Error(`ไม่พบ booking #${bookingId}`);

  let notification, dataPayload, updateField;

  if (type === 'remind') {
    notification = {
      title: '⚡ ใกล้ถึงเวลาชาร์จแล้ว!',
      body:  `อีก ${REMIND_BEFORE_MIN} นาที — ${b.station_name} เวลา ${b.start_time}`,
    };
    dataPayload  = { type: 'BOOKING_REMIND', booking_id: String(b.id), station_name: b.station_name, start_time: b.start_time, screen: 'BookingDetail' };
    updateField  = 'notify_remind_sent_at';
  } else {
    notification = {
      title: '🔔 ครบกำหนดการจองแล้ว',
      body:  `${b.station_name} — ${b.start_time}–${b.end_time} กรุณาหยุดชาร์จและออกจากตู้`,
    };
    dataPayload  = { type: 'BOOKING_END', booking_id: String(b.id), station_name: b.station_name, start_time: b.start_time, end_time: b.end_time || '', screen: 'BookingDetail' };
    updateField  = 'notify_end_sent_at';
  }

  const result = await sendToUser(b.user_id, { notification, data: dataPayload });

  db.prepare(`UPDATE bookings SET ${updateField} = datetime('now','localtime') WHERE id = ?`).run(b.id);

  return { booking_id: b.id, type, ...result };
}

module.exports = { setMessaging, startScheduler, stopScheduler, notifyBookingManual };
