const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   إعدادات الإدارة
========================= */

const ADMIN_USERNAME = 'karemadmin';
const ADMIN_PASSWORD = '011963';

const SESSION_SECRET = String(
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(
      'YF|' +
      ADMIN_USERNAME +
      '|' +
      ADMIN_PASSWORD +
      '|' +
      (process.env.TURSO_AUTH_TOKEN || '')
    )
    .digest('hex')
);

const SESSION_TTL = 1000 * 60 * 60 * 12;

/* =========================
   قاعدة البيانات
========================= */

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

async function run(sql, args = []) {
  return await db.execute({ sql, args });
}

async function get(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

async function all(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

/* =========================
   أدوات الحماية
========================= */

function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString('hex')
) {
  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString('hex');

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, expected] = String(stored).split(':');

    if (!salt || !expected) return false;

    const actual = crypto
      .scryptSync(String(password), salt, 64)
      .toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(actual, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

function makeSession(username, role) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      role,
      exp: Date.now() + SESSION_TTL
    })
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

function readSession(token) {
  try {
    const [payload, sig] = String(token).split('.');

    if (!payload || !sig) return null;

    const expected = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');

    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    if (!data.exp || data.exp < Date.now()) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/* =========================
   المواعيد والخدمات
========================= */

const validTimes = [
  '12:00 ظهرًا',
  '12:30 ظهرًا',
  '1:00 مساءً',
  '1:30 مساءً',
  '2:00 مساءً',
  '2:30 مساءً',
  '3:00 مساءً',
  '3:30 مساءً',
  '4:00 مساءً',
  '4:30 مساءً',
  '5:00 مساءً',
  '5:30 مساءً',
  '6:00 مساءً',
  '6:30 مساءً',
  '7:00 مساءً',
  '7:30 مساءً',
  '8:00 مساءً',
  '8:30 مساءً',
  '9:00 مساءً',
  '9:30 مساءً',
  '10:00 مساءً',
  '10:30 مساءً',
  '11:00 مساءً',
  '11:30 مساءً',
  '12:00 منتصف الليل',
  '12:30 بعد منتصف الليل'
];

const services = {
  signature: 'الحلاقة والتشذيب المميز',
  classic: 'الحلاقة الكلاسيكية',
  beard: 'تهذيب اللحية الملكية'
};

function makeId() {
  return (
    '#YF' +
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
}

function makeToken() {
  return crypto.randomUUID();
}/* =========================
   تهيئة قاعدة البيانات
========================= */

async function init() {
  await run(`
    CREATE TABLE IF NOT EXISTS bookings(
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      queue INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL
    )
  `);

  // إضافة عمود slot إذا كان غير موجود في قاعدة البيانات القديمة
  const columns = await all(`PRAGMA table_info(bookings)`);
  const hasSlot = columns.some(c => c.name === 'slot');

  if (!hasSlot) {
    await run(`ALTER TABLE bookings ADD COLUMN slot INTEGER`);

    // توزيع الحجوزات القديمة على خانات 1 و2 حسب وقت الإنشاء
    const oldBookings = await all(`
      SELECT id, date, time
      FROM bookings
      ORDER BY date ASC, time ASC, created_at ASC
    `);

    const counters = {};

    for (const booking of oldBookings) {
      const key = `${booking.date}|${booking.time}`;
      counters[key] = (counters[key] || 0) + 1;

      await run(
        `UPDATE bookings SET slot=? WHERE id=?`,
        [counters[key], booking.id]
      );
    }
  }

  await run(`
    CREATE INDEX IF NOT EXISTS idx_bookings_date_queue
    ON bookings(date, queue)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_bookings_date_time
    ON bookings(date, time)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_bookings_date_time_slot
    ON bookings(date, time, slot)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS admin_users(
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // إنشاء أو تحديث حساب المالك الرئيسي
  const adminUsername = 'karemadmin';
  const adminPassword = '011963';

  const existing = await get(
    `SELECT id FROM admin_users WHERE username=?`,
    [adminUsername]
  );

  if (!existing) {
    await run(
      `
      INSERT INTO admin_users(
        id,
        username,
        name,
        password_hash,
        role,
        active,
        created_at
      )
      VALUES(?,?,?,?,?,?,?)
      `,
      [
        crypto.randomUUID(),
        adminUsername,
        'المالك',
        hashPassword(adminPassword),
        'owner',
        1,
        new Date().toISOString()
      ]
    );

    console.log('Initial admin created: karemadmin');
  } else {
    await run(
      `
      UPDATE admin_users
      SET
        password_hash=?,
        role='owner',
        active=1
      WHERE username=?
      `,
      [
        hashPassword(adminPassword),
        adminUsername
      ]
    );
  }
}


/* =========================
   حماية لوحة الإدارة
========================= */

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : '';

    const session = readSession(token);

    if (!session) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const user = await get(
      `
      SELECT
        id,
        username,
        name,
        role,
        active
      FROM admin_users
      WHERE username=?
      `,
      [session.username]
    );

    if (!user || !Number(user.active)) {
      return res.status(401).json({
        error: 'الحساب غير فعال'
      });
    }

    req.admin = user;
    next();

  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: 'تعذر التحقق من جلسة الإدارة'
    });
  }
}


function ownerOnly(req, res, next) {
  if (req.admin?.role !== 'owner') {
    return res.status(403).json({
      error: 'هذه العملية للمالك فقط'
    });
  }

  next();
}


/* =========================
   تسجيل دخول الإدارة
========================= */

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = String(
      req.body.username || ''
    ).trim().toLowerCase();

    const password = String(
      req.body.password || ''
    );

    if (!username || !password) {
      return res.status(401).json({
        error: 'بيانات الدخول غير صحيحة'
      });
    }

    const user = await get(
      `
      SELECT
        id,
        username,
        name,
        role,
        active,
        password_hash
      FROM admin_users
      WHERE username=?
      `,
      [username]
    );

    if (
      !user ||
      !Number(user.active) ||
      !verifyPassword(password, user.password_hash)
    ) {
      return res.status(401).json({
        error: 'اسم المستخدم أو كلمة المرور غير صحيحة'
      });
    }

    const token = makeSession(
      user.username,
      user.role
    );

    res.json({
      token,
      user: {
        username: user.username,
        name: user.name,
        role: user.role
      }
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر تسجيل الدخول'
    });
  }
});


/* =========================
   بيانات المستخدم الحالي
========================= */

app.get('/api/admin/me', auth, (req, res) => {
  res.json({
    user: req.admin
  });
});


/* =========================
   مستخدمو لوحة الإدارة
========================= */

app.get(
  '/api/admin/users',
  auth,
  ownerOnly,
  async (req, res) => {
    try {
      const users = await all(`
        SELECT
          id,
          username,
          name,
          role,
          active,
          created_at
        FROM admin_users
        ORDER BY created_at ASC
      `);

      res.json({
        users
      });

    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر تحميل مستخدمي الإدارة'
      });
    }
  }
);


app.post(
  '/api/admin/users',
  auth,
  ownerOnly,
  async (req, res) => {
    try {
      const username = String(
        req.body.username || ''
      ).trim().toLowerCase();

      const name = String(
        req.body.name || ''
      ).trim();

      const password = String(
        req.body.password || ''
      );

      if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
        return res.status(400).json({
          error:
            'اسم المستخدم يجب أن يكون 3-40 حرفًا إنجليزيًا أو أرقامًا أو . _ -'
        });
      }

      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({
          error: 'اكتب اسمًا صحيحًا'
        });
      }

      if (password.length < 8 || password.length > 100) {
        return res.status(400).json({
          error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'
        });
      }

      const exists = await get(
        `SELECT id FROM admin_users WHERE username=?`,
        [username]
      );

      if (exists) {
        return res.status(409).json({
          error: 'اسم المستخدم موجود بالفعل'
        });
      }

      const user = {
        id: crypto.randomUUID(),
        username,
        name,
        password_hash: hashPassword(password),
        role: 'admin',
        active: 1,
        created_at: new Date().toISOString()
      };

      await run(
        `
        INSERT INTO admin_users(
          id,
          username,
          name,
          password_hash,
          role,
          active,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)
        `,
        [
          user.id,
          user.username,
          user.name,
          user.password_hash,
          user.role,
          user.active,
          user.created_at
        ]
      );

      res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          active: user.active,
          created_at: user.created_at
        }
      });

    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر إضافة المستخدم'
      });
    }
  }
);


app.patch(
  '/api/admin/users/:id',
  auth,
  ownerOnly,
  async (req, res) => {
    try {
      const user = await get(
        `
        SELECT
          id,
          username,
          name,
          role,
          active
        FROM admin_users
        WHERE id=?
        `,
        [req.params.id]
      );

      if (!user) {
        return res.status(404).json({
          error: 'المستخدم غير موجود'
        });
      }

      if (user.role === 'owner') {
        return res.status(400).json({
          error: 'لا يمكن تعطيل حساب المالك من هنا'
        });
      }

      const active =
        req.body.active === true ||
        req.body.active === 1 ||
        req.body.active === '1';

      await run(
        `UPDATE admin_users SET active=? WHERE id=?`,
        [
          active ? 1 : 0,
          user.id
        ]
      );

      res.json({
        ok: true
      });

    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر تعديل المستخدم'
      });
    }
  }
);


app.delete(
  '/api/admin/users/:id',
  auth,
  ownerOnly,
  async (req, res) => {
    try {
      const user = await get(
        `
        SELECT id, role
        FROM admin_users
        WHERE id=?
        `,
        [req.params.id]
      );

      if (!user) {
        return res.status(404).json({
          error: 'المستخدم غير موجود'
        });
      }

      if (user.role === 'owner') {
        return res.status(400).json({
          error: 'لا يمكن حذف حساب المالك'
        });
      }

      await run(
        `DELETE FROM admin_users WHERE id=?`,
        [user.id]
      );

      res.json({
        ok: true
      });

    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر حذف المستخدم'
      });
    /* =========================
   الدور المباشر
========================= */

app.get('/api/queue', async (req, res) => {
  try {
    const date = String(req.query.date || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'تاريخ غير صحيح'
      });
    }

    const rows = await all(
      `
      SELECT
        token,
        date,
        time,
        queue,
        status
      FROM bookings
      WHERE date=?
      ORDER BY queue ASC
      `,
      [date]
    );

    res.json({
      bookings: rows
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر تحديث الدور'
    });
  }
});


/* =========================
   حجوزات الإدارة
========================= */

app.get('/api/bookings', auth, async (req, res) => {
  try {
    const date = String(req.query.date || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'تاريخ غير صحيح'
      });
    }

    const rows = await all(
      `
      SELECT *
      FROM bookings
      WHERE date=?
      ORDER BY queue ASC
      `,
      [date]
    );

    res.json({
      bookings: rows
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر تحميل الحجوزات'
    });
  }
});


/* =========================
   قراءة حجز بواسطة QR
========================= */

app.get('/api/bookings/token/:token', async (req, res) => {
  try {
    const booking = await get(
      `
      SELECT
        id,
        token,
        name,
        phone,
        service,
        date,
        time,
        queue,
        slot,
        status,
        created_at
      FROM bookings
      WHERE token=?
      `,
      [req.params.token]
    );

    if (!booking) {
      return res.status(404).json({
        error: 'الحجز غير موجود'
      });
    }

    // مهم: نرجع الحجز مباشرة
    // وليس { booking: ... }
    res.json(booking);

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر قراءة الحجز'
    });
  }
});


/* =========================
   قراءة حجز للادمن بواسطة QR
========================= */

app.get(
  '/api/admin/bookings/token/:token',
  auth,
  async (req, res) => {
    try {
      const booking = await get(
        `
        SELECT *
        FROM bookings
        WHERE token=?
        `,
        [req.params.token]
      );

      if (!booking) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      // مهم للماسح في لوحة الإدارة
      res.json(booking);

    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر قراءة الحجز'
      });
    }
  }
);


/* =========================
   إنشاء حجز جديد
   الحد الأقصى شخصان لنفس
   التاريخ + الوقت
========================= */

app.post('/api/bookings', async (req, res) => {
  try {
    const name = String(
      req.body.name || ''
    ).trim();

    const phone = String(
      req.body.phone || ''
    ).trim();

    const date = String(
      req.body.date || ''
    );

    const time = String(
      req.body.time || ''
    );

    const serviceKey = String(
      req.body.serviceKey || ''
    );

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        error: 'اكتب اسم العميل بشكل صحيح'
      });
    }

    if (!/^[0-9+()\-\s]{8,20}$/.test(phone)) {
      return res.status(400).json({
        error: 'رقم الموبايل غير صحيح'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'التاريخ غير صحيح'
      });
    }

    if (!validTimes.includes(time)) {
      return res.status(400).json({
        error: 'الموعد غير متاح'
      });
    }

    if (!services[serviceKey]) {
      return res.status(400).json({
        error: 'الخدمة غير صحيحة'
      });
    }


    /* -------------------------
       فحص الخانتين
    ------------------------- */

    const existingSlots = await all(
      `
      SELECT slot
      FROM bookings
      WHERE date=?
        AND time=?
        AND status <> 'cancelled'
      ORDER BY slot ASC
      `,
      [date, time]
    );

    const usedSlots = existingSlots
      .map(row => Number(row.slot))
      .filter(slot => slot === 1 || slot === 2);

    let slot = null;

    if (!usedSlots.includes(1)) {
      slot = 1;
    } else if (!usedSlots.includes(2)) {
      slot = 2;
    } else {
      return res.status(409).json({
        error: 'هذا الموعد مكتمل. اختر وقتًا آخر.'
      });
    }


    /* -------------------------
       رقم الدور لذلك اليوم
    ------------------------- */

    const queueRow = await get(
      `
      SELECT COALESCE(MAX(queue), 0) + 1 AS q
      FROM bookings
      WHERE date=?
      `,
      [date]
    );

    const booking = {
      id: makeId(),
      token: makeToken(),
      name,
      phone,
      service: services[serviceKey],
      date,
      time,
      queue: Number(queueRow.q),
      slot,
      status: 'waiting',
      created_at: new Date().toISOString()
    };


    /* -------------------------
       حفظ الحجز
    ------------------------- */

    await run(
      `
      INSERT INTO bookings(
        id,
        token,
        name,
        phone,
        service,
        date,
        time,
        queue,
        slot,
        status,
        created_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `,
      [
        booking.id,
        booking.token,
        booking.name,
        booking.phone,
        booking.service,
        booking.date,
        booking.time,
        booking.queue,
        booking.slot,
        booking.status,
        booking.created_at
      ]
    );


    res.json({
      booking
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر إنشاء الحجز'
    });
  }
});


/* =========================
   تغيير حالة الحجز
========================= */

app.patch('/api/bookings/:token', auth, async (req, res) => {
  try {
    const booking = await get(
      `
      SELECT *
      FROM bookings
      WHERE token=?
      `,
      [req.params.token]
    );

    if (!booking) {
      return res.status(404).json({
        error: 'الحجز غير موجود'
      });
    }

    const status = String(
      req.body.status || ''
    );


    if (
      ![
        'waiting',
        'serving',
        'done',
        'cancelled'
      ].includes(status)
    ) {
      return res.status(400).json({
        error: 'حالة غير صحيحة'
      });
    }


    /* -------------------------
       لا يمكن وجود عميلين
       في حالة serving
    ------------------------- */

    if (status === 'serving') {
      const serving = await get(
        `
        SELECT token
        FROM bookings
        WHERE date=?
          AND status='serving'
          AND token<>?
        LIMIT 1
        `,
        [
          booking.date,
          booking.token
        ]
      );

      if (serving) {
        return res.status(409).json({
          error: 'يوجد عميل حالي يتم خدمته الآن'
        });
      }
    }


    await run(
      `
      UPDATE bookings
      SET status=?
      WHERE token=?
      `,
      [
        status,
        booking.token
      ]
    );


    const updated = await get(
      `
      SELECT *
      FROM bookings
      WHERE token=?
      `,
      [booking.token]
    );


    res.json({
      ok: true,
      booking: updated
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر تحديث الحجز'
    });/* =========================
   استدعاء العميل التالي
========================= */

app.post('/api/admin/next', auth, async (req, res) => {
  try {
    const date = String(req.body.date || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'تاريخ غير صحيح'
      });
    }

    // إذا يوجد عميل حالي، لا نستدعي عميلًا آخر
    const current = await get(
      `
      SELECT *
      FROM bookings
      WHERE date=?
        AND status='serving'
      LIMIT 1
      `,
      [date]
    );

    if (current) {
      return res.status(409).json({
        error: 'يوجد عميل حالي يتم خدمته الآن',
        booking: current
      });
    }

    // البحث عن أول عميل منتظر
    const next = await get(
      `
      SELECT *
      FROM bookings
      WHERE date=?
        AND status='waiting'
      ORDER BY queue ASC
      LIMIT 1
      `,
      [date]
    );

    if (!next) {
      return res.json({
        booking: null
      });
    }

    // تحويله إلى العميل الحالي
    await run(
      `
      UPDATE bookings
      SET status='serving'
      WHERE token=?
      `,
      [next.token]
    );

    const booking = await get(
      `
      SELECT *
      FROM bookings
      WHERE token=?
      `,
      [next.token]
    );

    res.json({
      booking
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر استدعاء التالي'
    });
  }
});


/* =========================
   صفحات الموقع
========================= */

// مؤقتًا نخلي /admin يفتح ملف الموقع.
// في الخطوة التالية سنفصل admin.html
// عن صفحة العملاء.
app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});


/* =========================
   الصفحة الرئيسية
========================= */

app.get('/{*splat}', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});


/* =========================
   تشغيل السيرفر
========================= */
init()
  .then(() => {
    console.log('YF database initialized');
  })
  .catch(err => {
    console.error('Database initialization failed:', err);
  });

module.exports = app;
