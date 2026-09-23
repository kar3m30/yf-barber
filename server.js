'use strict';

/* =========================================================
   يوسف فاروق — Barber Booking System
   server.js
   ========================================================= */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const {
  createClient
} = require('@libsql/client');

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
   إعدادات البيئة
========================================================= */

const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL || '';

const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN || '';

const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  TURSO_AUTH_TOKEN ||
  'yf-barber-session-secret-change-me';

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error(
    'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN'
  );
}

/* =========================================================
   Turso
========================================================= */

const db = createClient({
  url: TURSO_DATABASE_URL || 'libsql://invalid',
  authToken: TURSO_AUTH_TOKEN || 'invalid'
});

/* =========================================================
   Express
========================================================= */

app.use(express.json({
  limit: '1mb'
}));

app.use(express.urlencoded({
  extended: true
}));

app.use(express.static(__dirname));

/* =========================================================
   أدوات عامة
========================================================= */

function todayCairo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeUsername(value) {
  return clean(value).toLowerCase();
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(value);
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

/* =========================================================
   الخدمات
========================================================= */

const SERVICES = {
  signature: {
    name: 'الحلاقة والتشذيب المميز',
    price: 180
  },

  classic: {
    name: 'الحلاقة الكلاسيكية',
    price: 120
  },

  beard: {
    name: 'تهذيب اللحية الملكية',
    price: 80
  }
};

/* =========================================================
   الأوقات
========================================================= */

const TIMES = [
  '12:00',
  '12:30',

  '13:00',
  '13:30',

  '14:00',
  '14:30',

  '15:00',
  '15:30',

  '16:00',
  '16:30',

  '17:00',
  '17:30',

  '18:00',
  '18:30',

  '19:00',
  '19:30',

  '20:00',
  '20:30',

  '21:00',
  '21:30',

  '22:00',
  '22:30',

  '23:00',
  '23:30',

  '00:00',
  '00:30'
];

/* =========================================================
   التحقق من الوقت
========================================================= */

function isAllowedTime(time) {
  return TIMES.includes(time);
}

/* =========================================================
   كلمات المرور
========================================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  const hash = crypto
    .scryptSync(
      password,
      salt,
      64
    )
    .toString('hex');

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');

    if (parts.length !== 3) {
      return false;
    }

    const [
      algorithm,
      salt,
      storedHash
    ] = parts;

    if (algorithm !== 'scrypt') {
      return false;
    }

    const calculated = crypto
      .scryptSync(
        password,
        salt,
        64
      )
      .toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(calculated, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/* =========================================================
   جلسات الإدارة
========================================================= */

function createSession(user) {
  const payload = {
    id: Number(user.id),
    username: user.username,
    role: user.role,
    exp: Date.now() + (
      12 * 60 * 60 * 1000
    )
  };

  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url');

  const signature = crypto
    .createHmac(
      'sha256',
      ADMIN_SESSION_SECRET
    )
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

function verifySession(token) {
  try {
    if (!token) {
      return null;
    }

    const parts = String(token).split('.');

    if (parts.length !== 2) {
      return null;
    }

    const [
      encoded,
      signature
    ] = parts;

    const expected = crypto
      .createHmac(
        'sha256',
        ADMIN_SESSION_SECRET
      )
      .update(encoded)
      .digest('base64url');

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer
        .from(encoded, 'base64url')
        .toString('utf8')
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
   استخراج التوكن
========================================================= */

function getAuthToken(req) {
  const header =
    req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice(7).trim();
}

/* =========================================================
   Middleware الإدارة
========================================================= */

async function requireAdmin(req, res, next) {
  try {
    const token = getAuthToken(req);

    const session = verifySession(token);

    if (!session) {
      return res.status(401).json({
        error: 'غير مصرح. سجّل الدخول أولاً.'
      });
    }

    const result = await db.execute({
      sql: `
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
      args: [session.id]
    });

    const user = result.rows[0];

    if (!user || Number(user.active) !== 1) {
      return res.status(401).json({
        error: 'الحساب غير صالح.'
      });
    }

    req.admin = {
      id: Number(user.id),
      username: user.username,
      name: user.name,
      role: user.role
    };

    next();
  } catch (error) {
    console.error(
      'requireAdmin:',
      error
    );

    return res.status(500).json({
      error: 'تعذر التحقق من جلسة الإدارة.'
    });
  }
}

/* =========================================================
   Middleware المالك
========================================================= */

function requireOwner(req, res, next) {
  if (
    req.admin?.role !== 'owner'
  ) {
    return res.status(403).json({
      error: 'هذا الإجراء متاح للمالك فقط.'
    });
  }

  next();
}

/* =========================================================
   قاعدة البيانات
========================================================= */

let databaseReady = false;
let databaseInitPromise = null;

async function initDatabase() {
  if (databaseReady) {
    return;
  }

  if (databaseInitPromise) {
    return databaseInitPromise;
  }

  databaseInitPromise = (async () => {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      throw new Error(
        'TURSO_DATABASE_URL / TURSO_AUTH_TOKEN غير موجودين.'
      );
    }

    await db.batch([
      {
        sql: `
          CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT NOT NULL UNIQUE,
            subscription_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_bookings_date_time
          ON bookings(date, time)
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_bookings_date_queue
          ON bookings(date, queue)
        `,
        args: []
      },

      {
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS
          idx_bookings_active_slot
          ON bookings(date, time, slot)
          WHERE status != 'cancelled'
        `,
        args: []
      },

      {
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS
          idx_bookings_date_queue_unique
          ON bookings(date, queue)
        `,
        args: []
      }
    ]);

    const passwordHash =
      hashPassword('011963');

    const existing = await db.execute({
      sql: `
        SELECT id
        FROM admin_users
        WHERE username = ?
        LIMIT 1
      `,
      args: ['karemadmin']
    });

    if (existing.rows.length) {
      await db.execute({
        sql: `
          UPDATE admin_users
          SET
            name = ?,
            password_hash = ?,
            role = 'owner',
            active = 1
          WHERE username = ?
        `,
        args: [
          'مدير يوسف فاروق',
          passwordHash,
          'karemadmin'
        ]
      });
    } else {
      await db.execute({
        sql: `
          INSERT INTO admin_users (
            username,
            name,
            password_hash,
            role,
            active,
            created_at
          )
          VALUES (?, ?, ?, ?, 1, ?)
        `,
        args: [
          'karemadmin',
          'مدير يوسف فاروق',
          passwordHash,
          'owner',
          new Date().toISOString()
        ]
      });
    }

    databaseReady = true;

    console.log(
      'Turso database initialized successfully.'
    );
  })();

  try {
    await databaseInitPromise;
  } catch (error) {
    databaseInitPromise = null;
    throw error;
  }
}

/* =========================================================
   حماية API من السباق أثناء تهيئة DB
========================================================= */

app.use('/api', async (req, res, next) => {
  try {
    await initDatabase();
    next();
  } catch (error) {
    console.error(
      'Database initialization:',
      error
    );

    res.status(500).json({
      error: 'فشل تهيئة قاعدة البيانات.'
    });
  }
});

/* =========================================================
   تسجيل دخول الإدارة
========================================================= */

app.post(
  '/api/admin/login',
  async (req, res) => {
    try {
      const username =
        normalizeUsername(
          req.body.username
        );

      const password =
        String(
          req.body.password || ''
        );

      if (!username || !password) {
        return res.status(401).json({
          error:
            'اسم المستخدم وكلمة المرور مطلوبان.'
        });
      }

      const result = await db.execute({
        sql: `
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
        args: [username]
      });

      const user = result.rows[0];

      if (
        !user ||
        Number(user.active) !== 1 ||
        !verifyPassword(
          password,
          user.password_hash
        )
      ) {
        return res.status(401).json({
          error:
            'اسم المستخدم أو كلمة المرور غير صحيحة.'
        });
      }

      const token =
        createSession(user);

      return res.json({
        token,

        user: {
          id: Number(user.id),
          username: user.username,
          name: user.name,
          role: user.role
        }
      });
    } catch (error) {
      console.error(
        'admin login:',
        error
      );

      res.status(500).json({
        error: 'تعذر تسجيل الدخول.'
      });
    }
  }
);

/* =========================================================
   بيانات المستخدم الحالي
========================================================= */

app.get(
  '/api/admin/me',
  requireAdmin,
  async (req, res) => {
    res.json({
      user: req.admin
    });
  }
);

/* =========================================================
   الخدمات
========================================================= */

app.get(
  '/api/services',
  (req, res) => {
    res.json({
      services: SERVICES
    });
  }
);

/* =========================================================
   الأوقات
========================================================= */

app.get(
  '/api/times',
  (req, res) => {
    res.json({
      times: TIMES
    });
  }
);

/* =========================================================
   إنشاء حجز
========================================================= */

app.post(
  '/api/bookings',
  async (req, res) => {
    try {
      const name =
        clean(req.body.name);

      const phone =
        clean(req.body.phone);

      const service =
        clean(req.body.service);

      const date =
        clean(req.body.date);

      const time =
        clean(req.body.time);

      if (
        !name ||
        !phone ||
        !service ||
        !date ||
        !time
      ) {
        return res.status(400).json({
          error:
            'يرجى إكمال جميع بيانات الحجز.'
        });
      }

      if (!SERVICES[service]) {
        return res.status(400).json({
          error:
            'الخدمة المختارة غير صحيحة.'
        });
      }

      if (!isValidDate(date)) {
        return res.status(400).json({
          error: 'التاريخ غير صحيح.'
        });
      }

      if (!isValidTime(time)) {
        return res.status(400).json({
          error: 'الوقت غير صحيح.'
        });
      }

      if (!isAllowedTime(time)) {
        return res.status(400).json({
          error:
            'هذا الوقت غير متاح للحجز.'
        });
      }

      const today =
        todayCairo();

      if (date < today) {
        return res.status(400).json({
          error:
            'لا يمكن الحجز في تاريخ سابق.'
        });
      }

      /*
        نحاول إنشاء الحجز مع slot 1 أو 2.
        الـ UNIQUE INDEX يمنع دخول حجزين
        إلى نفس المكان في نفس اللحظة.
      */

      for (let attempt = 0; attempt < 8; attempt++) {
        const slotCheck =
          await db.execute({
            sql: `
              SELECT slot
              FROM bookings
              WHERE date = ?
                AND time = ?
                AND status != 'cancelled'
              ORDER BY slot ASC
            `,
            args: [
              date,
              time
            ]
          });

        const usedSlots =
          new Set(
            slotCheck.rows.map(
              row => Number(row.slot)
            )
          );

        let slot = null;

        if (!usedSlots.has(1)) {
          slot = 1;
        } else if (!usedSlots.has(2)) {
          slot = 2;
        }

        if (!slot) {
          return res.status(409).json({
            error:
              'هذا الموعد مكتمل. اختر وقتًا آخر.'
          });
        }

        const queueResult =
          await db.execute({
            sql: `
              SELECT
                COALESCE(
                  MAX(queue),
                  0
                ) + 1 AS next_queue
              FROM bookings
              WHERE date = ?
            `,
            args: [date]
          });

        const queue =
          Number(
            queueResult.rows[0]?.next_queue || 1
          );

        const token =
          makeToken();

        try {
          await db.execute({
            sql: `
              INSERT INTO bookings (
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
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)
            `,
            args: [
              token,
              name,
              phone,
              service,
              date,
              time,
              queue,
              slot,
              new Date().toISOString()
            ]
          });

          const bookingResult =
            await db.execute({
              sql: `
                SELECT *
                FROM bookings
                WHERE token = ?
                LIMIT 1
              `,
              args: [token]
            });

          return res.status(201).json({
            booking:
              bookingResult.rows[0]
          });
        } catch (insertError) {
          /*
            في حالة وجود تعارض متزامن،
            نعيد المحاولة بدل إعطاء العميل
            خطأ غير مفهوم.
          */

          const message =
            String(
              insertError?.message || ''
            );

          if (
            message.includes(
              'UNIQUE constraint'
            ) ||
            message.includes(
              'SQLITE_CONSTRAINT'
            )
          ) {
            continue;
          }

          throw insertError;
        }
      }

      return res.status(409).json({
        error:
          'تعذر حجز الموعد الآن. حاول مرة أخرى.'
      });
    } catch (error) {
      console.error(
        'create booking:',
        error
      );

      res.status(500).json({
        error:
          'تعذر إنشاء الحجز.'
      });
    }
  }
);

/* =========================================================
   حجز بواسطة token — العميل
========================================================= */

app.get(
  '/api/bookings/token/:token',
  async (req, res) => {
    try {
      const token =
        clean(req.params.token);

      const result =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE token = ?
            LIMIT 1
          `,
          args: [token]
        });

      const booking =
        result.rows[0];

      if (!booking) {
        return res.status(404).json({
          error:
            'الحجز غير موجود.'
        });
      }

      res.json(booking);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحميل الحجز.'
      });
    }
  }
);

/* =========================================================
   حجز بواسطة token — الإدارة
========================================================= */
app.get(
  '/api/admin/bookings/token/:token',
  requireAdmin,
  async (req, res) => {
    try {
      const token =
        clean(req.params.token);

      const result =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE token = ?
            LIMIT 1
          `,
          args: [token]
        });

      const booking =
        result.rows[0];

      if (!booking) {
        return res.status(404).json({
          error:
            'الحجز غير موجود.'
        });
      }

      res.json({
        booking
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحميل الحجز.'
      });
    }
  }
);

/* =========================================================
   حجوزات يوم معين
========================================================= */

app.get(
  '/api/bookings',
  requireAdmin,
  async (req, res) => {
    try {
      const date =
        clean(req.query.date) ||
        todayCairo();

      if (!isValidDate(date)) {
        return res.status(400).json({
          error:
            'التاريخ غير صحيح.'
        });
      }

      const result =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE date = ?
            ORDER BY
              queue ASC,
              time ASC,
              slot ASC
          `,
          args: [date]
        });

      res.json({
        bookings:
          result.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحميل الحجوزات.'
      });
    }
  }
);

/* =========================================================
   قائمة الانتظار العامة
========================================================= */

app.get(
  '/api/queue',
  async (req, res) => {
    try {
      const date =
        clean(req.query.date) ||
        todayCairo();

      const result =
        await db.execute({
          sql: `
            SELECT
              token,
              name,
              queue,
              time,
              status
            FROM bookings
            WHERE date = ?
              AND status IN (
                'waiting',
                'serving'
              )
            ORDER BY
              queue ASC
          `,
          args: [date]
        });

      const serving =
        result.rows.find(
          row => row.status === 'serving'
        ) || null;

      const waiting =
        result.rows.filter(
          row => row.status === 'waiting'
        );

      res.json({
        date,
        serving,
        waiting,
        queue:
          result.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحميل قائمة الانتظار.'
      });
    }
  }
);

/* =========================================================
   تغيير حالة الحجز
========================================================= */

app.patch(
  '/api/bookings/:token',
  requireAdmin,
  async (req, res) => {
    try {
      const token =
        clean(req.params.token);

      const status =
        clean(req.body.status);

      const allowedStatuses = [
        'waiting',
        'serving',
        'done',
        'cancelled'
      ];

      if (
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          error:
            'حالة الحجز غير صحيحة.'
        });
      }

      const existing =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE token = ?
            LIMIT 1
          `,
          args: [token]
        });

      const booking =
        existing.rows[0];

      if (!booking) {
        return res.status(404).json({
          error:
            'الحجز غير موجود.'
        });
      }

      /*
        لا نسمح بوجود أكثر من عميل
        جاري خدمته في نفس اليوم.
      */

      if (status === 'serving') {
        const current =
          await db.execute({
            sql: `
              SELECT *
              FROM bookings
              WHERE date = ?
                AND status = 'serving'
                AND token != ?
              LIMIT 1
            `,
            args: [
              booking.date,
              token
            ]
          });

        if (current.rows.length) {
          return res.status(409).json({
            error:
              `يوجد عميل حاليًا في الخدمة: ${current.rows[0].name}`
          });
        }
      }

      await db.execute({
        sql: `
          UPDATE bookings
          SET status = ?
          WHERE token = ?
        `,
        args: [
          status,
          token
        ]
      });

      const updated =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE token = ?
            LIMIT 1
          `,
          args: [token]
        });

      res.json({
        booking:
          updated.rows[0]
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحديث حالة الحجز.'
      });
    }
  }
);

/* =========================================================
   العميل التالي
========================================================= */

app.post(
  '/api/admin/next',
  requireAdmin,
  async (req, res) => {
    try {
      const date =
        clean(req.body.date) ||
        todayCairo();

      const current =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE date = ?
              AND status = 'serving'
            LIMIT 1
          `,
          args: [date]
        });

      if (current.rows.length) {
        return res.status(409).json({
          error:
            'يوجد عميل حاليًا في الخدمة. أنهِ الخدمة أولاً.'
        });
      }

      const next =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE date = ?
              AND status = 'waiting'
            ORDER BY
              queue ASC
            LIMIT 1
          `,
          args: [date]
        });

      const booking =
        next.rows[0];

      if (!booking) {
        return res.status(404).json({
          error:
            'لا يوجد عميل في قائمة الانتظار.'
        });
      }

      await db.execute({
        sql: `
          UPDATE bookings
          SET status = 'serving'
          WHERE token = ?
        `,
        args: [booking.token]
      });

      const updated =
        await db.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE token = ?
            LIMIT 1
          `,
          args: [booking.token]
        });

      res.json({
        booking:
          updated.rows[0]
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر استدعاء العميل التالي.'
      });
    }
  }
);

/* =========================================================
   المستخدمون — عرض
========================================================= */

app.get(
  '/api/admin/users',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const result =
        await db.execute({
          sql: `
            SELECT
              id,
              username,
              name,
              role,
              active,
              created_at
            FROM admin_users
            ORDER BY id ASC
          `,
          args: []
        });

      res.json({
        users:
          result.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر تحميل المستخدمين.'
      });
    }
  }
);

/* =========================================================
   المستخدمون — إضافة
========================================================= */

app.post(
  '/api/admin/users',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const name =
        clean(req.body.name);

      const username =
        normalizeUsername(
          req.body.username
        );

      const password =
        String(
          req.body.password || ''
        );

      const role =
        clean(req.body.role) ||
        'staff';

      if (
        !name ||
        !username ||
        !password
      ) {
        return res.status(400).json({
          error:
            'جميع بيانات المستخدم مطلوبة.'
        });
      }

      if (username.length < 3) {
        return res.status(400).json({
          error:
            'اسم المستخدم قصير جدًا.'
        });
      }

      if (password.length < 4) {
        return res.status(400).json({
          error:
            'كلمة المرور قصيرة جدًا.'
        });
      }

      if (
        !['staff', 'admin'].includes(role)
      ) {
        return res.status(400).json({
          error:
            'صلاحية المستخدم غير صحيحة.'
        });
      }

      const passwordHash =
        hashPassword(password);

      try {
        const result =
          await db.execute({
            sql: `
              INSERT INTO admin_users (
                username,
                name,
                password_hash,
                role,
                active,
                created_at
              )
              VALUES (?, ?, ?, ?, 1, ?)
            `,
            args: [
              username,
              name,
              passwordHash,
              role,
              new Date().toISOString()
            ]
          });

        res.status(201).json({
          user: {
            id: Number(
              result.lastInsertRowid
            ),
            username,
            name,
            role,
            active: 1
          }
        });
      } catch (error) {
        const message =
          String(
            error?.message || ''
          );

        if (
          message.includes(
            'UNIQUE constraint'
          )
        ) {
          return res.status(409).json({
            error:
              'اسم المستخدم مستخدم بالفعل.'
          });
        }

        throw error;
      }
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر إنشاء المستخدم.'
      });
    }
  }
);

/* =========================================================
   المستخدمون — حذف
========================================================= */

app.delete(
  '/api/admin/users/:id',
  requireAdmin,
  requireOwner,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error:
            'معرف المستخدم غير صحيح.'
        });
      }

      const target =
        await db.execute({
          sql: `
            SELECT *
            FROM admin_users
            WHERE id = ?
            LIMIT 1
          `,
          args: [id]
        });

      const user =
        target.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            'المستخدم غير موجود.'
        });
      }

      if (user.role === 'owner') {
        return res.status(403).json({
          error:
            'لا يمكن حذف حساب المالك.'
        });
      }

      await db.execute({
        sql: `
          DELETE FROM admin_users
          WHERE id = ?
        `,
        args: [id]
      });

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر حذف المستخدم.'
      });
    }
  }
);

/* =========================================================
   Push Notifications
   اختيارية — تعمل فقط عند إضافة مفاتيح VAPID
========================================================= */

let webPush = null;

try {
  webPush = require('web-push');
} catch {
  webPush = null;
}

function pushConfigured() {
  return Boolean(
    webPush &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

if (pushConfigured()) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

app.get(
  '/api/push/public-key',
  requireAdmin,
  async (req, res) => {
    if (!pushConfigured()) {
      return res.status(404).json({
        error:
          'خدمة الإشعارات غير مفعلة.'
      });
    }

    res.json({
      publicKey:
        process.env.VAPID_PUBLIC_KEY
    });
  }
);

app.post(
  '/api/push/subscribe',
  requireAdmin,
  async (req, res) => {
    try {
      if (!pushConfigured()) {
        return res.status(404).json({
          error:
            'خدمة الإشعارات غير مفعلة.'
        });
      }

      const subscription =
        req.body;

      if (
        !subscription ||
        !subscription.endpoint
      ) {
        return res.status(400).json({
          error:
            'بيانات الاشتراك غير صحيحة.'
        });
      }

      await db.execute({
        sql: `
          INSERT INTO push_subscriptions (
            endpoint,
            subscription_json,
            created_at
          )
          VALUES (?, ?, ?)
          ON CONFLICT(endpoint)
          DO UPDATE SET
            subscription_json = excluded.subscription_json
        `,
        args: [
          subscription.endpoint,
          JSON.stringify(
            subscription
          ),
          new Date().toISOString()
        ]
      });

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'تعذر حفظ اشتراك الإشعارات.'
      });
    }
  }
);

/* =========================================================
   إرسال Push
========================================================= */

async function sendPushNotification(
  payload
) {
  if (!pushConfigured()) {
    return;
  }

  const result =
    await db.execute({
      sql: `
        SELECT
          id,
          endpoint,
          subscription_json
        FROM push_subscriptions
      `,
      args: []
    });

  for (const row of result.rows) {
    try {
      const subscription =
        JSON.parse(
          row.subscription_json
        );

      await webPush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error(
        'Push error:',
        error
      );

      const statusCode =
        error?.statusCode;

      if (
        statusCode === 404 ||
        statusCode === 410
      ) {
        await db.execute({
          sql: `
            DELETE FROM push_subscriptions
            WHERE id = ?
          `,
          args: [row.id]
        });
      }
    }
  }
}

/* =========================================================
   Health
========================================================= */

app.get(
  '/api/health',
  async (req, res) => {
    try {
      await initDatabase();

      await db.execute({
        sql: 'SELECT 1 AS ok',
        args: []
      });

      res.json({
        ok: true,
        database: 'turso',
        date: todayCairo()
      });
    } catch (error) {
      console.error(
        'health:',
        error
      );

      res.status(500).json({
        ok: false,
        database: 'error'
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
      path.join(
        __dirname,
        'admin.html'
      )
    );
  }
);

app.get(
  '/',
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );
  }
);

/* =========================================================
   أي مسار آخر
========================================================= */

app.get(
  '/{*splat}',
  (req, res) => {
    /*
      ملفات API لا يجب أن تصل هنا.
      لو وصل طلب HTML غير معروف، نرجع الموقع.
    */

    if (
      req.path.startsWith('/api/')
    ) {
      return res.status(404).json({
        error:
          'المسار غير موجود.'
      });
    }

    res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );
  }
);

/* =========================================================
   معالجة أخطاء Express
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      'Express error:',
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        'حدث خطأ غير متوقع في الخادم.'
    });
  }
);

/* =========================================================
   التشغيل
========================================================= */
if (require.main === module) {
  initDatabase()
    .then(() => {
      app.listen(
        PORT,
        () => {
          console.log(
            `YF Barber running on port ${PORT}`
          );
        }
      );
    })
    .catch(error => {
      console.error(
        'Failed to initialize database:',
        error
      );

      process.exit(1);
    });
}

module.exports = app;
