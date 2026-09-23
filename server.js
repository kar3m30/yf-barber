const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");
const QRCode = require("qrcode");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "9621";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "yf-barber-session-secret-change-me";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error("Missing Turso environment variables.");
}

const db = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

const sessions = new Map();

const BARBERS = [
  { id: "yousef", name: "يوسف فاروق" },
  { id: "barber2", name: "الحلاق الثاني" }
];

const SERVICES = [
  { id: "haircut", name: "قص شعر", price: 100 },
  { id: "beard", name: "حلاقة ذقن", price: 70 },
  { id: "combo", name: "قص شعر + ذقن", price: 150 }
];

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function makeTimeSlots() {
  const slots = [];

  for (let hour = 12; hour <= 24; hour++) {
    const realHour = hour === 24 ? 0 : hour;

    for (const minute of [0, 30]) {
      if (hour === 24 && minute === 30) continue;

      const displayHour =
        realHour === 0 ? 12 : realHour > 12 ? realHour - 12 : realHour;

      const suffix = realHour >= 12 ? "م" : "ص";

      slots.push({
        value: `${String(realHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        label: `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`
      });
    }
  }

  return slots;
}

const TIME_SLOTS = makeTimeSlots();

async function initDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barber_id TEXT NOT NULL,
      barber_name TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      slot_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      qr_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS unique_booking_slot
    ON bookings (
      booking_date,
      barber_id,
      booking_time,
      slot_number
    )
  `);

  console.log("Database initialized");
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    createdAt: Date.now()
  });

  return token;
}

function getSessionToken(req) {
  const cookies = String(req.headers.cookie || "");
  const match = cookies.match(/yf_admin_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isAdmin(req) {
  const token = getSessionToken(req);

  if (!token) return false;

  const session = sessions.get(token);

  if (!session) return false;

  const maxAge = 1000 * 60 * 60 * 12;

  if (Date.now() - session.createdAt > maxAge) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "غير مصرح"
    });
  }

  next();
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `yf_admin_session=${encodeURIComponent(
      token
    )}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "yf_admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
}

function getBarber(id) {
  return BARBERS.find((barber) => barber.id === id);
}

function getService(id) {
  return SERVICES.find((service) => service.id === id);
}

function bookingPublicData(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    barberId: row.barber_id,
    barberName: row.barber_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    date: row.booking_date,
    time: row.booking_time,
    slotNumber: row.slot_number,
    status: row.status,
    qrData: row.qr_data,
    createdAt: row.created_at
  };
}

app.get("/api/config", (req, res) => {
  res.json({
    barbers: BARBERS,
    services: SERVICES,
    timeSlots: TIME_SLOTS
  });
});

app.get("/api/availability", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const barber = String(req.query.barber || "");

    if (!validDate(date) || !getBarber(barber)) {
      return res.status(400).json({
        error: "بيانات التاريخ أو الحلاق غير صحيحة"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT booking_time, COUNT(*) AS count
        FROM bookings
        WHERE booking_date = ?
          AND barber_id = ?
          AND status != 'cancelled'
        GROUP BY booking_time
      `,
      args: [date, barber]
    });

    const counts = {};

    for (const row of result.rows) {
      counts[row.booking_time] = Number(row.count);
    }

    res.json({
      slots: TIME_SLOTS.map((slot) => ({
        ...slot,
        booked: counts[slot.value] || 0,
        available: Math.max(0, 2 - (counts[slot.value] || 0))
      }))
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "تعذر تحميل المواعيد"
    });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const customerName = String(req.body.customerName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const barberId = String(req.body.barberId || "");
    const serviceId = String(req.body.serviceId || "");
    const date = String(req.body.date || "");
    const time = String(req.body.time || "");

    if (!customerName || !phone) {
      return res.status(400).json({
        error: "يرجى إدخال اسم العميل ورقم الهاتف"
      });
    }

    if (!getBarber(barberId)) {
      return res.status(400).json({
        error: "الحلاق غير صحيح"
      });
    }

    if (!getService(serviceId)) {
      return res.status(400).json({
        error: "الخدمة غير صحيحة"
      });
    }

    if (!validDate(date)) {
      return res.status(400).json({
        error: "التاريخ غير صحيح"
      });
    }

    const validTime = TIME_SLOTS.some((slot) => slot.value === time);

    if (!validTime) {
      return res.status(400).json({
        error: "الموعد غير صحيح"
      });
    }

    const today = cairoDate();

    if (date < today) {
      return res.status(400).json({
        error: "لا يمكن الحجز بتاريخ سابق"
      });
    }

    const barber = getBarber(barberId);
    const service = getService(serviceId);

    const existing = await db.execute({
      sql: `
        SELECT slot_number
        FROM bookings
        WHERE booking_date = ?
          AND barber_id = ?
          AND booking_time = ?
          AND status != 'cancelled'
        ORDER BY slot_number
      `,
      args: [date, barberId, time]
    });

    const usedSlots = new Set(
      existing.rows.map((row) => Number(row.slot_number))
    );

    let slotNumber = null;

    for (let i = 1; i <= 2; i++) {
      if (!usedSlots.has(i)) {
        slotNumber = i;
        break;
      }
    }

    if (!slotNumber) {
      return res.status(409).json({
        error: "هذا الموعد مكتمل. الحد الأقصى شخصان في نفس الموعد."
      });
    }

    const result = await db.execute({
      sql: `
        INSERT INTO bookings (
          customer_name,
          phone,
          barber_id,
          barber_name,
          service_id,
          service_name,
          booking_date,
          booking_time,
          slot_number,
          status,
          qr_data
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', '')
      `,
      args: [
        customerName,
        phone,
        barberId,
        barber.name,
        serviceId,
        service.name,
        date,
        time,
        slotNumber
      ]
    });

    const bookingId = Number(result.lastInsertRowid);

    const finalQrData = `https://${req.get(
      "host"
    )}/?booking=${bookingId}`;

    await db.execute({
      sql: `
        UPDATE bookings
        SET qr_data = ?
        WHERE id = ?
      `,
      args: [finalQrData, bookingId]
    });

    const qrCode = await QRCode.toDataURL(finalQrData, {
      width: 300,
      margin: 2
    });

    const bookingResult = await db.execute({
      sql: `SELECT * FROM bookings WHERE id = ?`,
      args: [bookingId]
    });

    const booking = bookingPublicData(bookingResult.rows[0]);

    res.status(201).json({
      booking,
      qrCode
    });
  } catch (error) {
    console.error(error);

    if (
      String(error.message || "").toLowerCase().includes("unique")
    ) {
      return res.status(409).json({
        error: "تم حجز هذا الموعد للتو. اختر موعدًا آخر."
      });
    }

    res.status(500).json({
      error: "تعذر إنشاء الحجز"
    });
  }
});

app.get("/api/bookings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "رقم الحجز غير صحيح"
      });
    }

    const result = await db.execute({
      sql: `SELECT * FROM bookings WHERE id = ?`,
      args: [id]
    });

    if (!result.rows.length) {
      return res.status(404).json({
        error: "الحجز غير موجود"
      });
    }

    res.json({
      booking: bookingPublicData(result.rows[0])
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "تعذر تحميل الحجز"
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({
      error: "اسم المستخدم أو كلمة المرور غير صحيحة"
    });
  }

  const token = createSession();

  setSessionCookie(res, token);

  res.json({
    ok: true
  });
});

app.post("/api/admin/logout", (req, res) => {
  const token = getSessionToken(req);

  if (token) {
    sessions.delete(token);
  }

  clearSessionCookie(res);

  res.json({
    ok: true
  });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({
    loggedIn: true
  });
});

app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const date = String(req.query.date || cairoDate());
    const barber = String(req.query.barber || "");

    let result;

    if (barber) {
      result = await db.execute({
        sql: `
          SELECT *
          FROM bookings
          WHERE booking_date = ?
            AND barber_id = ?
          ORDER BY booking_time, slot_number, id
        `,
        args: [date, barber]
      });
    } else {
      result = await db.execute({
        sql: `
          SELECT *
          FROM bookings
          WHERE booking_date = ?
          ORDER BY booking_time, slot_number, id
        `,
        args: [date]
      });
    }

    res.json({
      bookings: result.rows.map(bookingPublicData)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "تعذر تحميل الحجوزات"
    });
  }
});

app.post(
  "/api/admin/bookings/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body.status || "");

      const allowed = [
        "waiting",
        "called",
        "completed",
        "cancelled"
      ];

      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: "حالة غير صحيحة"
        });
      }

      const result = await db.execute({
        sql: `
          UPDATE bookings
          SET status = ?
          WHERE id = ?
        `,
        args: [status, id]
      });

      if (Number(result.rowsAffected) === 0) {
        return res.status(404).json({
          error: "الحجز غير موجود"
        });
      }

      const bookingResult = await db.execute({
        sql: `SELECT * FROM bookings WHERE id = ?`,
        args: [id]
      });

      res.json({
        booking: bookingPublicData(bookingResult.rows[0])
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "تعذر تحديث حالة الحجز"
      });
    }
  }
);

app.post("/api/admin/next", requireAdmin, async (req, res) => {
  try {
    const date = String(req.body.date || cairoDate());
    const barberId = String(req.body.barberId || "");

    if (!getBarber(barberId)) {
      return res.status(400).json({
        error: "الحلاق غير صحيح"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT *
        FROM bookings
        WHERE booking_date = ?
          AND barber_id = ?
          AND status = 'waiting'
        ORDER BY booking_time, slot_number, id
        LIMIT 1
      `,
      args: [date, barberId]
    });

    if (!result.rows.length) {
      return res.status(404).json({
        error: "لا يوجد عميل منتظر"
      });
    }

    const booking = result.rows[0];

    await db.execute({
      sql: `
        UPDATE bookings
        SET status = 'called'
        WHERE id = ?
      `,
      args: [booking.id]
    });

    const updated = await db.execute({
      sql: `SELECT * FROM bookings WHERE id = ?`,
      args: [booking.id]
    });

    res.json({
      booking: bookingPublicData(updated.rows[0])
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "تعذر استدعاء العميل التالي"
    });
  }
});

app.get(
  "/api/admin/scan/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = await db.execute({
        sql: `SELECT * FROM bookings WHERE id = ?`,
        args: [id]
      });

      if (!result.rows.length) {
        return res.status(404).json({
          error: "الحجز غير موجود"
        });
      }

      res.json({
        booking: bookingPublicData(result.rows[0])
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "تعذر قراءة الحجز"
      });
    }
  }
);

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    error: "حدث خطأ في الخادم"
  });
});

if (require.main === module) {
  initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`YF Barber running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Database initialization failed:", error);
      process.exit(1);
    });
} else {
  initDatabase().catch((error) => {
    console.error("Database initialization failed:", error);
  });
}

module.exports = app;
