const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@libsql/client');

const app = express();
app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;
if (!dbUrl || !dbToken) console.warn('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not set.');
const db = createClient({url: dbUrl || 'file:local.db', authToken: dbToken});
const ADMIN_USER = 'karemadmin';
const ADMIN_PASS = '011963';
const SECRET = process.env.ADMIN_TOKEN_SECRET || 'yf-change-this-secret';
const TIMES = ['12:00 ظهرًا','12:30 ظهرًا','1:00 مساءً','1:30 مساءً','2:00 مساءً','2:30 مساءً','3:00 مساءً','3:30 مساءً','4:00 مساءً','4:30 مساءً','5:00 مساءً','5:30 مساءً','6:00 مساءً','6:30 مساءً','7:00 مساءً','7:30 مساءً','8:00 مساءً','8:30 مساءً','9:00 مساءً','9:30 مساءً','10:00 مساءً','10:30 مساءً','11:00 مساءً','11:30 مساءً','12:00 منتصف الليل','12:30 بعد منتصف الليل'];
const SERVICES = ['قص شعر','قص شعر ولحية','لحية','تصفيف'];

async function init(){
  await db.batch([
    {sql:`CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, slot INTEGER NOT NULL, queue INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at TEXT NOT NULL)`,args:[]},
    {sql:`CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_slot ON bookings(date,time,slot)`,args:[]},
    {sql:`CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_queue ON bookings(date,queue)`,args:[]},
    {sql:`CREATE INDEX IF NOT EXISTS idx_booking_date ON bookings(date)`,args:[]}
  ]);
}
function today(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date()); }
function validDate(d){ return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today(); }
function token(){ return crypto.randomBytes(18).toString('hex'); }
function sign(payload){ const body=Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig=crypto.createHmac('sha256',SECRET).update(body).digest('base64url'); return body+'.'+sig; }
function verify(t){ try{const [b,s]=String(t||'').split('.'); if(!b||!s)return null; const e=crypto.createHmac('sha256',SECRET).update(b).digest('base64url'); if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return null; const p=JSON.parse(Buffer.from(b,'base64url').toString()); return p.exp>Date.now()?p:null;}catch{return null;} }
function auth(req,res,next){ const p=verify((req.headers.authorization||'').replace(/^Bearer\s+/i,'')); if(!p)return res.status(401).json({error:'غير مصرح'}); req.admin=p; next(); }
function cleanBooking(r){return r ? {...r, slot:Number(r.slot), queue:Number(r.queue)} : null;}

app.get('/api/health',(req,res)=>res.json({ok:true,date:today()}));
app.get('/api/meta',(req,res)=>res.json({today:today(),times:TIMES,services:SERVICES}));

app.post('/api/bookings',async(req,res)=>{
  try{
    const {name,phone,service,date,time}=req.body||{};
    if(!name||!phone||!service||!date||!time)return res.status(400).json({error:'أكمل جميع البيانات.'});
    if(!validDate(date))return res.status(400).json({error:'التاريخ غير صالح.'});
    if(!SERVICES.includes(service)||!TIMES.includes(time))return res.status(400).json({error:'الخدمة أو الوقت غير صالح.'});
    for(let attempt=0;attempt<5;attempt++){
      const c=await db.execute({sql:'SELECT slot FROM bookings WHERE date=? AND time=? AND status<>? ORDER BY slot',args:[date,time,'cancelled']});
      const used=new Set(c.rows.map(r=>Number(r.slot)));
      const slot=used.has(1)?(used.has(2)?null:2):1;
      if(!slot)return res.status(409).json({error:'هذا الموعد مكتمل. اختر وقتًا آخر.'});
      const q=await db.execute({sql:'SELECT COALESCE(MAX(queue),0)+1 AS n FROM bookings WHERE date=? AND status<>?',args:[date,'cancelled']});
      const queue=Number(q.rows[0].n)||1;
      const t=token();
      try{
        await db.execute({sql:'INSERT INTO bookings(token,name,phone,service,date,time,slot,queue,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[t,String(name).trim(),String(phone).trim(),service,date,time,slot,queue,'waiting',new Date().toISOString()]});
        const r=await db.execute({sql:'SELECT * FROM bookings WHERE token=?',args:[t]});
        return res.status(201).json({booking:cleanBooking(r.rows[0])});
      }catch(e){ if(!/UNIQUE|constraint/i.test(e.message))throw e; }
    }
    return res.status(409).json({error:'تعذر حجز الموعد الآن، حاول مرة أخرى.'});
  }catch(e){console.error(e);res.status(500).json({error:'حدث خطأ في الخادم.'});}
});

app.get('/api/bookings/token/:token',async(req,res)=>{try{const r=await db.execute({sql:'SELECT * FROM bookings WHERE token=?',args:[req.params.token]}); if(!r.rows[0])return res.status(404).json({error:'الحجز غير موجود.'}); res.json({booking:cleanBooking(r.rows[0])});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});
app.get('/api/queue',async(req,res)=>{try{const d=req.query.date; if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return res.status(400).json({error:'تاريخ غير صالح.'}); const r=await db.execute({sql:`SELECT id,token,name,phone,service,date,time,slot,queue,status,created_at FROM bookings WHERE date=? AND status<>'cancelled' ORDER BY queue`,args:[d]}); res.json({bookings:r.rows.map(cleanBooking)});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});

app.post('/api/admin/login',async(req,res)=>{const {username,password}=req.body||{}; if(username!==ADMIN_USER||password!==ADMIN_PASS)return res.status(401).json({error:'اسم المستخدم أو الرمز غير صحيح.'}); res.json({token:sign({sub:ADMIN_USER,exp:Date.now()+1000*60*60*12}),user:ADMIN_USER});});
app.get('/api/admin/me',auth,(req,res)=>res.json({user:req.admin.sub}));
app.get('/api/admin/bookings',auth,async(req,res)=>{try{const d=req.query.date||today(); const r=await db.execute({sql:'SELECT * FROM bookings WHERE date=? ORDER BY queue',args:[d]});res.json({bookings:r.rows.map(cleanBooking)});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});
app.post('/api/admin/next',auth,async(req,res)=>{try{const d=req.body?.date||today(); const serving=await db.execute({sql:`SELECT * FROM bookings WHERE date=? AND status='serving' LIMIT 1`,args:[d]}); if(serving.rows[0])return res.status(409).json({error:'أنهِ خدمة العميل الحالي أولًا.'}); const n=await db.execute({sql:`SELECT * FROM bookings WHERE date=? AND status='waiting' ORDER BY queue LIMIT 1`,args:[d]}); if(!n.rows[0])return res.status(404).json({error:'لا يوجد عميل منتظر.'}); await db.execute({sql:`UPDATE bookings SET status='serving' WHERE id=?`,args:[n.rows[0].id]}); const r=await db.execute({sql:'SELECT * FROM bookings WHERE id=?',args:[n.rows[0].id]});res.json({booking:cleanBooking(r.rows[0])});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});
app.patch('/api/admin/bookings/:id',auth,async(req,res)=>{try{const id=Number(req.params.id);const status=req.body?.status; if(!['waiting','serving','done','cancelled'].includes(status))return res.status(400).json({error:'حالة غير صالحة.'}); if(status==='serving'){const x=await db.execute({sql:`SELECT date FROM bookings WHERE id=?`,args:[id]}); if(!x.rows[0])return res.status(404).json({error:'الحجز غير موجود.'}); const s=await db.execute({sql:`SELECT id FROM bookings WHERE date=? AND status='serving' AND id<>? LIMIT 1`,args:[x.rows[0].date,id]}); if(s.rows[0])return res.status(409).json({error:'يوجد عميل قيد الخدمة بالفعل.'});} await db.execute({sql:'UPDATE bookings SET status=? WHERE id=?',args:[status,id]}); const r=await db.execute({sql:'SELECT * FROM bookings WHERE id=?',args:[id]});res.json({booking:cleanBooking(r.rows[0])});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});
app.get('/api/admin/scan/:token',auth,async(req,res)=>{try{const r=await db.execute({sql:'SELECT * FROM bookings WHERE token=?',args:[req.params.token]});if(!r.rows[0])return res.status(404).json({error:'QR غير معروف.'});res.json({booking:cleanBooking(r.rows[0])});}catch(e){res.status(500).json({error:'حدث خطأ.'});}});

app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
init().then(()=>app.listen(PORT,()=>console.log(`YF Barber running on ${PORT}`))).catch(e=>{console.error('DB init failed',e);process.exit(1);});
