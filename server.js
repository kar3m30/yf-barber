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
let bookingSchema = 'current';

function localDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mapBooking(row) {
  if (!row) return row;
  if (row.name != null && row.customer_name == null) return mapLegacyBooking(row);
  return {
    id: row.id ?? row.token ?? row.booking_code ?? '',
    token: row.token ?? row.token_id ?? '',
    bookingCode: row.booking_code ?? row.bookingCode ?? row.token ?? '',
    customerName: row.customer_name ?? row.customerName,
    phone: row.phone,
    serviceId: row.service_id ?? row.serviceId,
    serviceName: row.service_name ?? row.serviceName,
    servicePrice: Number(row.service_price ?? row.servicePrice ?? 0),
    serviceDuration: Number(row.service_duration ?? row.serviceDuration ?? 0),
    barberName: row.barber_name ?? row.barberName ?? 'يوسف فاروق',
    date: row.date,
    timeSlot: row.time_slot ?? row.timeSlot,
    slotNumber: Number(row.slot_number ?? row.slotNumber ?? row.slot ?? 1),
    queueNumber: Number(row.queue_number ?? row.queueNumber ?? row.queue ?? 0),
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

function isValidTimeSlot(timeSlot) {
  const target = String(timeSlot || '').trim();
  for (let minutes = 12 * 60; minutes <= 24 * 60 + 30; minutes += 30) {
    const normalized = minutes % (24 * 60);
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const hour12 = hour24 === 0 ? 12 : (hour24 > 12 ? hour24 - 12 : hour24);
    const period = hour24 >= 12 ? 'م' : 'ص';
    const slot = `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
    if (slot === target) return true;
  }
  return false;
}

function serviceFromLegacyName(value) {
  const name = String(value || '').trim();
  for (const [id, service] of Object.entries(SERVICES)) {
    if (service.name === name) return { id, ...service };
  }
  if (name.includes('شعر') && name.includes('لحية')) return { id: 'hair-beard', ...SERVICES['hair-beard'] };
  if (name.includes('لحية')) return { id: 'beard-sculpt', ...SERVICES['beard-sculpt'] };
  if (name.includes('شعر') || name.includes('تصفيف')) return { id: 'haircut', ...SERVICES['haircut'] };
  return { id: 'haircut', ...SERVICES['haircut'] };
}

function mapLegacyBooking(row) {
  const service = serviceFromLegacyName(row.service);
  const rawStatus = String(row.status || 'waiting').toLowerCase();
  const status = rawStatus === 'waiting' || rawStatus === 'pending' ? 'confirmed'
    : rawStatus === 'serving' || rawStatus === 'in_chair' ? 'in_chair'
    : rawStatus === 'done' || rawStatus === 'completed' ? 'completed'
    : rawStatus === 'cancelled' ? 'cancelled'
    : 'confirmed';
  return {
    id: row.id ?? row.token,
    token: row.token,
    bookingCode: row.token,
    customerName: row.name,
    phone: row.phone,
    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDuration: service.duration,
    barberName: 'يوسف فاروق',
    date: row.date,
    timeSlot: row.time,
    slotNumber: Number(row.slot || 1),
    queueNumber: Number(row.queue || 0),
    status,
    notes: '',
    createdAt: row.created_at,
  };
}

async function ensureCurrentSlotColumn() {
  const info = await tursoClient.execute('PRAGMA table_info(bookings)');
  const columns = new Set(info.rows.map(r => String(r.name)));
  if (!columns.has('slot_number')) {
    await tursoClient.execute("ALTER TABLE bookings ADD COLUMN slot_number INTEGER DEFAULT 1");
  }
  const rows = await tursoClient.execute("SELECT id,date,time_slot,status,slot_number FROM bookings ORDER BY date,time_slot,id");
  const counters = new Map();
  for (const row of rows.rows) {
    if (String(row.status || '').toLowerCase() === 'cancelled') continue;
    const key = `${row.date}\u0000${row.time_slot}`;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    if (Number(row.slot_number || 0) !== n) {
      await tursoClient.execute({ sql: 'UPDATE bookings SET slot_number=? WHERE id=?', args: [n, row.id] });
    }
  }
  await tursoClient.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot_current ON bookings(date,time_slot,slot_number) WHERE status <> 'cancelled'");
}

async function ensureLegacySlotColumn() {
  const info = await tursoClient.execute('PRAGMA table_info(bookings)');
  const columns = new Set(info.rows.map(r => String(r.name)));
  if (!columns.has('slot')) {
    await tursoClient.execute("ALTER TABLE bookings ADD COLUMN slot INTEGER DEFAULT 1");
  }

  // Normalize active legacy rows to slot 1, 2, ... for each date/time.
  const rows = await tursoClient.execute("SELECT id,date,time,status,slot FROM bookings ORDER BY date,time,id");
  const counters = new Map();
  for (const row of rows.rows) {
    if (String(row.status || '').toLowerCase() === 'cancelled') continue;
    const key = `${row.date}\u0000${row.time}`;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    if (Number(row.slot || 0) !== n) {
      await tursoClient.execute({ sql: 'UPDATE bookings SET slot=? WHERE id=?', args: [n, row.id] });
    }
  }
  await tursoClient.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot_legacy ON bookings(date,time,slot) WHERE status <> 'cancelled'");
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
      slot_number INTEGER DEFAULT 1,
      queue_number INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed',
      notes TEXT,
      created_at TEXT NOT NULL
    );`);
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

    const info = await tursoClient.execute('PRAGMA table_info(bookings)');
    const columns = new Set(info.rows.map(r => String(r.name)));
    bookingSchema = (columns.has('name') || columns.has('time') || columns.has('queue') || columns.has('token')) ? 'legacy' : 'current';
    if (bookingSchema === 'legacy') await ensureLegacySlotColumn();
    else await ensureCurrentSlotColumn();
  })();
  try { await dbReadyPromise; } catch (e) { dbReadyPromise = null; throw e; }
}

async function requireDb(res) {
  try { await ensureDatabase(); return true; }
  catch (e) { console.error('DB error:', e); res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' }); return false; }
}

app.get('/api/bookings', async (req, res) => {
  const targetDate = String(req.query.date || localDate()).trim();
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const sql = bookingSchema === 'legacy'
        ? 'SELECT * FROM bookings WHERE date = ? ORDER BY queue ASC, slot ASC'
        : 'SELECT * FROM bookings WHERE date = ? ORDER BY queue_number ASC';
      const result = await tursoClient.execute({ sql, args: [targetDate] });
      return res.json({ success: true, bookings: result.rows.map(mapBooking).filter(b => b.status !== 'cancelled') });
    } catch (e) {
      console.error('GET /api/bookings error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحميل المواعيد حالياً' });
    }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  return res.json({ success: true, bookings: memoryBookings.filter(b => b.date === targetDate && b.status !== 'cancelled') });
});

app.post('/api/bookings', async (req, res) => {
  const { customerName, phone, serviceId, date, timeSlot, notes } = req.body || {};
  const cleanName = String(customerName || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanDate = String(date || '').trim();
  const cleanTime = String(timeSlot || '').trim();

  if (!cleanName || !cleanPhone || !cleanDate || !cleanTime || !serviceId) {
    return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
  }
  const service = SERVICES[serviceId];
  if (!service) return res.status(400).json({ success: false, error: 'الخدمة غير صحيحة' });
  if (!isValidTimeSlot(cleanTime)) {
    return res.status(400).json({ success: false, error: 'الموعد غير متاح. اختر موعداً كل 30 دقيقة بين 12:00 ظهراً و12:30 صباحاً.' });
  }

  if (tursoClient) {
    if (!(await requireDb(res))) return;

    if (bookingSchema === 'legacy') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const token = 'tok-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        try {
          const slots = await tursoClient.execute({ sql: 'SELECT slot FROM bookings WHERE date=? AND time=? AND status<>? ORDER BY slot', args: [cleanDate, cleanTime, 'cancelled'] });
          const used = new Set(slots.rows.map(r => Number(r.slot)).filter(Boolean));
          const slot = !used.has(1) ? 1 : (!used.has(2) ? 2 : null);
          if (!slot) return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });

          const q = await tursoClient.execute({ sql: 'SELECT COALESCE(MAX(queue),0)+1 AS next_queue FROM bookings WHERE date=? AND status<>?', args: [cleanDate, 'cancelled'] });
          const queue = Number(q.rows[0]?.next_queue) || 1;
          const createdAt = new Date().toISOString();
          await tursoClient.execute({
            sql: 'INSERT INTO bookings(token,name,phone,service,date,time,slot,queue,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
            args: [token, cleanName, cleanPhone, service.name, cleanDate, cleanTime, slot, queue, 'waiting', createdAt]
          });
          return res.status(201).json({ success: true, booking: {
            id: token,
            token, bookingCode: token, customerName: cleanName, phone: cleanPhone,
            serviceId, serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration,
            barberName: 'يوسف فاروق', date: cleanDate, timeSlot: cleanTime, slotNumber: slot,
            queueNumber: queue, status: 'waiting', notes: String(notes || '').trim(), createdAt
          }});
        } catch (e) {
          const message = String(e.message || '').toLowerCase();
          if (message.includes('unique') || message.includes('constraint')) continue;
          console.error('Legacy booking insert error:', e);
          return res.status(500).json({ success: false, error: 'تعذر حفظ الحجز' });
        }
      }
      return res.status(409).json({ success: false, error: 'تعذر حجز الموعد الآن، حاول مرة أخرى' });
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      const id = 'book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const bookingCode = 'YF-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      const createdAt = new Date().toISOString();
      try {
        const slots = await tursoClient.execute({ sql: 'SELECT slot_number FROM bookings WHERE date=? AND time_slot=? AND status<>? ORDER BY slot_number', args: [cleanDate, cleanTime, 'cancelled'] });
        const used = new Set(slots.rows.map(r => Number(r.slot_number)).filter(Boolean));
        const slotNumber = !used.has(1) ? 1 : (!used.has(2) ? 2 : null);
        if (!slotNumber) return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });
        const q = await tursoClient.execute({ sql: 'SELECT COALESCE(MAX(queue_number),0)+1 AS next_queue FROM bookings WHERE date=? AND status<>?', args: [cleanDate, 'cancelled'] });
        const queueNumber = Number(q.rows[0]?.next_queue) || 1;
        const result = await tursoClient.execute({
          sql: `INSERT INTO bookings (id, booking_code, customer_name, phone, service_id, service_name, service_price, service_duration, barber_name, date, time_slot, slot_number, queue_number, status, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
          args: [id, bookingCode, cleanName, cleanPhone, serviceId, service.name, service.price, service.duration, 'يوسف فاروق', cleanDate, cleanTime, slotNumber, queueNumber, String(notes || '').trim(), createdAt]
        });
        void result;
        const fresh = await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [id] });
        return res.status(201).json({ success: true, booking: mapBooking(fresh.rows[0]) });
      } catch (e) {
        const message = String(e.message || '').toLowerCase();
        if (message.includes('unique') || message.includes('constraint')) continue;
        console.error('Booking insert error:', e);
        return res.status(500).json({ success: false, error: 'تعذر حفظ الحجز' });
      }
    }
    return res.status(409).json({ success: false, error: 'تعذر حجز الموعد الآن، حاول مرة أخرى' });
  }

  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const existing = memoryBookings.filter(b => b.date === cleanDate && b.timeSlot === cleanTime && b.status !== 'cancelled');
  if (existing.length >= 2) return res.status(409).json({ success: false, error: 'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)' });
  const newBooking = { id: 'book-' + Date.now(), bookingCode: 'YF-' + Math.floor(1000 + Math.random() * 9000), token: 'tok-' + Date.now(), customerName: cleanName, phone: cleanPhone, serviceId, serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration, barberName: 'يوسف فاروق', date: cleanDate, timeSlot: cleanTime, slotNumber: existing.length + 1, queueNumber: memoryBookings.filter(b => b.date === cleanDate && b.status !== 'cancelled').length + 1, status: 'confirmed', notes: String(notes || '').trim(), createdAt: new Date().toISOString() };
  memoryBookings.push(newBooking);
  return res.status(201).json({ success: true, booking: newBooking });
});

app.patch('/api/bookings/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ success: false, error: 'حالة غير صحيحة' });

  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const dbStatus = bookingSchema === 'legacy'
        ? ({ confirmed: 'waiting', in_chair: 'serving', completed: 'done', cancelled: 'cancelled' }[status] || status)
        : status;

      const result = bookingSchema === 'legacy'
        ? await tursoClient.execute({
            sql: 'UPDATE bookings SET status = ? WHERE id = ? OR token = ?',
            args: [dbStatus, id, id]
          })
        : await tursoClient.execute({
            sql: 'UPDATE bookings SET status = ? WHERE id = ?',
            args: [dbStatus, id]
          });

      if (!result.rowsAffected) {
        return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
      }
      return res.json({ success: true, status });
    } catch (e) {
      console.error('PATCH /api/bookings/:id/status error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحديث حالة الحجز' });
    }
  }

  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const b = memoryBookings.find(x => x.id === id);
  if (!b) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
  b.status = status;
  return res.json({ success: true, status });
});

app.get('/api/health', async (req, res) => {
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    return res.json({ ok: true, database: 'turso', date: localDate() });
  }
  return res.json({ ok: true, database: isProduction ? 'unavailable' : 'memory', date: localDate() });
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
    try { const r = bookingSchema === 'legacy'
      ? await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE LOWER(token) = ? OR phone = ?', args: [q, q] })
      : await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE LOWER(booking_code) = ? OR phone = ?', args: [q, q] }); found = r.rows.map(mapBooking); }
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
