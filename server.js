const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "karemadmin").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "011963");
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || "change-this-secret-before-production");

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.warn("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not configured.");
}

const db = createClient({
  url: TURSO_DATABASE_URL || "libsql://invalid.local",
  authToken: TURSO_AUTH_TOKEN || "invalid"
});

const SERVICES = ["قص شعر","حلاقة","قص شعر + حلاقة","أطفال"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function dateNotPast(value) {
  return value >= todayLocal();
}

function timeSlots() {
  const out = [];
  for (let h = 12; h <= 23; h++) out.push(`${pad(h)}:00`);
  out.push("00:00", "01:00");
  return out;
}

function validTime(value) {
  return timeSlots().includes(value);
}

function clean(value, max=200) {
  return String(value ?? "").trim().slice(0, max);
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function sign(value) {
  return crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(value).digest("base64url");
}

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: ADMIN_USERNAME,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readAdminToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function verifyAdmin(req) {
  const token = readAdminToken(req);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;\n  const expected = sign(payload);\n  if (signature.length !== expected.length) return false;\n  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub === ADMIN_USERNAME && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function adminOnly(req, res, next) {
  if (!verifyAdmin(req)) return res.status(401).json({error:"جلسة الإدارة غير صالحة. سجّل الدخول من جديد."});
  next();
}

async function initDatabase() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      slot INTEGER NOT NULL,
      queue INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date,time)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_date_queue ON bookings(date,queue)`
  ], "write");
}

app.use(express.json({limit:"100kb"}));
app.use(express.urlencoded({extended:false}));

app.get("/", (req,res) => res.sendFile(path.join(__dirname,"index.html")));
app.get("/admin", (req,res) => res.sendFile(path.join(__dirname,"admin.html")));
app.use(express.static(__dirname, {index:false, maxAge:0}));

app.get("/api/health", async (req,res) => {
  try {
    await db.execute("SELECT 1 AS ok");
    res.json({ok:true});
  } catch (e) {
    res.status(500).json({ok:false,error:"قاعدة البيانات غير متاحة"});
  }
});

app.get("/api/availability", async (req,res) => {
  const date = clean(req.query.date, 10);
  if (!validDate(date)) return res.status(400).json({error:"التاريخ غير صحيح."});
  if (!dateNotPast(date)) return res.status(400).json({error:"لا يمكن اختيار تاريخ سابق."});

  try {
    const result = await db.execute({
      sql: `SELECT time, COUNT(*) AS count
            FROM bookings
            WHERE date = ? AND status = 'active'
            GROUP BY time`,
      args: [date]
    });
    const counts = new Map(result.rows.map(r => [String(r.time), Number(r.count)]));
    const slots = timeSlots().map(time => ({
      time: `${time}|${displayTime(time)}`,
      count: counts.get(time) || 0
    }));
    res.json({date,slots});
  } catch (e) {
    console.error("availability", e);
    res.status(500).json({error:"تعذر تحميل المواعيد."});
  }
});

function displayTime(time) {
  const [hh] = time.split(":").map(Number);
  if (hh === 0) return "12:00 ص";
  if (hh === 1) return "1:00 ص";
  if (hh === 12) return "12:00 م";
  return `${hh > 12 ? hh - 12 : hh}:00 م`;
}

app.post("/api/bookings", async (req,res) => {
  const name = clean(req.body.name, 80);
  const phone = clean(req.body.phone, 30);
  const service = clean(req.body.service, 40);
  const date = clean(req.body.date, 10);
  const time = clean(req.body.time, 5);

  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({error:"أكمل جميع بيانات الحجز."});
  }
  if (!SERVICES.includes(service)) return res.status(400).json({error:"الخدمة غير صحيحة."});
  if (!validDate(date) || !dateNotPast(date)) return res.status(400).json({error:"التاريخ غير صحيح أو سابق."});
  if (!validTime(time)) return res.status(400).json({error:"الوقت غير متاح."});

  try {
    // عملية INSERT واحدة: شرط COUNT يمنع إدخال الحجز الثالث لنفس اليوم/الوقت.
    // كما يتم حساب المقعد والدور داخل نفس العملية.
    const token = randomToken();

    const insertResult = await db.execute({
      sql: `INSERT INTO bookings
        (token,name,phone,service,date,time,slot,queue,status)
        SELECT ?,?,?,?,?,?,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM bookings
              WHERE date = ? AND time = ? AND status = 'active' AND slot = 1
            ) THEN 2
            ELSE 1
          END,
          COALESCE((
            SELECT MAX(queue)+1 FROM bookings
            WHERE date = ? AND status = 'active'
          ),1),
          'active'
        WHERE (
          SELECT COUNT(*) FROM bookings
          WHERE date = ? AND time = ? AND status = 'active'
        ) < 2`,
      args: [
        token,name,phone,service,date,time,
        date,time,
        date,
        date,time
      ]
    });

    if (Number(insertResult.rowsAffected || 0) !== 1) {
      return res.status(409).json({error:"هذا الموعد مكتمل. اختر وقتًا آخر."});
    }

    const result = await db.execute({
      sql: `SELECT id,token,name,phone,service,date,time,slot,queue,status,created_at
            FROM bookings WHERE token = ?`,
      args: [token]
    });

    res.status(201).json({booking: result.rows[0]});
  } catch (e) {
    console.error("create booking", e);
    if (String(e.message || "").includes("UNIQUE")) {
      return res.status(409).json({error:"تعذر تثبيت الحجز بسبب محاولة متزامنة. اختر الوقت مرة أخرى."});
    }
    res.status(500).json({error:"تعذر حفظ الحجز. تأكد من اتصال قاعدة البيانات ثم حاول مرة أخرى."});
  }
});

app.get("/api/bookings/token/:token", async (req,res) => {
  const token = clean(req.params.token, 100);
  try {
    const result = await db.execute({
      sql: `SELECT id,token,name,phone,service,date,time,slot,queue,status,created_at
            FROM bookings WHERE token = ?`,
      args: [token]
    });
    if (!result.rows.length) return res.status(404).json({error:"الحجز غير موجود."});
    res.json({booking:result.rows[0]});
  } catch (e) {
    console.error("token lookup", e);
    res.status(500).json({error:"تعذر قراءة الحجز."});
  }
});

app.post("/api/admin/login", async (req,res) => {
  const username = clean(req.body.username, 80).toLowerCase();
  const password = String(req.body.password ?? "");

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({error:"اسم المستخدم أو كلمة المرور غير صحيحة."});
  }

  res.json({
    token:createAdminToken(),
    user:{username:ADMIN_USERNAME, name:"مدير يوسف فاروق", role:"owner"}
  });
});

app.get("/api/admin/me", adminOnly, (req,res) => {
  res.json({user:{username:ADMIN_USERNAME,name:"مدير يوسف فاروق",role:"owner"}});
});

app.get("/api/admin/bookings", adminOnly, async (req,res) => {
  const date = clean(req.query.date,10);
  const status = clean(req.query.status,20);
  if (!validDate(date)) return res.status(400).json({error:"التاريخ غير صحيح."});

  try {
    let sql = `SELECT id,token,name,phone,service,date,time,slot,queue,status,created_at
               FROM bookings WHERE date = ?`;
    const args = [date];
    if (status === "active" || status === "cancelled") {
      sql += " AND status = ?";
      args.push(status);
    }
    sql += " ORDER BY time ASC, slot ASC, queue ASC";
    const result = await db.execute({sql,args});
    res.json({bookings:result.rows});
  } catch (e) {
    console.error("admin bookings", e);
    res.status(500).json({error:"تعذر تحميل الحجوزات."});
  }
});

app.post("/api/admin/bookings/:id/cancel", adminOnly, async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({error:"رقم الحجز غير صحيح."});

  try {
    const result = await db.execute({
      sql:`UPDATE bookings SET status='cancelled' WHERE id=? AND status='active'`,
      args:[id]
    });
    if (Number(result.rowsAffected || 0) === 0) {
      return res.status(404).json({error:"الحجز غير موجود أو ملغي مسبقًا."});
    }
    res.json({ok:true});
  } catch (e) {
    console.error("cancel", e);
    res.status(500).json({error:"تعذر إلغاء الحجز."});
  }
});

const server = app.listen(PORT, () => {
  console.log(`YF Barber running on port ${PORT}`);
});

initDatabase().catch(err => {
  console.error("Database initialization failed:", err);
});

module.exports = app;
