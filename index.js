require('dotenv').config();
const express = require('express');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { router: notificationRouter, setMessaging } = require('./routes/notification');
const userRouter = require('./routes/user');
const deviceTokenRouter = require('./routes/deviceToken');
const evCarMasterRouter = require('./routes/evCarMaster');
const stationServiceStatusRouter = require('./routes/stationServiceStatus');
const chargingStationRouter = require('./routes/chargingStation');
const userVehicleRouter = require('./routes/userVehicle');
const bookingRouter = require('./routes/booking');
const chargingSessionRouter = require('./routes/chargingSession');
const pricingConfigRouter = require('./routes/pricingConfig');
const chargingFeeRouter = require('./routes/chargingFee');
const { setMessaging: setNotifierMessaging, startScheduler } = require('./services/bookingNotifier');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Swagger UI (public — ก่อน auth middleware)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ============================================================
// Public paths — ไม่ต้อง JWT
// ============================================================
const PUBLIC_ROUTES = [
  { method: 'GET',  path: '/' },
  { method: 'POST', path: '/user/register' },
  { method: 'POST', path: '/user/login' },
  { method: 'POST', path: '/user/refresh' },
  { method: 'POST', path: '/user/forgot-password' },
  { method: 'POST', path: '/user/reset-password' },
];

app.use((req, res, next) => {
  const isPublic = PUBLIC_ROUTES.some(
    (r) => r.method === req.method && req.path === r.path,
  ) || req.path.startsWith('/api-docs');
  if (isPublic) return next();
  authenticate(req, res, next);
});

// Initialize Firebase Admin SDK
try {
  const serviceAccount = require('./firebase-service-account.json');
  initializeApp({ credential: cert(serviceAccount) });
  const messaging = getMessaging();
  setMessaging(messaging);
  setNotifierMessaging(messaging);
  startScheduler();
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase:', error.message);
}

// ============================================================
// Routes
// ============================================================
app.use('/notification', notificationRouter);
app.use('/user', userRouter);
app.use('/device-token', deviceTokenRouter);
app.use('/ev-car', evCarMasterRouter);
app.use('/station-status', stationServiceStatusRouter);
app.use('/charging-station', chargingStationRouter);
app.use('/user-vehicle', userVehicleRouter);
app.use('/booking', bookingRouter);
app.use('/charging-session', chargingSessionRouter);
app.use('/pricing-config', pricingConfigRouter);
app.use('/charging-fee', chargingFeeRouter);

// ============================================================
// Health Check
// ============================================================
/**
 * @swagger
 * /:
 *   get:
 *     tags: [Health]
 *     summary: ตรวจสอบสถานะ server
 *     responses:
 *       200:
 *         description: Server ทำงานปกติ
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Firebase Push Notification API',
    package: 'com.exsample.evplusgo',
    docs: `http://localhost:${PORT}/api-docs`,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
  console.log(`Target app package: com.exsample.evplusgo`);
});
