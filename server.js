'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();

/* =========================================================
   الإعدادات
========================================================= */

const PORT = process.env.PORT || 3000;

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error(
    'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN'
  );
}

const db = createClient({
  url: TURSO_DATABASE_URL || 'file:local.sqlite',
  authToken: TURSO_AUTH_TOKEN || undefined
});

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  process.env.TURSO_AUTH_TOKEN ||
  'yf-barber-change-this-secret';

const OWNER_USERNAME = 'karemadmin';
const OWNER_PASSWORD = '011963';

const SERVICES = {
  signature: 'الحلاقة والتشذيب المميز',
  classic: 'الحلاقة الكلاسيكية',
  beard: 'تهذيب اللحية الملكية'
};

const SERVICE_PRICES = {
  signature: 180,
  classic: 120,
  beard: 80
};

const VALID_TIMES = [
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

const BOOKING_STATUSES = [
  'waiting',
  'serving',
  'done',
  'cancelled'
];

/* =========================================================
   Middleware
========================================================= */

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static(__dirname, {
    index: false
  })
);

/* =========================================================
   أدوات قاعدة البيانات
========================================================= */

async function execute(sql, args = []) {
  return db.execute({
    sql,
    args
  });
}

async function getOne(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows[0] || null;
}

async function getAll(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows || [];
}

/* =========================================================
   أدوات عامة
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function todayInCairo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function generateId() {
  return crypto.randomUUID();
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalize(value) {
  return String(value ?? '').trim();
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isPastDate(date) {
  return date < todayInCairo();
}

function isValidPhone(phone) {
  return /^[0-9+()\-\s]{8,20}$/.test(phone);
}

/* =========================================================
   كلمات المرور
========================================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');

    if (parts.length !== 3) {
      return false;
    }

    const [, salt, storedHash] = parts;

    const calculatedHash = crypto
      .scryptSync(password, salt, 64)
      .toString('hex');

    const a = Buffer.from(calculatedHash, 'hex');
    const b = Buffer.from(storedHash, 'hex');

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* =========================================================
   جلسات الإدارة
========================================================= */

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(value) {
  return Buffer.from(
    value
      .replace(/-/g, '+')
      .replace(/_/g, '/'),
    'base64'
  ).toString();
}

function signSession(payload) {
  const body = base64url(
    JSON.stringify(payload)
  );

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

function makeSession(user) {
  return signSession({
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + 12 * 60 * 60 * 1000
  });
}

function readSession(token) {
  try {
    if (!token || !token.includes('.')) {
      return null;
    }

    const [body, signature] = token.split('.');

    const expected = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(body)
      .digest('base64url');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return null;
    }

    const payload = JSON.parse(
      fromBase64url(body)
    );

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/* =========================================================
   Authentication
========================================================= */

async function getAuthenticatedUser(req) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice(7).trim();

  const session = readSession(token);

  if (!session) {
    return null;
  }

  const user = await getOne(
    `
      SELECT
        id,
        username,
        name,
        role,
        active
      FROM admin_users
      WHERE id = ?
      LIMIT 1
    `,
    [session.id]
  );

  if (!user || Number(user.active) !== 1) {
    return null;
  }

  return user;
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'غير مصرح. يرجى تسجيل الدخول.'
      });
    }

    req.adminUser = user;

    next();
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'تعذر التحقق من تسجيل الدخول'
    });
  }
}

function requireOwner(req, res, next) {
  if (!req.adminUser) {
    return res.status(401).json({
      error: 'غير مصرح'
    });
  }

  if (req.adminUser.role !== 'owner') {
    return res.status(403).json({
      error: 'هذا الإجراء متاح للمالك فقط'
    });
  }

  next();
}

/* =========================================================
   إنشاء قاعدة البيانات
========================================================= */

async function initDatabase() {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
    throw new Error(
      'TURSO_DATABASE_URL و TURSO_AUTH_TOKEN مطلوبان'
    );
  }

  await execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      queue INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL
    )
  `);

  await execute(`
    CREATE INDEX IF NOT EXISTS
    idx_bookings_date_time
    ON bookings(date, time)
  `);

  await execute(`
    CREATE INDEX IF NOT EXISTS
    idx_bookings_date_queue
    ON bookings(date, queue)
  `);

  /*
    يمنع وجود أكثر من شخص في نفس رقم المكان
    في نفس التاريخ والوقت.

    وبالتالي:
    slot 1 = عميل
    slot 2 = عميل

    والثالث مرفوض.
  */
  await execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_unique_active_booking_slot
    ON bookings(date, time, slot)
    WHERE status <> 'cancelled'
  `);

  await execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_unique_booking_queue
    ON bookings(date, queue)
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  await execute(`
    CREATE INDEX IF NOT EXISTS
    idx_admin_users_username
    ON admin_users(username)
  `);

  await seedOwner();

  console.log('Database initialized successfully');
}

/* =========================================================
   إنشاء حساب المالك
========================================================= */

async function seedOwner() {
  const passwordHash = hashPassword(
    OWNER_PASSWORD
  );

  const existing = await getOne(
    `
      SELECT id
      FROM admin_users
      WHERE username = ?
      LIMIT 1
    `,
    [OWNER_USERNAME]
  );

  if (existing) {
    await execute(
      `
        UPDATE admin_users
        SET
          password_hash = ?,
          role = 'owner',
          active = 1,
          name = ?
        WHERE username = ?
      `,
      [
        passwordHash,
        'مدير يوسف فاروق',
        OWNER_USERNAME
      ]
    );

    return;
  }

  await execute(
    `
      INSERT INTO admin_users (
        id,
        username,
        name,
        password_hash,
        role,
        active,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      generateId(),
      OWNER_USERNAME,
      'مدير يوسف فاروق',
      passwordHash,
      'owner',
      1,
      nowISO()
    ]
  );
}

/* =========================================================
   API - تسجيل دخول الإدارة
========================================================= */

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = normalize(
      req.body.username
    ).toLowerCase();

    const password = String(
      req.body.password || ''
    );

    if (!username || !password) {
      return res.status(401).json({
        error: 'اسم المستخدم وكلمة المرور مطلوبان'
      });
    }

    const user = await getOne(
      `
        SELECT
          id,
          username,
          name,
          password_hash,
          role,
          active
        FROM admin_users
        WHERE username = ?
        LIMIT 1
      `,
      [username]
    );

    if (
      !user ||
      Number(user.active) !== 1 ||
      !verifyPassword(
        password,
        user.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'اسم المستخدم أو كلمة المرور غير صحيحة'
      });
    }

    const token = makeSession(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'تعذر تسجيل الدخول'
    });
  }
});

/* =========================================================
   API - معلومات المدير الحالي
========================================================= */

app.get(
  '/api/admin/me',
  requireAdmin,
  async (req, res) => {
    res.json({
      user: req.adminUser
    });
  }
);

/* =========================================================
   API - المستخدمين
========================================================= */

app.get(
  '/api/admin/users',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const users = await getAll(`
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
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحميل المستخدمين'
      });
    }
  }
);

app.post(
  '/api/admin/users',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const username = normalize(
        req.body.username
      ).toLowerCase();

      const password = String(
        req.body.password || ''
      );

      const name =
        normalize(req.body.name) ||
        username;

      const role =
        req.body.role === 'owner'
          ? 'owner'
          : 'admin';

      if (
        username.length < 3 ||
        username.length > 50
      ) {
        return res.status(400).json({
          error: 'اسم المستخدم غير صالح'
        });
      }

      if (password.length < 4) {
        return res.status(400).json({
          error: 'كلمة المرور قصيرة جدًا'
        });
      }

      const exists = await getOne(
        `
          SELECT id
          FROM admin_users
          WHERE username = ?
          LIMIT 1
        `,
        [username]
      );

      if (exists) {
        return res.status(409).json({
          error: 'اسم المستخدم موجود بالفعل'
        });
      }

      const id = generateId();

      await execute(
        `
          INSERT INTO admin_users (
            id,
            username,
            name,
            password_hash,
            role,
            active,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          username,
          name,
          hashPassword(password),
          role,
          1,
          nowISO()
        ]
      );

      const user = await getOne(
        `
          SELECT
            id,
            username,
            name,
            role,
            active,
            created_at
          FROM admin_users
          WHERE id = ?
        `,
        [id]
      );

      res.status(201).json({
        user
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر إنشاء المستخدم'
      });
    }
  }
);

app.patch(
  '/api/admin/users/:id',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const id = normalize(
        req.params.id
      );

      const existing = await getOne(
        `
          SELECT *
          FROM admin_users
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

      if (!existing) {
        return res.status(404).json({
          error: 'المستخدم غير موجود'
        });
      }

      const name =
        req.body.name !== undefined
          ? normalize(req.body.name)
          : existing.name;

      const role =
        req.body.role === 'owner'
          ? 'owner'
          : 'admin';

      const active =
        req.body.active === undefined
          ? Number(existing.active)
          : req.body.active
            ? 1
            : 0;

      await execute(
        `
          UPDATE admin_users
          SET
            name = ?,
            role = ?,
            active = ?
          WHERE id = ?
        `,
        [
          name,
          role,
          active,
          id
        ]
      );

      if (
        req.body.password !== undefined &&
        String(req.body.password).length >= 4
      ) {
        await execute(
          `
            UPDATE admin_users
            SET password_hash = ?
            WHERE id = ?
          `,
          [
            hashPassword(
              String(req.body.password)
            ),
            id
          ]
        );
      }

      const user = await getOne(
        `
          SELECT
            id,
            username,
            name,
            role,
            active,
            created_at
          FROM admin_users
          WHERE id = ?
        `,
        [id]
      );

      res.json({
        user
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تعديل المستخدم'
      });
    }
  }
);

app.delete(
  '/api/admin/users/:id',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const id = normalize(
        req.params.id
      );

      if (id === req.adminUser.id) {
        return res.status(400).json({
          error: 'لا يمكنك حذف حسابك الحالي'
        });
      }

      await execute(
        `
          DELETE FROM admin_users
          WHERE id = ?
        `,
        [id]
      );

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر حذف المستخدم'
      });
    }
  }
);

/* =========================================================
   API - قائمة الأوقات
========================================================= */

app.get(
  '/api/times',
  (req, res) => {
    res.json({
      times: VALID_TIMES
    });
  }
);

/* =========================================================
   API - الخدمات
========================================================= */

app.get(
  '/api/services',
  (req, res) => {
    res.json({
      services: Object.keys(SERVICES).map(
        key => ({
          key,
          name: SERVICES[key],
          price: SERVICE_PRICES[key]
        })
      )
    });
  }
);

/* =========================================================
   إنشاء حجز
========================================================= */

async function createBooking({
  name,
  phone,
  service,
  date,
  time
}) {
  /*
    نحاول أكثر من مرة حتى نتعامل
    مع طلبين يصلان في نفس اللحظة.
  */

  for (let attempt = 0; attempt < 5; attempt++) {
    const occupiedRows = await getAll(
      `
        SELECT slot
        FROM bookings
        WHERE
          date = ?
          AND time = ?
          AND status <> 'cancelled'
        ORDER BY slot ASC
      `,
      [
        date,
        time
      ]
    );

    const occupied = new Set(
      occupiedRows.map(
        row => Number(row.slot)
      )
    );

    let slot = null;

    if (!occupied.has(1)) {
      slot = 1;
    } else if (!occupied.has(2)) {
      slot = 2;
    }

    if (!slot) {
      const error = new Error(
        'هذا الموعد مكتمل. اختر وقتًا آخر.'
      );

      error.code = 'SLOT_FULL';

      throw error;
    }

    const queueRow = await getOne(
      `
        SELECT
          COALESCE(MAX(queue), 0) AS max_queue
        FROM bookings
        WHERE date = ?
      `,
      [date]
    );

    const queue =
      Number(queueRow?.max_queue || 0) + 1;

    const id = generateId();
    const token = generateToken();

    try {
      await execute(
        `
          INSERT INTO bookings (
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          token,
          name,
          phone,
          service,
          date,
          time,
          queue,
          slot,
          'waiting',
          nowISO()
        ]
      );

      return await getOne(
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
          WHERE id = ?
        `,
        [id]
      );
    } catch (error) {
      const message = String(
        error?.message || ''
      );

      /*
        إذا كان هناك طلب آخر سبقنا
        في نفس الموعد أو نفس رقم الدور،
        نحاول مرة أخرى.
      */
 if (
        message.includes('UNIQUE') ||
        message.includes('constraint') ||
        message.includes('SQLITE_CONSTRAINT')
      ) {
        continue;
      }

      throw error;
    }
  }

  const error = new Error(
    'تعذر إنشاء الحجز بسبب تزامن الطلبات. حاول مرة أخرى.'
  );

  error.code = 'RETRY_FAILED';

  throw error;
}

/* =========================================================
   API - حجز جديد
========================================================= */

app.post(
  '/api/bookings',
  async (req, res) => {
    try {
      const name = normalize(
        req.body.name
      );

      const phone = normalize(
        req.body.phone
      );

      const service = normalize(
        req.body.service
      );

      const date = normalize(
        req.body.date
      );

      const time = normalize(
        req.body.time
      );

      if (
        name.length < 2 ||
        name.length > 80
      ) {
        return res.status(400).json({
          error: 'يرجى إدخال الاسم بشكل صحيح'
        });
      }

      if (!isValidPhone(phone)) {
        return res.status(400).json({
          error: 'يرجى إدخال رقم الهاتف بشكل صحيح'
        });
      }

      if (!SERVICES[service]) {
        return res.status(400).json({
          error: 'الخدمة غير صحيحة'
        });
      }

      if (!isValidDate(date)) {
        return res.status(400).json({
          error: 'التاريخ غير صحيح'
        });
      }

      if (isPastDate(date)) {
        return res.status(400).json({
          error: 'لا يمكن الحجز في تاريخ سابق'
        });
      }

      if (!VALID_TIMES.includes(time)) {
        return res.status(400).json({
          error: 'الوقت غير متاح'
        });
      }

      const booking = await createBooking({
        name,
        phone,
        service,
        date,
        time
      });

      res.status(201).json({
        booking
      });
    } catch (error) {
      console.error(error);

      if (error.code === 'SLOT_FULL') {
        return res.status(409).json({
          error: error.message
        });
      }

      res.status(500).json({
        error: 'تعذر إنشاء الحجز. حاول مرة أخرى.'
      });
    }
  }
);

/* =========================================================
   API - حجز بواسطة QR / Token
========================================================= */

app.get(
  '/api/bookings/token/:token',
  async (req, res) => {
    try {
      const token = normalize(
        req.params.token
      );

      if (!token) {
        return res.status(400).json({
          error: 'رمز الحجز غير صالح'
        });
      }

      const booking = await getOne(
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
          WHERE token = ?
          LIMIT 1
        `,
        [token]
      );

      if (!booking) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      res.json(booking);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحميل الحجز'
      });
    }
  }
);

/* =========================================================
   API - QR للإدارة
========================================================= */

app.get(
  '/api/admin/bookings/token/:token',
  requireAdmin,
  async (req, res) => {
    try {
      const token = normalize(
        req.params.token
      );

      const booking = await getOne(
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
          WHERE token = ?
          LIMIT 1
        `,
        [token]
      );

      if (!booking) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      res.json({
        booking
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحميل الحجز'
      });
    }
  }
);

/* =========================================================
   API - الحجوزات اليومية للإدارة
========================================================= */

app.get(
  '/api/bookings',
  requireAdmin,
  async (req, res) => {
    try {
      const date = normalize(
        req.query.date
      );

      if (!isValidDate(date)) {
        return res.status(400).json({
          error: 'يجب تحديد تاريخ صحيح'
        });
      }

      const bookings = await getAll(
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
          WHERE date = ?
          ORDER BY
            queue ASC,
            slot ASC
        `,
        [date]
      );

      res.json({
        date,
        bookings
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحميل الحجوزات'
      });
    }
  }
);

/* =========================================================
   API - حالة الطابور العامة
========================================================= */

app.get(
  '/api/queue',
  async (req, res) => {
    try {
      const date = normalize(
        req.query.date
      );

      if (!isValidDate(date)) {
        return res.status(400).json({
          error: 'التاريخ غير صحيح'
        });
      }

      const bookings = await getAll(
        `
          SELECT
            token,
            date,
            time,
            queue,
            status
          FROM bookings
          WHERE
            date = ?
            AND status <> 'cancelled'
          ORDER BY queue ASC
        `,
        [date]
      );

      const serving =
        bookings.find(
          booking =>
            booking.status === 'serving'
        ) || null;

      const waiting = bookings.filter(
        booking =>
          booking.status === 'waiting'
      );

      res.json({
        date,
        current:
          serving
            ? serving.queue
            : null,
        waiting: waiting.map(
          booking => ({
            token: booking.token,
            queue: booking.queue,
            time: booking.time,
            status: booking.status
          })
        ),
        bookings
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحميل الطابور'
      });
    }
  }
);

/* =========================================================
   تحديث حالة الحجز
========================================================= */

app.patch(
  '/api/bookings/:token',
  requireAdmin,
  async (req, res) => {
    try {
      const token = normalize(
        req.params.token
      );

      const status = normalize(
        req.body.status
      );

      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({
          error: 'حالة الحجز غير صحيحة'
        });
      }

      const booking = await getOne(
        `
          SELECT *
          FROM bookings
          WHERE token = ?
          LIMIT 1
        `,
        [token]
      );

      if (!booking) {
        return res.status(404).json({
          error: 'الحجز غير موجود'
        });
      }

      /*
        لا نسمح بأكثر من عميل واحد
        في حالة "جاري" في نفس اليوم.
      */

      if (status === 'serving') {
        const currentServing =
          await getOne(
            `
              SELECT
                token,
                queue,
                name
              FROM bookings
              WHERE
                date = ?
                AND status = 'serving'
                AND token <> ?
              LIMIT 1
            `,
            [
              booking.date,
              token
            ]
          );

        if (currentServing) {
          return res.status(409).json({
            error:
              'هناك عميل قيد الخدمة بالفعل. أنهِ العميل الحالي أولًا.'
          });
        }
      }

      await execute(
        `
          UPDATE bookings
          SET status = ?
          WHERE token = ?
        `,
        [
          status,
          token
        ]
      );

      const updated = await getOne(
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
          WHERE token = ?
        `,
        [token]
      );

      res.json({
        booking: updated
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر تحديث حالة الحجز'
      });
    }
  }
);

/* =========================================================
   استدعاء التالي
========================================================= */

app.post(
  '/api/admin/next',
  requireAdmin,
  async (req, res) => {
    try {
      const date =
        normalize(req.body.date) ||
        todayInCairo();

      if (!isValidDate(date)) {
        return res.status(400).json({
          error: 'التاريخ غير صحيح'
        });
      }

      const currentServing =
        await getOne(
          `
            SELECT
              token,
              name,
              queue
            FROM bookings
            WHERE
              date = ?
              AND status = 'serving'
            LIMIT 1
          `,
          [date]
        );

      if (currentServing) {
        return res.status(409).json({
          error:
            'هناك عميل قيد الخدمة بالفعل',
          booking: currentServing
        });
      }

      const next = await getOne(
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
          WHERE
            date = ?
            AND status = 'waiting'
          ORDER BY queue ASC
          LIMIT 1
        `,
        [date]
      );

      if (!next) {
        return res.status(404).json({
          error:
            'لا يوجد عملاء في الانتظار'
        });
      }

      await execute(
        `
          UPDATE bookings
          SET status = 'serving'
          WHERE token = ?
        `,
        [next.token]
      );

      const booking = await getOne(
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
          WHERE token = ?
        `,
        [next.token]
      );

      res.json({
        booking
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'تعذر استدعاء التالي'
      });
    }
  }
);

/* =========================================================
   Health Check
========================================================= */

app.get(
  '/api/health',
  async (req, res) => {
    try {
      await execute(
        'SELECT 1 AS ok'
      );

      res.json({
        ok: true,
        database: true,
        date: todayInCairo()
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        database: false
      });
    }
  }
);

/* =========================================================
   صفحات الموقع
========================================================= */

app.get(
  '/admin',
  (req, res) => {
    res.sendFile(
      path.join(__dirname, 'admin.html')
    );
  }
);

app.get(
  '/',
  (req, res) => {
    res.sendFile(
      path.join(__dirname, 'index.html')
    );
  }
);

/*
  Express 5 يستخدم صيغة wildcard المسماة.
*/
app.get(
  '/{*splat}',
  (req, res) => {
    res.sendFile(
      path.join(__dirname, 'index.html')
    );
  }
);

/* =========================================================
   معالجة الأخطاء
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(error);

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error: 'حدث خطأ غير متوقع في الخادم'
    });
  }
);

/* =========================================================
   تشغيل قاعدة البيانات ثم الخادم
========================================================= */

let initialized = false;

async function initialize() {
  if (initialized) {
    return;
  }

  await initDatabase();

  initialized = true;
}

initialize()
  .then(() => {
    console.log(
      'YF Barber server initialized'
    );
  })
  .catch(error => {
    console.error(
      'Database initialization failed:',
      error
    );
  });

/*
  التشغيل المحلي فقط.
  على Vercel سيتم استخدام app مباشرة.
*/
if (require.main === module) {
  initialize()
    .then(() => {
      app.listen(PORT, () => {
        console.log(
          `YF Barber running on port ${PORT}`
        );
      });
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = app;
