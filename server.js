const express=require('express');
const path=require('path');
const crypto=require('crypto');
const sqlite3=require('sqlite3').verbose();
const app=express();
const PORT=process.env.PORT||3000;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'1987';
const db=new sqlite3.Database(process.env.DB_PATH||path.join(__dirname,'data.sqlite'));
app.use(express.json({limit:'100kb'}));
app.use(express.static(__dirname));
function run(sql,params=[]){return new Promise((res,rej)=>db.run(sql,params,function(e){if(e)rej(e);else res(this)}) )}
function get(sql,params=[]){return new Promise((res,rej)=>db.get(sql,params,(e,r)=>e?rej(e):res(r)))}
function all(sql,params=[]){return new Promise((res,rej)=>db.all(sql,params,(e,r)=>e?rej(e):res(r)))}
function init(){db.serialize(()=>{db.run(`CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, queue INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at TEXT NOT NULL)`);db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_date_queue ON bookings(date,queue)`);});}
init();
const sessions=new Map();
function auth(req,res,next){const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):'';if(!token||!sessions.has(token))return res.status(401).json({error:'غير مصرح'});next()}
const validTimes=['12:00 ظهرًا','12:30 ظهرًا','1:00 مساءً','1:30 مساءً','2:00 مساءً','2:30 مساءً','3:00 مساءً','3:30 مساءً','4:00 مساءً','4:30 مساءً','5:00 مساءً','5:30 مساءً','6:00 مساءً','6:30 مساءً','7:00 مساءً','7:30 مساءً','8:00 مساءً','8:30 مساءً','9:00 مساءً','9:30 مساءً','10:00 مساءً','10:30 مساءً','11:00 مساءً','11:30 مساءً','12:00 منتصف الليل','12:30 بعد منتصف الليل'];
const services={signature:'الحلاقة والتشذيب المميز',classic:'الحلاقة الكلاسيكية',beard:'تهذيب اللحية الملكية'};
function makeId(){return '#YF'+crypto.randomBytes(4).toString('hex').toUpperCase()}
function makeToken(){return crypto.randomUUID()}
app.post('/api/admin/login',(req,res)=>{if(String(req.body.password||'')!==ADMIN_PASSWORD)return res.status(401).json({error:'الرقم السري غير صحيح'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now());res.json({token})});
app.get('/api/bookings',async(req,res)=>{try{const date=String(req.query.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'تاريخ غير صحيح'});const rows=await all('SELECT * FROM bookings WHERE date=? ORDER BY queue ASC',[date]);res.json({bookings:rows})}catch(e){res.status(500).json({error:'تعذر تحميل الحجوزات'})}});
app.get('/api/bookings/token/:token',async(req,res)=>{try{const b=await get('SELECT * FROM bookings WHERE token=?',[req.params.token]);if(!b)return res.status(404).json({error:'الحجز غير موجود'});res.json(b)}catch(e){res.status(500).json({error:'تعذر قراءة الحجز'})}});
app.post('/api/bookings',async(req,res)=>{try{const name=String(req.body.name||'').trim(),phone=String(req.body.phone||'').trim(),date=String(req.body.date||''),time=String(req.body.time||''),key=String(req.body.serviceKey||'');if(name.length<2||name.length>80)return res.status(400).json({error:'اكتب اسم العميل بشكل صحيح'});if(!/^[0-9+()\-\s]{8,20}$/.test(phone))return res.status(400).json({error:'رقم الموبايل غير صحيح'});if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'التاريخ غير صحيح'});if(!validTimes.includes(time))return res.status(400).json({error:'الموعد غير متاح'});if(!services[key])return res.status(400).json({error:'الخدمة غير صحيحة'});const row=await get('SELECT COALESCE(MAX(queue),0)+1 AS q FROM bookings WHERE date=?',[date]);const b={id:makeId(),token:makeToken(),name,phone,service:services[key],date,time,queue:row.q,status:'waiting',created_at:new Date().toISOString()};await run('INSERT INTO bookings VALUES(?,?,?,?,?,?,?,?,?,?)',[b.id,b.token,b.name,b.phone,b.service,b.date,b.time,b.queue,b.status,b.created_at]);res.json({booking:b})}catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء الحجز'})}});
app.patch('/api/bookings/:token',auth,async(req,res)=>{try{const b=await get('SELECT * FROM bookings WHERE token=?',[req.params.token]);if(!b)return res.status(404).json({error:'الحجز غير موجود'});const status=String(req.body.status||'');if(!['waiting','serving','done','cancelled'].includes(status))return res.status(400).json({error:'حالة غير صحيحة'});if(status==='serving')await run("UPDATE bookings SET status='waiting' WHERE date=? AND status='serving' AND token<>?",[b.date,b.token]);await run('UPDATE bookings SET status=? WHERE token=?',[status,b.token]);res.json({ok:true,booking:await get('SELECT * FROM bookings WHERE token=?',[b.token])})}catch(e){res.status(500).json({error:'تعذر تحديث الحجز'})}});
app.post('/api/admin/next',auth,async(req,res)=>{try{const date=String(req.body.date||'');await run("UPDATE bookings SET status='done' WHERE date=? AND status='serving'",[date]);const b=await get("SELECT * FROM bookings WHERE date=? AND status='waiting' ORDER BY queue ASC LIMIT 1",[date]);if(!b)return res.json({booking:null});await run("UPDATE bookings SET status='serving' WHERE token=?",[b.token]);res.json({booking:await get('SELECT * FROM bookings WHERE token=?',[b.token])})}catch(e){res.status(500).json({error:'تعذر استدعاء التالي'})}});
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'YF_Barber_House.html')));
app.listen(PORT,()=>console.log(`YF Online running on port ${PORT}`));
