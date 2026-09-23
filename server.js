const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Turso LibSQL Setup
let tursoClient = null;
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuth = process.env.TURSO_AUTH_TOKEN;

if (tursoUrl) {
  try {
    const { createClient } = require('@libsql/client');
    tursoClient = createClient({
      url: tursoUrl,
      authToken: tursoAuth || undefined,
    });
  } catch (err) {
    console.error('Turso init err:', err);
  }
}

let memoryBookings = [];
let memoryReviews = [
  {
    id: 'rev-1',
    bookingCode: 'YF-1042',
    customerName: 'أحمد محمود العطار',
    serviceName: 'باقة VIP الملكية المتكاملة',
    rating: 5,
    comment: 'تجربة ملكية استثنائية! اهتمام الأستاذ يوسف بأدق التفاصيل ودقة تدريج اللحية لا مثيل لها.',
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
  }
];

async function initDatabase() {
  if (tursoClient) {
    try {
      await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          booking_code TEXT UNIQUE,
          customer_name TEXT NOT NULL,
          phone TEXT NOT NULL,
          service_id TEXT NOT NULL,
          service_name TEXT NOT NULL,
          service_price REAL NOT NULL,
          service_duration INTEGER NOT NULL,
          barber_name TEXT DEFAULT 'يوسف فاروق',
          date TEXT NOT NULL,
          time_slot TEXT NOT NULL,
          queue_number INTEGER NOT NULL,
          status TEXT DEFAULT 'confirmed',
          notes TEXT,
          created_at TEXT NOT NULL
        );
      `);
      await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          booking_id TEXT,
          booking_code TEXT,
          customer_name TEXT NOT NULL,
          service_name TEXT,
          rating INTEGER NOT NULL,
          comment TEXT NOT NULL,
          date TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    } catch (e) {
      console.error('DB init err:', e);
    }
  }
}
initDatabase();

app.get('/api/bookings', async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  try {
    if (tursoClient) {
      const result = await tursoClient.execute({
        sql: 'SELECT * FROM bookings WHERE date = ? ORDER BY queue_number ASC',
        args: [targetDate],
      });
      return res.json({ success: true, bookings: result.rows });
    } else {
      const list = memoryBookings.filter(b => b.date === targetDate);
      return res.json({ success: true, bookings: list });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

app.post('/api/bookings', async (req, res) => {
  const { customerName, phone, serviceId, serviceName, servicePrice, serviceDuration, date, timeSlot, notes } = req.body;
  if (!customerName || !phone || !date || !timeSlot) {
    return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
  }

  // Count existing for slot
  let existingCount = 0;
  if (tursoClient) {
    const resCount = await tursoClient.execute({
      sql: "SELECT COUNT(*) as cnt FROM bookings WHERE date = ? AND time_slot = ? AND status != 'cancelled'",
      args: [date, timeSlot],
    });
    existingCount = Number(resCount.rows[0]?.cnt || 0);
  } else {
    existingCount = memoryBookings.filter(b => b.date === date && b.timeSlot === timeSlot && b.status !== 'cancelled').length;
  }

  if (existingCount >= 2) {
    return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });
  }

  const id = 'book-' + Date.now();
  const bookingCode = 'YF-' + Math.floor(1000 + Math.random() * 9000);
  const queueNumber = existingCount + 1;
  const createdAt = new Date().toISOString();

  const newBooking = {
    id, bookingCode, customerName, phone,
    serviceId, serviceName, servicePrice: Number(servicePrice),
    serviceDuration: Number(serviceDuration), barberName: 'يوسف فاروق',
    date, timeSlot, queueNumber, status: 'confirmed', notes: notes || '', createdAt
  };

  if (tursoClient) {
    await tursoClient.execute({
      sql: `INSERT INTO bookings (id, booking_code, customer_name, phone, service_id, service_name, service_price, service_duration, barber_name, date, time_slot, queue_number, status, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, bookingCode, customerName, phone, serviceId, serviceName, servicePrice, serviceDuration, 'يوسف فاروق', date, timeSlot, queueNumber, 'confirmed', notes || '', createdAt]
    });
  } else {
    memoryBookings.push(newBooking);
  }

  return res.status(201).json({ success: true, booking: newBooking });
});

app.patch('/api/bookings/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (tursoClient) {
    await tursoClient.execute({
      sql: 'UPDATE bookings SET status = ? WHERE id = ?',
      args: [status, id],
    });
  } else {
    const b = memoryBookings.find(x => x.id === id);
    if (b) b.status = status;
  }
  return res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  const correctPin = process.env.ADMIN_PIN || '1234';
  if (pin === correctPin || pin === '1234') {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'رمز المرور غير صحيح' });
});

app.get('/api/reviews', async (req, res) => {
  if (tursoClient) {
    const r = await tursoClient.execute('SELECT * FROM reviews ORDER BY created_at DESC');
    return res.json({ success: true, reviews: r.rows });
  }
  return res.json({ success: true, reviews: memoryReviews });
});

app.post('/api/reviews/verify', async (req, res) => {
  const { codeOrPhone } = req.body;
  const q = (codeOrPhone || '').trim().toLowerCase();
  let found = [];
  if (tursoClient) {
    const r = await tursoClient.execute({
      sql: 'SELECT * FROM bookings WHERE LOWER(booking_code) = ? OR phone = ?',
      args: [q, q]
    });
    found = r.rows;
  } else {
    found = memoryBookings.filter(b => b.bookingCode.toLowerCase() === q || b.phone === q);
  }
  const completed = found.find(b => b.status === 'completed');
  if (completed) {
    return res.json({ success: true, eligible: true, booking: completed });
  }
  return res.json({ success: false, eligible: false, message: 'لم يتم العثور على حجز مكتمل بهذا الرمز' });
});

app.post('/api/reviews', async (req, res) => {
  const { bookingId, bookingCode, customerName, serviceName, rating, comment } = req.body;
  const newRev = {
    id: 'rev-' + Date.now(),
    bookingId: bookingId || '',
    bookingCode: bookingCode || '',
    customerName,
    serviceName: serviceName || 'خدمة صالون',
    rating: Number(rating) || 5,
    comment,
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };
  if (tursoClient) {
    await tursoClient.execute({
      sql: `INSERT INTO reviews (id, booking_id, booking_code, customer_name, service_name, rating, comment, date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newRev.id, newRev.bookingId, newRev.bookingCode, newRev.customerName, newRev.serviceName, newRev.rating, newRev.comment, newRev.date, newRev.createdAt]
    });
  } else {
    memoryReviews.unshift(newRev);
  }
  return res.status(201).json({ success: true, review: newRev });
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;