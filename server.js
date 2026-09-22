const express = require('express');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '1987');

const SESSION_SECRET = String(
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update('YF|' + ADMIN_PASSWORD + '|' + (process.env.TURSO_AUTH_TOKEN || ''))
    .digest('hex')
);

const SESSION_TTL = 1000 * 60 * 60 * 12;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

/* =========================
   WEB PUSH
========================= */

const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = String(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
).trim();

const PUSH_ENABLED = Boolean(
  VAPID_PUBLIC_KEY &&
  VAPID_PRIVATE_KEY &&
  VAPID_SUBJECT
);

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  console.log('Web Push notifications: ENABLED');
} else {
  console.log('Web Push notifications: DISABLED - VAPID environment variables are missing');
}

/* =========================
   EXPRESS
========================= */

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
   PASSWORD / SESSION
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

    if (!data.exp || data.exp < Date.now()) return null;

    return data;
  } catch {
    return null;
  }
}

/* =========================
   AUTH
========================= */

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';

    const session = readSession(token);

    if (!session) {
      return res.status(401).json({ error: 'غير مصرح' });
    }

    const user = await get(
      'SELECT id, username, name, role, active FROM admin_users WHERE username=?',
      [session.username]
    );

    if (!user || !Number(user.active)) {
      return res.status(401).json({ error: 'الحساب غير فعال' });
    }

    req.admin = user;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'تعذر التحقق من الحساب' });
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
   SERVICES / TIMES
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
  return '#YF' +
    crypto.randomBytes(4).toString('hex').toUpperCase();
}

function makeToken() {
  return crypto.randomUUID();
}

/* =========================
   DATABASE INIT
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

  await run(`
    CREATE INDEX IF NOT EXISTS idx_bookings_date_queue
    ON bookings(date, queue)
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

  /*
    جدول اشتراكات إشعارات الإدارة
  */
  await run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions(
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      subscription_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const existing = await get(
    'SELECT id FROM admin_users WHERE username=?',
    [ADMIN_USERNAME]
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
        ADMIN_USERNAME,
        'المالك',
        hashPassword(ADMIN_PASSWORD),
        'owner',
        1,
        new Date().toISOString()
      ]
    );

    console.log(`Initial admin created: ${ADMIN_USERNAME}`);
  }
}

/* =========================
   PUSH HELPERS
========================= */

async function sendPushToAdmins(booking) {
  if (!PUSH_ENABLED) {
    return;
  }

  try {
    const rows = await all(
      `
      SELECT id, endpoint, subscription_json
      FROM push_subscriptions
      `
    );

    if (!rows.length) {
      console.log('No push subscriptions registered.');
      return;
    }

    const payload = JSON.stringify({
      title: 'حجز جديد — يوسف فاروق',
      body:
        `${booking.name} حجز ${booking.service} — الدور #${booking.queue}`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'yf-new-booking',
      data: {
        url: '/admin',
        token: booking.token,
        bookingId: booking.id,
        queue: booking.queue,
        name: booking.name,
        phone: booking.phone,
        service: booking.service,
        date: booking.date,
        time: booking.time
      }
    });

    for (const row of rows) {
      try {
        const subscription =
          JSON.parse(row.subscription_json);

        await webpush.sendNotification(
          subscription,
          payload
        );

        console.log(
          `Push sent to admin subscription ${row.id}`
        );
      } catch (err) {
        console.error(
          'Push send failed:',
          err?.statusCode,
          err?.message
        );

        /*
          إذا ألغى المتصفح الاشتراك، نحذفه من قاعدة البيانات
        */
        if (
          err?.statusCode === 404 ||
          err?.statusCode === 410
        ) {
          await run(
            'DELETE FROM push_subscriptions WHERE id=?',
            [row.id]
          );
        }
      }
    }
  } catch (e) {
    console.error('sendPushToAdmins error:', e);
  }
}

/* =========================
   ADMIN LOGIN
========================= */

app.post('/api/admin/login', async (req, res) => {
  try {
    const username =
      String(req.body.username || '')
        .trim()
        .toLowerCase();

    const password =
      String(req.body.password || '');

    if (!username || !password) {
      return res.status(401).json({
        error: 'بيانات الدخول غير صحيحة'
      });
    }

    const user = await get(
      `
      SELECT id, username, name, role, active, password_hash
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

    res.json({
      token: makeSession(user.username, user.role),
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

app.get('/api/admin/me', auth, (req, res) => {
  res.json({
    user: req.admin
  });
});

/* =========================
   PUSH API
========================= */

app.get('/api/push/public-key', auth, (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({
      error: 'إشعارات الهاتف غير مفعلة على الخادم'
    });
  }

  res.json({
    publicKey: VAPID_PUBLIC_KEY
  });
});

app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({
        error: 'إشعارات الهاتف غير مفعلة على الخادم'
      });
    }

    const subscription = req.body.subscription;

    if (
      !subscription ||
      !subscription.endpoint ||
      !subscription.keys
    ) {
      return res.status(400).json({
        error: 'اشتراك الإشعارات غير صحيح'
      });
    }

    const now = new Date().toISOString();

    const existing = await get(
      `
      SELECT id
      FROM push_subscriptions
      WHERE endpoint=?
      `,
      [subscription.endpoint]
    );

    if (existing) {
      await run(
        `
        UPDATE push_subscriptions
        SET username=?,
            subscription_json=?,
            updated_at=?
        WHERE endpoint=?
        `,
        [
          req.admin.username,
          JSON.stringify(subscription),
          now,
          subscription.endpoint
        ]
      );
    } else {
      await run(
        `
        INSERT INTO push_subscriptions(
          id,
          username,
          endpoint,
          subscription_json,
          created_at,
          updated_at
        )
        VALUES(?,?,?,?,?,?)
        `,
        [
          crypto.randomUUID(),
          req.admin.username,
          subscription.endpoint,
          JSON.stringify(subscription),
          now,
          now
        ]
      );
    }

    res.json({
      ok: true,
      message: 'تم تفعيل إشعارات الهاتف'
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر حفظ اشتراك الإشعارات'
    });
  }
});

app.delete('/api/push/subscribe', auth, async (req, res) => {
  try {
    const endpoint =
      String(req.body.endpoint || '').trim();

    if (endpoint) {
      await run(
        `
        DELETE FROM push_subscriptions
        WHERE endpoint=?
        `,
        [endpoint]
      );
    }

    res.json({
      ok: true
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'تعذر إلغاء الإشعارات'
    });
  }
});

/* =========================
   ADMIN USERS
========================= */

app.get(
  '/api/admin/users',
  auth,
  ownerOnly,
  async (req, res) => {
    try {
      const users = await all(
        `
        SELECT id, username, name, role, active, created_at
        FROM admin_users
        ORDER BY created_at ASC
        `
      );

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
      const username =
        String(req.body.username || '')
          .trim()
          .toLowerCase();

      const name =
        String(req.body.name || '').trim();

      const password =
        String(req.body.password || '');

      if (
        !/^[a-z0-9._-]{3,40}$/.test(username)
      ) {
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

      if (
        password.length < 8 ||
        password.length > 100
      ) {
        return res.status(400).json({
          error:
            'كلمة المرور يجب أن تكون 8 أحرف على الأقل'
        });
      }

      if (
        await get(
          'SELECT id FROM admin_users WHERE username=?',
          [username]
        )
      ) {
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
        SELECT id, username, name, role, active
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
          error:
            'لا يمكن تعطيل حساب المالك من هنا'
        });
      }

      const active =
        req.body.active === true ||
        req.body.active === 1 ||
        req.body.active === '1';

      await run(
        'UPDATE admin_users SET active=? WHERE id=?',
        [active ? 1 : 0, user.id]
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
        'DELETE FROM admin_users WHERE id=?',
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
    }
  }
);

/* =========================
   QUEUE
========================= */

app.get('/api/queue', async (req, res) => {
  try {
    const date =
      String(req.query.date || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'تاريخ غير صحيح'
      });
    }

    const rows = await all(
      `
      SELECT token, date, queue, status
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
   BOOKINGS
========================= */

app.get('/api/bookings', auth, async (req, res) => {
  try {
    const date =
      String(req.query.date || '');

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

app.get(
  '/api/bookings/token/:token',
  async (req, res) => {
    try {
      const b = await get(
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
          status,
          created_at
        FROM bookings
        WHERE token=?
        `,
        [req.params.token]
      );

      if (!b) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      res.json(b);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر قراءة الحجز'
      });
    }
  }
);

app.get(
  '/api/admin/bookings/token/:token',
  auth,
  async (req, res) => {
    try {
      const b = await get(
        'SELECT * FROM bookings WHERE token=?',
        [req.params.token]
      );

      if (!b) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      res.json(b);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: 'تعذر قراءة الحجز'
      });
    }
  }
);

/* =========================
   CREATE BOOKING
========================= */

app.post('/api/bookings', async (req, res) => {
  try {
    const name =
      String(req.body.name || '').trim();

    const phone =
      String(req.body.phone || '').trim();

    const date =
      String(req.body.date || '');

    const time =
      String(req.body.time || '');

    const key =
      String(req.body.serviceKey || '');

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        error: 'اكتب اسم العميل بشكل صحيح'
      });
    }

    if (!/^[0-9+()\-\s]{8,20}$/.test(phone)) {
      return res.status(400).json({
        error: 'رقم الموبايل غير
