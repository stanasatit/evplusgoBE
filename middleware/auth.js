const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'evplusgo_jwt_secret_change_me';

function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'ไม่มี token กรุณา login ก่อน' });

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'token หมดอายุ กรุณา login ใหม่' : 'token ไม่ถูกต้อง';
    res.status(401).json({ success: false, error: msg });
  }
}

module.exports = { authenticate };
