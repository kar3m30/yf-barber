const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
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
  'hair-beard': { name: 'باقة يوسف فاروق (شعر + لحية)', price: 150, duration: 45 },
  'haircut': { name: 'قص وتصفيف شعر كلاسيكي', price: 100, duration: 30 },
  'beard-sculpt': { name: 'تحديد ونحت اللحية بالفوطة الساخنة', price: 80, duration: 25 },
  'royal-facial': { name: 'جلسة تنظيف بشرة وماسك الذهب', price: 220, duration: 30 },
};

const VALID_STATUSES = new Set(['confirmed', 'in_chair', 'completed', 'cancelled']);

// ===== Admin authentication =====
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_SESSION_SECRET = String(
  process.env.ADMIN_SESSION_SECRET ||
  process.env.TURSO_AUTH_TOKEN ||
  'YF-Barber-Admin-Session-Secret-2026'
);
const memoryAdminUsers = [];

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('utf8');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeSession(username, role, name) {
  const payload = JSON.stringify({ username, role, name: String(name || username), exp: Date.now() + ADMIN_SESSION_TTL_MS });
  const body = base64Url(payload);
  const signature = base64Url(crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(body).digest());
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  try {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = base64Url(crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(body).digest());
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromBase64Url(body));
    if (!payload?.username || !payload?.role || Number(payload.exp) < Date.now()) return null;
    return { username: String(payload.username), role: String(payload.role), name: String(payload.name || payload.username) };
  } catch {
    return null;
  }
}

function getAdminFromRequest(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  return verifySessionToken(header.slice(7).trim());
}

function auth(req, res, next) {
  const admin = getAdminFromRequest(req);
  if (!admin) return res.status(401).json({ success: false, error: 'جلسة الإدارة منتهية أو غير صالحة' });
  req.admin = admin;
  next();
}

function ownerOnly(req, res, next) {
  if (req.admin?.role !== 'owner' || req.admin?.username !== 'karem.01') {
    return res.status(403).json({ success: false, error: 'هذا الإجراء متاح لمالك النظام فقط' });
  }
  next();
}

async function getAdminUser(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (tursoClient) {
    const r = await tursoClient.execute({
      sql: 'SELECT id, username, name, role, active, password_hash, created_at FROM admin_users WHERE username=? LIMIT 1',
      args: [normalized]
    });
    return r.rows[0] || null;
  }
  return memoryAdminUsers.find(u => u.username === normalized) || null;
}

async function listAdminUsers() {
  if (tursoClient) {
    const r = await tursoClient.execute({
      sql: "SELECT id, username, name, role, active, last_login_at, created_at FROM admin_users ORDER BY COALESCE(created_at, last_login_at, '') ASC, username ASC"
    });
    return r.rows.map(row => ({
      ...row,
      id: String(row.id || ''),
      username: String(row.username || '').toLowerCase(),
      name: String(row.name || row.username || 'إداري'),
      role: String(row.role || 'admin'),
      active: Number(row.active) ? 1 : 0,
      last_login_at: row.last_login_at || null,
      created_at: row.created_at || null
    }));
  }
  return memoryAdminUsers.map(({ password_hash, ...u }) => u);
}

function adminPublicUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role, active: Number(user.active) ? 1 : 0, lastLoginAt: user.last_login_at ?? user.lastLoginAt ?? null };
}

async function seedOwnerAdmin() {
  const ownerUsername = 'karem.01';
  const ownerName = 'Karem';
  const ownerPassword = String(process.env.OWNER_ADMIN_PASSWORD || '02169.0');
  const existing = await getAdminUser(ownerUsername);
  if (existing) {
    // Keep the existing owner account and make sure the requested owner password is usable.
    if (!verifyPassword(ownerPassword, existing.password_hash)) {
      const passwordHash = hashPassword(ownerPassword);
      if (tursoClient) {
        await tursoClient.execute({ sql: 'UPDATE admin_users SET password_hash=?, active=1, role=\'owner\' WHERE username=?', args: [passwordHash, ownerUsername] });
      } else {
        existing.password_hash = passwordHash;
        existing.active = 1;
        existing.role = 'owner';
      }
    }
    return;
  }
  const user = {
    id: 'admin-owner-karem-01',
    username: ownerUsername,
    name: ownerName,
    role: 'owner',
    active: 1,
    password_hash: hashPassword(ownerPassword),
    last_login_at: null,
    created_at: new Date().toISOString()
  };
  if (tursoClient) {
    await tursoClient.execute({
      sql: 'INSERT INTO admin_users (id, username, name, role, active, password_hash, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [user.id, user.username, user.name, user.role, user.active, user.password_hash, user.last_login_at, user.created_at]
    });
  } else {
    memoryAdminUsers.push(user);
  }
}

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
    barberName: row.barber_name ?? row.barberName ?? null,
    date: row.date,
    timeSlot: row.time_slot ?? row.timeSlot,
    slotNumber: Number(row.slot_number ?? row.slotNumber ?? row.slot ?? 1),
    queueNumber: Number(row.queue_number ?? row.queueNumber ?? row.queue ?? 0),
    status: row.status,
    notes: row.notes || '',
    calledByUserId: row.called_by_user_id ?? row.calledByUserId ?? null,
    calledByUsername: row.called_by_username ?? row.calledByUsername ?? null,
    calledByName: row.called_by_name ?? row.calledByName ?? null,
    calledAt: row.called_at ?? row.calledAt ?? null,
    servedByUserId: row.served_by_user_id ?? row.servedByUserId ?? null,
    servedByUsername: row.served_by_username ?? row.servedByUsername ?? null,
    servedByName: row.served_by_name ?? row.servedByName ?? null,
    servedAt: row.served_at ?? row.servedAt ?? null,
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
    date: row.date,
    timeSlot: row.time,
    slotNumber: Number(row.slot || 1),
    queueNumber: Number(row.queue || 0),
    status,
    notes: '',
    calledByUserId: row.called_by_user_id ?? null,
    calledByUsername: row.called_by_username ?? null,
    calledByName: row.called_by_name ?? null,
    calledAt: row.called_at ?? null,
    servedByUserId: row.served_by_user_id ?? null,
    servedByUsername: row.served_by_username ?? null,
    servedByName: row.served_by_name ?? null,
    servedAt: row.served_at ?? null,
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
      await seedOwnerAdmin();
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
      called_by_user_id TEXT,
      called_by_username TEXT,
      called_by_name TEXT,
      called_at TEXT,
      served_by_user_id TEXT,
      served_by_username TEXT,
      served_by_name TEXT,
      served_at TEXT,
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
    await tursoClient.execute(`CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT NOT NULL,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );`);

    // Add staff attribution columns to existing booking records without replacing the Turso table.
    const bookingInfo = await tursoClient.execute('PRAGMA table_info(bookings)');
    const bookingColumns = new Set(bookingInfo.rows.map(r => String(r.name)));
    const addBookingColumn = async (name, definition) => {
      if (!bookingColumns.has(name)) {
        await tursoClient.execute(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);
        bookingColumns.add(name);
      }
    };
    await addBookingColumn('called_by_user_id', 'TEXT');
    await addBookingColumn('called_by_username', 'TEXT');
    await addBookingColumn('called_by_name', 'TEXT');
    await addBookingColumn('called_at', 'TEXT');
    await addBookingColumn('served_by_user_id', 'TEXT');
    await addBookingColumn('served_by_username', 'TEXT');
    await addBookingColumn('served_by_name', 'TEXT');
    await addBookingColumn('served_at', 'TEXT');

    // Safely migrate older admin_users tables used by previous deployments.
    const adminInfo = await tursoClient.execute('PRAGMA table_info(admin_users)');
    const adminColumns = new Set(adminInfo.rows.map(r => String(r.name)));
    const addAdminColumn = async (name, definition) => {
      if (!adminColumns.has(name)) {
        await tursoClient.execute(`ALTER TABLE admin_users ADD COLUMN ${name} ${definition}`);
        adminColumns.add(name);
      }
    };
    await addAdminColumn('id', 'TEXT');
    await addAdminColumn('username', 'TEXT');
    await addAdminColumn('name', 'TEXT');
    await addAdminColumn('role', "TEXT DEFAULT 'admin'");
    await addAdminColumn('active', 'INTEGER DEFAULT 1');
    await addAdminColumn('password_hash', 'TEXT');
    await addAdminColumn('last_login_at', 'TEXT');
    await addAdminColumn('created_at', 'TEXT');

    // Fill missing timestamps on legacy rows so ordering/activity never fails.
    try {
      await tursoClient.execute({
        sql: "UPDATE admin_users SET created_at = COALESCE(created_at, last_login_at, ?) WHERE created_at IS NULL OR created_at = ''",
        args: [new Date().toISOString()]
      });
    } catch (migrationError) {
      console.warn('Could not backfill admin_users.created_at:', migrationError.message);
    }

    const info = await tursoClient.execute('PRAGMA table_info(bookings)');
    const columns = new Set(info.rows.map(r => String(r.name)));
    bookingSchema = (columns.has('name') || columns.has('time') || columns.has('queue') || columns.has('token')) ? 'legacy' : 'current';
    if (bookingSchema === 'legacy') await ensureLegacySlotColumn();
    else await ensureCurrentSlotColumn();
    await seedOwnerAdmin();
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
      const bookings = result.rows.map(mapBooking).filter(b => b.status !== 'cancelled');
      const admin = getAdminFromRequest(req);
      if (admin) return res.json({ success: true, bookings });
      return res.json({ success: true, bookings: bookings.map(b => ({ date: b.date, timeSlot: b.timeSlot, status: b.status })) });
    } catch (e) {
      console.error('GET /api/bookings error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحميل المواعيد حالياً' });
    }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const bookings = memoryBookings.filter(b => b.date === targetDate && b.status !== 'cancelled');
  const admin = getAdminFromRequest(req);
  return res.json({ success: true, bookings: admin ? bookings : bookings.map(b => ({ date: b.date, timeSlot: b.timeSlot, status: b.status })) });
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
            date: cleanDate, timeSlot: cleanTime, slotNumber: slot,
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
          args: [id, bookingCode, cleanName, cleanPhone, serviceId, service.name, service.price, service.duration, null, cleanDate, cleanTime, slotNumber, queueNumber, String(notes || '').trim(), createdAt]
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
  const newBooking = { id: 'book-' + Date.now(), bookingCode: 'YF-' + Math.floor(1000 + Math.random() * 9000), token: 'tok-' + Date.now(), customerName: cleanName, phone: cleanPhone, serviceId, serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration, date: cleanDate, timeSlot: cleanTime, slotNumber: existing.length + 1, queueNumber: memoryBookings.filter(b => b.date === cleanDate && b.status !== 'cancelled').length + 1, status: 'confirmed', notes: String(notes || '').trim(), createdAt: new Date().toISOString() };
  memoryBookings.push(newBooking);
  return res.status(201).json({ success: true, booking: newBooking });
});

app.patch('/api/bookings/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ success: false, error: 'حالة غير صحيحة' });

  const now = new Date().toISOString();
  const actor = {
    userId: req.admin?.username || null,
    username: req.admin?.username || null,
    name: req.admin?.name || req.admin?.username || null,
  };

  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const current = bookingSchema === 'legacy'
        ? (await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE id = ? OR token = ? LIMIT 1', args: [id, id] })).rows[0]
        : (await tursoClient.execute({ sql: 'SELECT * FROM bookings WHERE id = ? LIMIT 1', args: [id] })).rows[0];
      if (!current) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });

      const dbStatus = bookingSchema === 'legacy'
        ? ({ confirmed: 'waiting', in_chair: 'serving', completed: 'done', cancelled: 'cancelled' }[status] || status)
        : status;
      const whereSql = bookingSchema === 'legacy' ? 'id = ? OR token = ?' : 'id = ?';
      const whereArgs = bookingSchema === 'legacy' ? [id, id] : [id];

      if (status === 'in_chair') {
        // لا نسمح بأكثر من عميل واحد على الكرسي في نفس الوقت.
        const servingSql = bookingSchema === 'legacy'
          ? 'SELECT id FROM bookings WHERE date=? AND status=? AND (id<>? AND token<>?) LIMIT 1'
          : 'SELECT id FROM bookings WHERE date=? AND status=? AND id<>? LIMIT 1';
        const servingArgs = bookingSchema === 'legacy'
          ? [current.date, 'serving', current.id, current.token]
          : [current.date, 'in_chair', current.id];
        const serving = await tursoClient.execute({ sql: servingSql, args: servingArgs });
        if (serving.rows[0]) return res.status(409).json({ success: false, error: 'يوجد عميل آخر على الكرسي حالياً' });

        const sql = bookingSchema === 'legacy'
          ? `UPDATE bookings SET status=?, called_by_user_id=?, called_by_username=?, called_by_name=?, called_at=? WHERE ${whereSql}`
          : `UPDATE bookings SET status=?, called_by_user_id=?, called_by_username=?, called_by_name=?, called_at=? WHERE ${whereSql}`;
        await tursoClient.execute({ sql, args: [dbStatus, actor.userId, actor.username, actor.name, now, ...whereArgs] });
      } else if (status === 'completed') {
        const sql = `UPDATE bookings SET status=?, served_by_user_id=?, served_by_username=?, served_by_name=?, served_at=? WHERE ${whereSql}`;
        await tursoClient.execute({ sql, args: [dbStatus, actor.userId, actor.username, actor.name, now, ...whereArgs] });
      } else {
        await tursoClient.execute({ sql: `UPDATE bookings SET status=? WHERE ${whereSql}`, args: [dbStatus, ...whereArgs] });
      }

      return res.json({ success: true, status });
    } catch (e) {
      console.error('PATCH /api/bookings/:id/status error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحديث حالة الحجز' });
    }
  }

  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const b = memoryBookings.find(x => x.id === id || x.token === id);
  if (!b) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
  if (status === 'in_chair' && memoryBookings.some(x => x.date === b.date && x.status === 'in_chair' && x.id !== b.id)) {
    return res.status(409).json({ success: false, error: 'يوجد عميل آخر على الكرسي حالياً' });
  }
  b.status = status;
  if (status === 'in_chair') {
    b.calledByUserId = actor.userId; b.calledByUsername = actor.username; b.calledByName = actor.name; b.calledAt = now;
  }
  if (status === 'completed') {
    b.servedByUserId = actor.userId; b.servedByUsername = actor.username; b.servedByName = actor.name; b.servedAt = now;
  }
  return res.json({ success: true, status });
});

app.get('/api/queue', async (req, res) => {
  const targetDate = String(req.query.date || localDate()).trim();
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const sql = bookingSchema === 'legacy'
        ? 'SELECT queue, status FROM bookings WHERE date=? AND status<>? ORDER BY queue ASC'
        : 'SELECT queue_number, status FROM bookings WHERE date=? AND status<>? ORDER BY queue_number ASC';
      const result = await tursoClient.execute({ sql, args: [targetDate, bookingSchema === 'legacy' ? 'cancelled' : 'cancelled'] });
      return res.json({
        success: true,
        bookings: result.rows.map(row => ({
          queueNumber: Number(row.queue_number ?? row.queue ?? 0),
          status: (String(row.status || '').toLowerCase() === 'waiting' ? 'confirmed' : String(row.status || '').toLowerCase() === 'serving' ? 'in_chair' : String(row.status || '').toLowerCase() === 'done' ? 'completed' : row.status)
        }))
      });
    } catch (e) {
      console.error('GET /api/queue error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحميل الدور حالياً' });
    }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  return res.json({ success: true, bookings: memoryBookings.filter(b => b.date === targetDate && b.status !== 'cancelled').map(b => ({ queueNumber: Number(b.queueNumber || 0), status: b.status })) });
});

app.get('/api/admin/activity', auth, ownerOnly, async (req, res) => {
  const targetDate = String(req.query.date || localDate()).trim();
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    try {
      const users = await listAdminUsers();
      const sql = bookingSchema === 'legacy'
        ? 'SELECT * FROM bookings WHERE date=? ORDER BY queue ASC, slot ASC'
        : 'SELECT * FROM bookings WHERE date=? ORDER BY queue_number ASC';
      const result = await tursoClient.execute({ sql, args: [targetDate] });
      const bookings = result.rows.map(mapBooking);
      const activity = users.map(user => {
        const calls = bookings.filter(b => String(b.calledByUserId || '') === String(user.id || '') || String(b.calledByUsername || '').toLowerCase() === String(user.username || '').toLowerCase());
        const services = bookings.filter(b => String(b.servedByUserId || '') === String(user.id || '') || String(b.servedByUsername || '').toLowerCase() === String(user.username || '').toLowerCase());
        const timestamps = [
          user.last_login_at,
          ...calls.map(b => b.calledAt),
          ...services.map(b => b.servedAt)
        ].filter(Boolean).map(v => new Date(v).getTime()).filter(Number.isFinite);
        const lastActivityAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
        return {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          active: Number(user.active) ? 1 : 0,
          callsToday: calls.length,
          servicesToday: services.length,
          lastActivityAt,
          lastLoginAt: user.last_login_at || null
        };
      });
      return res.json({ success: true, date: targetDate, users: activity });
    } catch (e) {
      console.error('Admin activity error:', e);
      return res.status(500).json({ success: false, error: 'تعذر تحميل نشاط المشرفين' });
    }
  }
  if (isProduction) return res.status(503).json({ success: false, error: 'قاعدة البيانات غير متاحة حالياً' });
  const users = await listAdminUsers();
  const bookings = memoryBookings.filter(b => b.date === targetDate);
  const activity = users.map(user => {
    const calls = bookings.filter(b => String(b.calledByUserId || '') === String(user.id || '') || String(b.calledByUsername || '').toLowerCase() === String(user.username || '').toLowerCase());
    const services = bookings.filter(b => String(b.servedByUserId || '') === String(user.id || '') || String(b.servedByUsername || '').toLowerCase() === String(user.username || '').toLowerCase());
    const timestamps = [user.last_login_at, ...calls.map(b => b.calledAt), ...services.map(b => b.servedAt)].filter(Boolean).map(v => new Date(v).getTime()).filter(Number.isFinite);
    return { id:user.id, username:user.username, name:user.name, role:user.role, active:Number(user.active)?1:0, callsToday:calls.length, servicesToday:services.length, lastActivityAt:timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null, lastLoginAt:user.last_login_at || null };
  });
  return res.json({ success: true, date: targetDate, users: activity });
});

app.get('/api/health', async (req, res) => {
  if (tursoClient) {
    if (!(await requireDb(res))) return;
    return res.json({ ok: true, database: 'turso', date: localDate() });
  }
  return res.json({ ok: true, database: isProduction ? 'unavailable' : 'memory', date: localDate() });
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(401).json({ success: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    if (tursoClient && !(await requireDb(res))) return;

    const user = await getAdminUser(username);
    if (!user || !Number(user.active) || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const loginAt = new Date().toISOString();
    if (tursoClient) {
      await tursoClient.execute({ sql: 'UPDATE admin_users SET last_login_at=? WHERE username=?', args: [loginAt, user.username] });
      user.last_login_at = loginAt;
    } else {
      user.last_login_at = loginAt;
    }
    const safeUser = adminPublicUser(user);
    return res.json({ success: true, token: makeSession(user.username, user.role, user.name), user: safeUser });
  } catch (e) {
    console.error('Admin login error:', e);
    return res.status(500).json({ success: false, error: 'تعذر تسجيل الدخول حالياً' });
  }
});

app.get('/api/admin/me', auth, async (req, res) => {
  try {
    if (tursoClient && !(await requireDb(res))) return;
    const user = await getAdminUser(req.admin.username);
    if (!user || !Number(user.active)) return res.status(401).json({ success: false, error: 'الحساب غير متاح' });
    res.json({ success: true, user: adminPublicUser(user) });
  } catch (e) {
    console.error('Admin me error:', e);
    res.status(500).json({ success: false, error: 'تعذر التحقق من الحساب' });
  }
});

app.get('/api/admin/users', auth, ownerOnly, async (req, res) => {
  try {
    if (tursoClient && !(await requireDb(res))) return;
    const users = await listAdminUsers();
    res.json({ success: true, users });
  } catch (e) {
    console.error('Admin users list error:', e);
    res.status(500).json({ success: false, error: 'تعذر تحميل حسابات الإدارة' });
  }
});

app.post('/api/admin/users', auth, ownerOnly, async (req, res) => {
  try {
    if (tursoClient && !(await requireDb(res))) return;
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ success: false, error: 'اسم المستخدم يجب أن يكون 3-40 حرفاً أو رقماً ويمكن أن يحتوي . _ -' });
    if (username === 'karem.01') return res.status(400).json({ success: false, error: 'هذا الاسم محجوز لمالك النظام' });
    if (name.length < 2 || name.length > 80) return res.status(400).json({ success: false, error: 'اكتب اسم الإداري بشكل صحيح' });
    if (password.length < 7 || password.length > 100) return res.status(400).json({ success: false, error: 'كلمة المرور يجب أن تكون 7 أحرف على الأقل' });

    const existing = await getAdminUser(username);
    if (existing) return res.status(409).json({ success: false, error: 'اسم المستخدم موجود بالفعل' });
    const user = {
      id: 'admin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      username, name, role: 'admin', active: 1, password_hash: hashPassword(password), last_login_at: null, created_at: new Date().toISOString()
    };
    if (tursoClient) {
      await tursoClient.execute({
        sql: 'INSERT INTO admin_users (id, username, name, role, active, password_hash, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [user.id, user.username, user.name, user.role, user.active, user.password_hash, user.last_login_at, user.created_at]
      });
    } else {
      memoryAdminUsers.push(user);
    }
    return res.status(201).json({ success: true, user: adminPublicUser(user) });
  } catch (e) {
    console.error('Admin user create error:', e);
    return res.status(500).json({ success: false, error: 'تعذر إضافة الإداري' });
  }
});

app.delete('/api/admin/users/:id', auth, ownerOnly, async (req, res) => {
  try {
    if (tursoClient && !(await requireDb(res))) return;
    const id = String(req.params.id || '');
    const target = tursoClient
      ? (await tursoClient.execute({ sql: 'SELECT id, username, role FROM admin_users WHERE id=? LIMIT 1', args: [id] })).rows[0]
      : memoryAdminUsers.find(u => u.id === id);
    if (!target) return res.status(404).json({ success: false, error: 'الحساب غير موجود' });
    if (target.role === 'owner' || target.username === 'karem.01') return res.status(403).json({ success: false, error: 'لا يمكن حذف مالك النظام' });
    if (tursoClient) await tursoClient.execute({ sql: 'DELETE FROM admin_users WHERE id=?', args: [id] });
    else { const idx = memoryAdminUsers.findIndex(u => u.id === id); if (idx >= 0) memoryAdminUsers.splice(idx, 1); }
    return res.json({ success: true });
  } catch (e) {
    console.error('Admin user delete error:', e);
    res.status(500).json({ success: false, error: 'تعذر حذف الإداري' });
  }
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
