const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '/database/evplusgoDB.sqlite'));

// เปิด WAL mode เพื่อประสิทธิภาพที่ดีขึ้น
db.pragma('journal_mode = WAL');

// สร้างตาราง users
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    birthday    TEXT,
    phone       TEXT,
    line_id     TEXT,
    email       TEXT,
    image_base64 TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by  TEXT,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by  TEXT
  );
`);

// Migration: เพิ่ม column ใหม่ถ้ายังไม่มี (สำหรับ table ที่สร้างไว้ก่อนหน้า)
const existingColumns = db.pragma('table_info(users)').map((col) => col.name);
const newColumns = [
  { name: 'email',      def: 'TEXT' },
  { name: 'image_base64', def: 'TEXT' },
  { name: 'created_by', def: 'TEXT' },
  { name: 'updated_at', def: "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))" },
  { name: 'updated_by', def: 'TEXT' },
];
for (const col of newColumns) {
  if (!existingColumns.includes(col.name)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def};`);
  }
}

// สร้างตาราง device_tokens
db.exec(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT    NOT NULL UNIQUE,
    fcm_token   TEXT    NOT NULL,
    user_id     INTEGER,
    platform    TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by  TEXT,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by  TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ============================================================
// 4. Master: สถานะตู้บริการ
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS station_service_status (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    description TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by  TEXT,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by  TEXT
  );
`);

// Seed ข้อมูลเริ่มต้น station_service_status
const statusCount = db.prepare('SELECT COUNT(*) as c FROM station_service_status').get();
if (statusCount.c === 0) {
  const insertStatus = db.prepare(`
    INSERT INTO station_service_status (code, name, description, created_by, updated_by)
    VALUES (?, ?, ?, 'system', 'system')
  `);
  [
    ['AVAILABLE',    'พร้อมใช้งาน',   'ตู้ชาร์จพร้อมใช้งานปกติ'],
    ['IN_USE',       'กำลังใช้งาน',   'มีผู้ใช้งานอยู่'],
    ['RESERVED',     'ถูกจองแล้ว',    'ถูกจองล่วงหน้า'],
    ['MAINTENANCE',  'ซ่อมบำรุง',     'อยู่ระหว่างซ่อมบำรุง'],
    ['OFFLINE',      'ออฟไลน์',       'ตู้ชาร์จไม่พร้อมให้บริการ'],
  ].forEach(([code, name, desc]) => insertStatus.run(code, name, desc));
}

// ============================================================
// 5. Master: รถ EV
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS ev_car_master (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    brand            TEXT    NOT NULL,
    model            TEXT    NOT NULL,
    year             INTEGER,
    battery_capacity REAL,
    range_km         INTEGER,
    charge_type      TEXT,
    image_car_url    TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by       TEXT,
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by       TEXT
  );
`);

// Migration: เพิ่ม image_car_url ถ้า table เดิมยังไม่มี
const evCarColumns = db.pragma('table_info(ev_car_master)').map((col) => col.name);
if (!evCarColumns.includes('image_car_url')) {
  db.exec('ALTER TABLE ev_car_master ADD COLUMN image_car_url TEXT;');
}

// Seed ข้อมูลเริ่มต้น ev_car_master
const carCount = db.prepare('SELECT COUNT(*) as c FROM ev_car_master').get();
if (carCount.c === 0) {
  const insertCar = db.prepare(`
    INSERT INTO ev_car_master (brand, model, year, battery_capacity, range_km, charge_type, image_car_url, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'system', 'system')
  `);
  [
    [
      'Tesla', 'Model 3', 2024, 75.0, 576, 'AC/DC',
      'https://www.tesla.com/ownersmanual/images/GUID-B5641257-9E85-404B-9667-4DA5FDF6D2E7-online-en-US.png',
    ],
    [
      'Tesla', 'Model Y', 2024, 75.0, 533, 'AC/DC',
      'https://www.tesla.com/ownersmanual/images/GUID-BA11FAE9-99BA-4B1D-B22E-1CAF1663A74E-online-en-US.png',
    ],
    [
      'BYD', 'ATTO 3', 2024, 60.5, 420, 'AC/DC',
      'https://www.reverautomotive.com/images/model/new-atto3/color/new-atto3-frost-white-1024x717.png',
    ],
    [
      'BYD', 'Dolphin', 2024, 44.9, 340, 'AC/DC',
      'https://bydchaengwatthana.com/wp-content/uploads/2024/08/Dolphin-White-Ext.png',
    ],
    [
      'MG', 'MG4', 2024, 64.0, 435, 'AC/DC',
      'https://lum-auto.com/cdn/shop/files/20250114104812.png?v=1743051722&width=1426',
    ],
    [
      'Neta', 'Neta V', 2024, 40.7, 380, 'AC/DC',
      'https://www.palangyanyon.com/wp-content/uploads/2023/07/Neta-V.jpg',
    ],
    [
      'ORA', 'Good Cat', 2023, 48.0, 400, 'AC/DC',
      'https://gwmcharan.com/wp-content/uploads/2021/10/ORA-GOOD-CAT-GWM-CHARAN-46-1400x700.jpg',
    ],
  ].forEach(([brand, model, year, bat, range, type, img]) =>
    insertCar.run(brand, model, year, bat, range, type, img)
  );
  //console.log('Seeded: ev_car_master');
}

// ============================================================
// 2. สถานีชาร์จ (lat, long)
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS charging_stations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    address         TEXT,
    lat             REAL    NOT NULL,
    long            REAL    NOT NULL,
    total_chargers  INTEGER DEFAULT 1,
    status_id       INTEGER,
    provider_code   TEXT,
    provider_name   TEXT,
    charge_type     TEXT,
    power_min_kw    REAL,
    power_max_kw    REAL,
    pricing_model   TEXT,
    price_peak      REAL,
    price_offpeak   REAL,
    idle_fee        REAL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by      TEXT,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by      TEXT,
    FOREIGN KEY (status_id) REFERENCES station_service_status(id)
  );
`);

// Migration: เพิ่ม column ใหม่สำหรับ charging_stations ถ้ายังไม่มี
const stationColumns = db.pragma('table_info(charging_stations)').map((c) => c.name);
const newStationCols = [
  { name: 'provider_code',  def: 'TEXT' },
  { name: 'provider_name',  def: 'TEXT' },
  { name: 'charge_type',    def: 'TEXT' },
  { name: 'power_min_kw',   def: 'REAL' },
  { name: 'power_max_kw',   def: 'REAL' },
  { name: 'pricing_model',  def: 'TEXT' },
  { name: 'price_peak',     def: 'REAL' },
  { name: 'price_offpeak',  def: 'REAL' },
  { name: 'idle_fee',       def: 'REAL' },
];
for (const col of newStationCols) {
  if (!stationColumns.includes(col.name)) {
    db.exec(`ALTER TABLE charging_stations ADD COLUMN ${col.name} ${col.def};`);
    //console.log(`Migration: added column "${col.name}" to charging_stations`);
  }
}

// Seed ข้อมูลตัวอย่างสถานีชาร์จ
const stationCount = db.prepare('SELECT COUNT(*) as c FROM charging_stations').get();
if (stationCount.c === 0) {
  const insertStation = db.prepare(`
    INSERT INTO charging_stations
      (name, address, lat, long, total_chargers, status_id,
       provider_code, provider_name, charge_type, power_min_kw, power_max_kw,
       pricing_model, price_peak, price_offpeak, idle_fee, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'system')
  `);
  [
    // name, address, lat, long, total_chargers, status_id, provider_code, provider_name, charge_type, power_min, power_max, pricing_model, price_peak, price_offpeak, idle_fee
    ['PEA VOLTA สาขา Central Rama 9',    'ถ.พระราม 9 แขวงห้วยขวาง กทม.',  13.7560, 100.5641, 4, 1, 'PEA_VOLTA',  'PEA VOLTA',           'DC',    25,   25,  'kWh',  5.90, 4.90, null],
    ['PEA VOLTA สาขา The Mall บางกะปิ', 'ถ.ลาดพร้าว แขวงคลองจั่น กทม.',  13.7780, 100.6390, 2, 1, 'PEA_VOLTA',  'PEA VOLTA',           'DC',    50,  180,  'kWh',  6.90, 5.90, null],
    ['EA Anywhere PTT สีลม',             'ถ.สีลม แขวงสีลม กทม.',           13.7244, 100.5292, 6, 1, 'EA_ANYWHERE','EA Anywhere',          'DC',    50,   50,  'kWh',  7.70, 7.70, null],
    ['EA Anywhere AC สามย่าน',           'ถ.พระราม 4 แขวงสีลม กทม.',       13.7307, 100.5271, 4, 1, 'EA_ANYWHERE','EA Anywhere',          'AC',    22,   22,  'time', null, null, 80.0],
    ['Tesla Supercharger ICONSIAM',      'ถ.เจริญนคร แขวงคลองต้นไทร กทม.',13.7229, 100.5108, 8, 1, 'TESLA_SC',   'Tesla Supercharger',   'DC',   250,  250,  'kWh',  7.17, 7.17, null],
    ['MEA EV Station Central WestGate',  'ถ.กาญจนาภิเษก นนทบุรี',          13.8952, 100.4087, 4, 1, 'MEA_EV',     'MEA EV',               'DC',    50,  120,  'kWh',  7.50, 7.50, null],
    ['Shell Recharge On Nut',            'ถ.สุขุมวิท 77 แขวงออนนุช กทม.', 13.6877, 100.5993, 2, 1, 'SHELL_RC',   'Shell Recharge',       'DC',   360,  360,  'kWh',  9.00, 9.00, null],
    ['on-ion PTT Group ลาดกระบัง',       'ถ.ลาดกระบัง แขวงลาดกระบัง กทม.',13.7359, 100.7714, 3, 1, 'ON_ION',     'on-ion',               'DC',   120,  120,  'kWh',  7.25, 7.25, null],
    ['GINKA Charge Point เมืองทองธานี',  'ถ.แจ้งวัฒนะ นนทบุรี',            13.9125, 100.5483, 5, 1, 'GINKA',      'GINKA Charge Point',   'AC/DC', 22,  180,  'kWh',  6.50, 6.50, null],
    ['MG Super Charge เซ็นทรัลพลาซา',   'ถ.เพชรบุรี แขวงมักกะสัน กทม.',  13.7466, 100.5496, 3, 1, 'MG_SC',      'MG Super Charge',      'DC',    50,  120,  'kWh',  7.50, 7.50, null],
  ].forEach(([name, address, lat, long, total, sid, pcode, pname, ctype, pmin, pmax, pm, pp, pop, idle]) =>
    insertStation.run(name, address, lat, long, total, sid, pcode, pname, ctype, pmin, pmax, pm, pp, pop, idle)
  );
  //console.log('Seeded: charging_stations');
}

// ============================================================
// 1. รถ EV ของผู้ใช้งาน
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS user_vehicles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    ev_car_id     INTEGER,
    license_plate TEXT,
    color         TEXT,
    nickname      TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by    TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by    TEXT,
    FOREIGN KEY (user_id)   REFERENCES users(id),
    FOREIGN KEY (ev_car_id) REFERENCES ev_car_master(id)
  );
`);

// ============================================================
// 3. การจอง
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    station_id   INTEGER NOT NULL,
    vehicle_id   INTEGER,
    booking_date TEXT    NOT NULL,
    start_time   TEXT    NOT NULL,
    end_time     TEXT,
    status_id    INTEGER,
    note         TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by   TEXT,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by   TEXT,
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (station_id) REFERENCES charging_stations(id),
    FOREIGN KEY (vehicle_id) REFERENCES user_vehicles(id),
    FOREIGN KEY (status_id)  REFERENCES station_service_status(id)
  );
`);

// Migration: เพิ่ม columns ใน bookings
const bookingColsCheck = db.pragma('table_info(bookings)').map((c) => c.name);
if (!bookingColsCheck.includes('queue_number')) {
  db.exec('ALTER TABLE bookings ADD COLUMN queue_number INTEGER;');
}
if (!bookingColsCheck.includes('booking_type')) {
  db.exec("ALTER TABLE bookings ADD COLUMN booking_type TEXT DEFAULT 'SCHEDULED';");
}

// Migration: เพิ่ม notify columns ใน bookings
const bookingCols = db.pragma('table_info(bookings)').map((c) => c.name);
if (!bookingCols.includes('notify_remind_sent_at')) {
  db.exec('ALTER TABLE bookings ADD COLUMN notify_remind_sent_at TEXT;');
}
if (!bookingCols.includes('notify_end_sent_at')) {
  db.exec('ALTER TABLE bookings ADD COLUMN notify_end_sent_at TEXT;');
}

// ============================================================
// Config อัตราค่าบริการ
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS pricing_config (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id      INTEGER,
    name            TEXT    NOT NULL,
    rate_per_kwh    REAL    NOT NULL DEFAULT 0,
    service_fee     REAL    NOT NULL DEFAULT 0,
    min_charge_fee  REAL    NOT NULL DEFAULT 0,
    vat_percent     REAL    NOT NULL DEFAULT 7,
    effective_from  TEXT    NOT NULL,
    effective_to    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    note            TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by      TEXT,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by      TEXT,
    FOREIGN KEY (station_id) REFERENCES charging_stations(id)
  );
`);

// Seed อัตราค่าบริการเริ่มต้น (global rate)
const pricingCount = db.prepare('SELECT COUNT(*) as c FROM pricing_config').get();
if (pricingCount.c === 0) {
  db.prepare(`
    INSERT INTO pricing_config (station_id, name, rate_per_kwh, service_fee, min_charge_fee, vat_percent, effective_from, is_active, note, created_by, updated_by)
    VALUES (NULL, 'อัตรามาตรฐาน', 6.5, 10.0, 20.0, 7.0, '2026-01-01', 1, 'อัตราค่าบริการมาตรฐานทั่วไป', 'system', 'system')
  `).run();
  //console.log('Seeded: pricing_config');
}

// ============================================================
// ประวัติการจอง + ค่าบริการแต่ละรอบ
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS charging_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id       INTEGER,
    user_id          INTEGER NOT NULL,
    station_id       INTEGER NOT NULL,
    vehicle_id       INTEGER,
    actual_start     TEXT,
    actual_end       TEXT,
    energy_kwh       REAL    DEFAULT 0,
    rate_per_kwh     REAL    DEFAULT 0,
    service_fee      REAL    DEFAULT 0,
    discount         REAL    DEFAULT 0,
    total_amount     REAL    DEFAULT 0,
    payment_status   TEXT    DEFAULT 'PENDING',
    payment_method   TEXT,
    paid_at          TEXT,
    note             TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by       TEXT,
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by       TEXT,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id),
    FOREIGN KEY (user_id)     REFERENCES users(id),
    FOREIGN KEY (station_id)  REFERENCES charging_stations(id),
    FOREIGN KEY (vehicle_id)  REFERENCES user_vehicles(id)
  );
`);

//console.log('Database initialized: evplusgoDB.sqlite');

module.exports = db;
