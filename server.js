const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname)));

let tursoClient = null;
try {
  if (process.env.TURSO_DATABASE_URL) {
    const { createClient } = require('@libsql/client');
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
} catch (err) {
  console.error('Turso init error:', err);
}

let memoryBookings = [];
let memoryReviews = [{
  id: 'rev-1', bookingCode: 'YF-1042', customerName: 'أحمد محمود العطار',
  serviceName: 'باقة VIP الملكية المتكاملة', rating: 5,
  comment: 'تجربة ملكية استثنائية! اهتمام الأستاذ يوسف بأدق التفاصيل ودقة تدريج اللحية لا مثيل لها.',
  date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString()
}];

const SERVICES = {
  'vip-royal': { name: 'باقة VIP الملكية المتكاملة', price: 350, duration: 60 },
  'hair-beard': { name: 'باقة يوسف فاروق (شعر + لحية)', price: 250, duration: 45 },
  'haircut': { name: 'قص وتصفيف شعر كلاسيكي', price: 150, duration: 30 },
  'beard-sculpt': { name: 'تحديد ونحت اللحية بالفوطة الساخنة', price: 120, duration: 25 },
  'royal-facial': { name: 'جلسة تنظيف بشرة وماسك الذهب', price: 180, duration: 30 },
};

const VALID_STATUSES = new Set(['confirmed', 'in_chair', 'completed', 'cancelled']);
let dbReadyPromise = null;

function localDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mapBooking(row) {
  if (!row) return row;
  return {
    id: row.id,
    bookingCode: row.booking_code ?? row.bookingCode,
    customerName: row.customer_name ?? row.customerName,
    phone: row.phone,
    serviceId: row.service_id ?? row.serviceId,
    serviceName: row.service_name ?? row.serviceName,
    servicePrice: Number(row.service_price ?? row.servicePrice ?? 0),
    serviceDuration: Number(row.service_duration ?? row.serviceDuration ?? 0),
    barberName: row.barber_name ?? row.barberName ?? 'يوسف فاروق',
    date: row.date,
    timeSlot: row.time_slot ?? row.timeSlot,
    queueNumber: Number(row.queue_number ?? row.queueNumber ?? 0),
    status: row.status,
    notes: row.notes || '',
    createdAt: row.created_at ?? row.createdAt,
  };
}

function mapReview(row) {
  if (!row) return row;
  return {
    id: row.id,
    bookingId: row.booking_id ?? row.bookingId ?? '',
    bookingCode: row.booking_code ?? row.bookingCode ?? '',
    customerName: row.customer_name ?? row.customerName,
    serviceName: row.service_name ?? row.serviceName,
    rating: Number(row.rating || 0),
    comment: row.comment,
    date: row.date,
    createdAt: row.created_at ?? row.createdAt,
  };
}

async function ensureDatabase() {
  if (dbReadyPromise) return dbReadyPromise;
  dbReadyPromise = (async () => {
    if (!tursoClient) {
      if (isProduction) throw new Error('Turso database is not configured');
      return;
    }
    await tursoClient.execute(`CREATE TABLE IF NOT EXISTS bookings (
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
    );`);
        await tursoClient.execute(`CREATE TABLE IF NOT EXISTS bookings (
      ...
    );`);
  await tursoClient.execute(`CREATE TABLE IF NOT EXISTS reviews (
    await tursoClient.execute(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      booking_id TEXT,
      booking_code TEXT,
      customer_name TEXT NOT NULL,
      service_name TEXT,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  })();
  try { await dbReadyPromise; } catch (e) { dbReadyPromise = null; throw e; }
}

async function requireDb(res) {
  try { await ensureDatabase(); return true; }
  catch (e) { console.error('DB error:', e); res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' }); return false; }
}

app.get('/api/bookings', async (req, res) => {
  const targetDate = String(req.query.date || localDate());
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const result = await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE date = ? ORDER BY queue_number ASC', args: [targetDate] });
      return res.json({ success: true, bookings: result.rows.map(mapBooking) });
    } catch (e) { console.error(e); return res.status(500).json({ success: false, error: 'Database error' }); }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  return res.json({ success: true, bookings: memoryBookings.filter(b => b.date === targetDate) });
});

app.post('/api/bookings', async (req, res) => {
  const { customerName, phone, serviceId, date, timeSlot, notes } = req.body || {};
  if (!customerName || !phone || !date || !timeSlot || !serviceId) return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
  const service = SERVICES[serviceId];
  if (!service) return res.status(400).json({ success: false, error: 'الخدمة غير صحيحة' });

  if (tursoClient) {
    if (!(await requireDb(res))) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = 'book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const bookingCode = 'YF-' + Math.floor(1000 + Math.random() * 9000);
      const createdAt = new Date().toISOString();
      try {
        const result = await tursoClient.execute({
          sql: `INSERT INTO bookings (id, booking_code, customer_name, phone, service_id, service_name, service_price, service_duration, barber_name, date, time_slot, queue_number, status, notes, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'يوسف فاروق', ?, ?, COALESCE(MAX(queue_number), 0) + 1, 'confirmed', ?, ?
                FROM bookings WHERE date = ? AND time_slot = ? AND status != 'cancelled' HAVING COUNT(*) < 2`,
          args: [id, bookingCode, String(customerName).trim(), String(phone).trim(), serviceId, service.name, service.price, service.duration, date, timeSlot, notes || '', createdAt, date, timeSlot]
        });
        if (!result.rowsAffected) return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });
        const created = { id, bookingCode, customerName: String(customerName).trim(), phone: String(phone).trim(), serviceId, serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration, barberName: 'يوسف فاروق', date, timeSlot, queueNumber: 1, status: 'confirmed', notes: notes || '', createdAt };
        const fresh = await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [id] });
        return res.status(201).json({ success: true, booking: mapBooking(fresh.rows[0] || created) });
      } catch (e) {
        if (String(e.message || '').toLowerCase().includes('unique')) continue;
        console.error('Booking insert error:', e); return res.status(500).json({ success: false, error: 'تعذر حفظ الحجز' });
      }
    }
    return res.status(500).json({ success: false, error: 'تعذر إنشاء رمز الحجز، حاول مرة أخرى' });
  }

  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const existing = memoryBookings.filter(b => b.date === date && b.timeSlot === timeSlot && b.status !== 'cancelled');
  if (existing.length >= 2) return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });
  const newBooking = { id: 'book-' + Date.now(), bookingCode: 'YF-' + Math.floor(1000 + Math.random() * 9000), customerName: String(customerName).trim(), phone: String(phone).trim(), serviceId, serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration, barberName: 'يوسف فاروق', date, timeSlot, queueNumber: existing.length + 1, status: 'confirmed', notes: notes || '', createdAt: new Date().toISOString() };
  memoryBookings.push(newBooking);
  return res.status(201).json({ success: true, booking: newBooking });
});

app.patch('/api/bookings/:id/status', async (req, res) => {
  const { id } = req.params; const { status } = req.body || {};
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ success: false, error: 'حالة غير صحيحة' });
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try { await tursoClient.execute({ sql: 'UPDATE bookings SET status = ? WHERE id = ?', args: [status, id] }); return res.json({ success: true }); }
    catch (e) { console.error(e); return res.status(500).json({ success: false, error: 'تعذر تحديث الحالة' }); }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const b = memoryBookings.find(x => x.id === id); if (!b) return res.status(404).json({ success: false, error: 'الحجز غير موجود' }); b.status = status; return res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
  const pin = String(req.body?.pin || '');
  const correctPin = String(process.env.ADMIN_PIN || '');
  if (!correctPin) return res.status(503).json({ success: false, error: 'تسجيل دخول الإدارة غير مُعدّ بعد' });
  return pin === correctPin ? res.json({ success: true }) : res.status(401).json({ success: false, error: 'رمز المرور غير صحيح' });
});

app.get('/api/reviews', async (req, res) => {
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try { const r = await tursoClient.execute('SELECT * FROM reviews ORDER BY created_at DESC'); return res.json({ success: true, reviews: r.rows.map(mapReview) }); }
    catch (e) { console.error(e); return res.status(500).json({ success: false, error: 'تعذر تحميل التقييمات' }); }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  return res.json({ success: true, reviews: memoryReviews });
});

app.post('/api/reviews/verify', async (req, res) => {
  const q = String(req.body?.codeOrPhone || '').trim().toLowerCase();
  if (!q) return res.status(400).json({ success: false, eligible: false, message: 'أدخل رمز الحجز أو رقم الهاتف' });
  let found = [];
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try { const r = await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE LOWER(booking_code) = ? OR phone = ?', args: [q, q] }); found = r.rows.map(mapBooking); }
    catch (e) { console.error(e); return res.status(500).json({ success: false, eligible: false, message: 'تعذر التحقق حالياً' }); }
  } else if (!isProduction) found = memoryBookings.filter(b => b.bookingCode.toLowerCase() === q || b.phone === q);
  const completed = found.find(b => b.status === 'completed');
  if (completed) return res.json({ success: true, eligible: true, booking: completed });
  return res.json({ success: false, eligible: false, message: 'لم يتم العثور على حجز مكتمل بهذا الرمز' });
});

app.post('/api/reviews', async (req, res) => {
  const { bookingId, rating, comment } = req.body || {};
  const cleanComment = String(comment || '').trim();
  const numericRating = Number(rating);
  if (!bookingId || !cleanComment || numericRating < 1 || numericRating > 5) return res.status(400).json({ success: false, error: 'بيانات التقييم غير مكتملة' });

  let booking = null;
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try { const r = await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] }); booking = mapBooking(r.rows[0]); }
    catch (e) { console.error(e); return res.status(500).json({ success: false, error: 'تعذر التحقق من الحجز' }); }
  } else if (!isProduction) booking = memoryBookings.find(b => b.id === bookingId);
  if (!booking || booking.status !== 'completed') return res.status(403).json({ success: false, error: 'يمكن تقييم الحجوزات المكتملة فقط' });

  const newRev = { id: 'rev-' + Date.now(), bookingId: booking.id, bookingCode: booking.bookingCode, customerName: booking.customerName, serviceName: booking.serviceName, rating: numericRating, comment: cleanComment, date: localDate(), createdAt: new Date().toISOString() };
  if (tursoClient) {
    try {
      const dup = await tursoClient.execute({ sql: 'SELECT id FROM reviews WHERE booking_id = ? LIMIT 1', args: [booking.id] });
      if (dup.rows.length) return res.status(409).json({ success: false, error: 'تم إرسال تقييم لهذا الحجز مسبقاً' });
      await tursoClient.execute({ sql: `INSERT INTO reviews (id, booking_id, booking_code, customer_name, service_name, rating, comment, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [newRev.id, newRev.bookingId, newRev.bookingCode, newRev.customerName, newRev.serviceName, newRev.rating, newRev.comment, newRev.date, newRev.createdAt] });
    } catch (e) { console.error(e); return res.status(500).json({ success: false, error: 'تعذر حفظ التقييم' }); }
  } else { memoryReviews.unshift(newRev); }
  return res.status(201).json({ success: true, review: newRev });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

if (!isProduction) app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;
