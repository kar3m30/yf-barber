// Admin Dashboard JS
let currentBookings = [];
let selectedAdminDate = getLocalDate();
let adminLiveRefreshTimer = null;
let adminLastBookingsSignature = '';
let adminUser = null;
let adminHeartbeatTimer = null;


function getLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

document.addEventListener('DOMContentLoaded', () => { checkAuth(); setupEvents(); });

async function checkAuth() {
  const token = sessionStorage.getItem('yf_admin_token') || '';
  if (!token) {
    adminUser = null;
    document.getElementById('login-overlay')?.classList.remove('hidden');
    document.getElementById('admin-app')?.classList.add('hidden');
    stopAdminLiveRefresh();
    stopHeartbeat();
    closeQrScanner();
    return;
  }
  try {
    const res = await fetch('/api/admin/me', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error();
    adminUser = data.user;
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('admin-app')?.classList.remove('hidden');
    document.getElementById('admin-user-name').textContent = adminUser.name;
    document.getElementById('owner-tools')?.classList.toggle('hidden', adminUser.role !== 'owner');
    initAdminData(); startAdminLiveRefresh(); startHeartbeat(); setTimeout(startAutoQrScanner, 250);
    if (adminUser.role === 'owner') { loadAdminUsers(); loadActivity(); }
  } catch {
    sessionStorage.removeItem('yf_admin_token');
    sessionStorage.removeItem('yf_admin_session');
    adminUser = null;
    document.getElementById('login-overlay')?.classList.remove('hidden');
    document.getElementById('admin-app')?.classList.add('hidden');
    stopAdminLiveRefresh(); stopHeartbeat(); closeQrScanner();
  }
}

function setupEvents() {
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (data.success) { sessionStorage.setItem('yf_admin_token', data.token); sessionStorage.setItem('yf_admin_session', 'true'); await checkAuth(); }
      else document.getElementById('login-error').textContent = data.error || 'بيانات الدخول غير صحيحة';
    } catch (e) { document.getElementById('login-error').textContent = 'تعذر الاتصال بالخادم'; }
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => { const token=sessionStorage.getItem('yf_admin_token'); try { if(token) await fetch('/api/admin/logout',{method:'POST',headers:{Authorization:'Bearer '+token}}); } catch(e){} closeQrScanner(); sessionStorage.removeItem('yf_admin_session'); sessionStorage.removeItem('yf_admin_token'); await checkAuth(); });
  document.getElementById('btn-refresh')?.addEventListener('click', () => loadBookings(selectedAdminDate));
  document.getElementById('btn-call-next')?.addEventListener('click', callNextCustomer);
  setupQrScanner();

  const datePicker = document.getElementById('admin-date-picker');
  if (datePicker) { datePicker.value = selectedAdminDate; datePicker.addEventListener('change', e => { selectedAdminDate = e.target.value; loadBookings(selectedAdminDate); }); }
}

async function initAdminData() { await loadBookings(selectedAdminDate); }

function startAdminLiveRefresh() {
  stopAdminLiveRefresh();
  adminLiveRefreshTimer = setInterval(() => {
    if (sessionStorage.getItem('yf_admin_session') === 'true') loadBookings(selectedAdminDate, true);
  }, 3000);
}

function stopAdminLiveRefresh() {
  if (adminLiveRefreshTimer) { clearInterval(adminLiveRefreshTimer); adminLiveRefreshTimer = null; }
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'waiting' || s === 'pending') return 'confirmed';
  if (s === 'serving') return 'in_chair';
  if (s === 'done') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return s || 'confirmed';
}

function normalizeBooking(b) {
  return {
    ...b,
    id: b.id ?? b.bookingId ?? b.booking_id ?? b.token ?? b.bookingCode ?? b.booking_code,
    queueNumber: b.queueNumber ?? b.queue_number ?? b.queue,
    bookingCode: b.bookingCode ?? b.booking_code ?? b.token,
    customerName: b.customerName ?? b.customer_name ?? b.name,
    serviceName: b.serviceName ?? b.service_name ?? b.service,
    timeSlot: b.timeSlot ?? b.time_slot ?? b.time,
    status: normalizeStatus(b.status),
    calledByName: b.calledByName ?? b.called_by_name ?? b.servedByName ?? b.served_by_name ?? ''
  };
}

async function loadBookings(date, silent = false) {
  try {
    const token = sessionStorage.getItem('yf_admin_token') || '';
    const res = await fetch(`/api/admin/bookings?date=${encodeURIComponent(date)}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'API error');
    const nextBookings = data.bookings.map(normalizeBooking);
    const signature = JSON.stringify(nextBookings);
    if (signature !== adminLastBookingsSignature) {
      currentBookings = nextBookings;
      adminLastBookingsSignature = signature;
      renderTable();
      updateStats();
    }
  } catch (e) { console.error(e); currentBookings = []; renderTable(); updateStats(); }
}

function renderTable() {
  const tbody = document.getElementById('admin-table-body'); if (!tbody) return; tbody.innerHTML = '';
  if (!currentBookings.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#888;">لا توجد حجوزات لهذا اليوم</td></tr>'; return; }
  currentBookings.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-weight:bold; font-family:'Cinzel',serif;">#${b.queueNumber}</td><td style="font-family:monospace; color:#d4af37;">${b.bookingCode}</td><td style="font-weight:bold;">${b.customerName}</td><td dir="ltr" style="font-size:12px;">${b.phone}</td><td>${b.serviceName}</td><td style="font-family:'Cinzel',serif; font-size:12px;">${b.timeSlot}</td><td><span class="badge badge-${b.status}">${getStatusName(b.status)}</span></td><td>${b.calledByName ? '✂ ' + escapeHtml(b.calledByName) : '—'}</td><td><div class="action-btn-row">${b.status === 'confirmed' ? `<button class="btn-sm btn-sm-chair" onclick="updateStatus('${b.id}', 'in_chair')">على الكرسي</button>` : ''}${b.status === 'in_chair' ? `<button class="btn-sm btn-sm-done" onclick="updateStatus('${b.id}', 'completed')">اكتمل ✓</button>` : ''}${b.status !== 'cancelled' && b.status !== 'completed' ? `<button class="btn-sm btn-sm-cancel" onclick="updateStatus('${b.id}', 'cancelled')">إلغاء</button>` : ''}</div></td>`;
    tbody.appendChild(tr);
  });
}

function getStatusName(st) {
  switch (st) {
    case 'in_chair': return 'على الكرسي ✂';
    case 'completed': return 'مكتمل ✓';
    case 'cancelled': return 'ملغي';
    default: return 'في الانتظار';
  }
}

function updateStats() {
  const total = currentBookings.length;
  const inChair = currentBookings.find(b => b.status === 'in_chair');
  const waiting = currentBookings.filter(b => b.status === 'confirmed').length;
  const done = currentBookings.filter(b => b.status === 'completed').length;
  document.getElementById('stat-total').innerText = total;
  document.getElementById('stat-in-chair').innerText = inChair ? `#${inChair.queueNumber}` : '#—';
  document.getElementById('stat-chair-name').innerText = inChair ? inChair.customerName : 'لا يوجد';
  document.getElementById('stat-waiting').innerText = waiting;
  document.getElementById('stat-done').innerText = done;
}

window.updateStatus = async function(id, status) {
  if (!id || id === 'null' || id === 'undefined') {
    alert('تعذر تحديد الحجز. اضغط تحديث ثم حاول مرة أخرى.');
    return false;
  }
  try {
    const token = sessionStorage.getItem('yf_admin_token') || '';
    const res = await fetch(`/api/bookings/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ status })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.error || 'تعذر تحديث الحالة');
      return false;
    }
    await loadBookings(selectedAdminDate);
    return true;
  } catch (e) {
    console.error(e);
    alert('تعذر تحديث الحالة');
    return false;
  }
};

function startHeartbeat() {
  stopHeartbeat();
  adminHeartbeatTimer = setInterval(async () => {
    const token=sessionStorage.getItem('yf_admin_token'); if(!token) return;
    try { await fetch('/api/admin/heartbeat',{method:'POST',headers:{Authorization:'Bearer '+token}}); } catch(e) {}
  }, 60000);
}
function stopHeartbeat() { if(adminHeartbeatTimer){clearInterval(adminHeartbeatTimer);adminHeartbeatTimer=null;} }

async function loadAdminUsers() {
  if (adminUser?.role !== 'owner') return;
  const token=sessionStorage.getItem('yf_admin_token')||'';
  try {
    const res=await fetch('/api/admin/users',{headers:{Authorization:'Bearer '+token}}); const data=await res.json();
    const list=document.getElementById('admins-list'); if(!list)return;
    list.innerHTML=(data.users||[]).map(u=>`<div class="admin-user-item"><div><b>${escapeHtml(u.name)}</b><small>${escapeHtml(u.username)} · ${u.role==='owner'?'مالك':'مشرف'} · ${Number(u.active)?'نشط':'معطل'}</small></div>${u.role!=='owner'?`<div><button class="mini-btn" onclick="toggleAdmin('${u.id}',${Number(u.active)?'false':'true'})">${Number(u.active)?'تعطيل':'تفعيل'}</button><button class="mini-btn danger" onclick="deleteAdmin('${u.id}')">حذف</button></div>`:''}</div>`).join('')||'لا يوجد مشرفون بعد.';
  } catch(e) {}
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
window.addAdmin=async function(){
  const username=document.getElementById('new-admin-username').value.trim(), name=document.getElementById('new-admin-name').value.trim(), password=document.getElementById('new-admin-password').value; const token=sessionStorage.getItem('yf_admin_token')||'';
  try{const res=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({username,name,password})});const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر الإضافة');document.getElementById('new-admin-username').value='';document.getElementById('new-admin-name').value='';document.getElementById('new-admin-password').value='';await loadAdminUsers();alert('تمت إضافة المشرف');}catch(e){alert(e.message)}
};
window.toggleAdmin=async function(id,active){const token=sessionStorage.getItem('yf_admin_token')||'';try{const res=await fetch('/api/admin/users/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({active})});const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر التعديل');await loadAdminUsers();}catch(e){alert(e.message)}};
window.deleteAdmin=async function(id){if(!confirm('هل تريد حذف هذا المشرف؟'))return;const token=sessionStorage.getItem('yf_admin_token')||'';try{const res=await fetch('/api/admin/users/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+token}});const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر الحذف');await loadAdminUsers();}catch(e){alert(e.message)}};
async function loadActivity(){
  if(adminUser?.role!=='owner')return; const token=sessionStorage.getItem('yf_admin_token')||''; try{const res=await fetch('/api/admin/activity',{headers:{Authorization:'Bearer '+token}});const data=await res.json();const list=document.getElementById('activity-list');if(!list)return;list.innerHTML=(data.activity||[]).map(a=>{const start=new Date(a.login_at);const end=a.logout_at?new Date(a.logout_at):new Date(a.last_seen_at);const mins=Math.max(0,Math.round((end-start)/60000));const dur=mins<60?`${mins} د`:`${Math.floor(mins/60)} س ${mins%60} د`;return `<div class="activity-item"><div><b>${escapeHtml(a.user_name)}</b><small>${escapeHtml(a.username)} · دخول: ${start.toLocaleString('ar-EG')} · ${a.logout_at?'خروج: '+new Date(a.logout_at).toLocaleString('ar-EG'):'نشط الآن'}</small></div><strong>${dur}</strong><span>استدعاءات: ${a.called_count}</span></div>`}).join('')||'لا يوجد نشاط مسجل.';}catch(e){}
}

function showCalledCustomerDetails(booking, note = 'تم استدعاء العميل ونقله إلى الكرسي تلقائيًا') {
  const info = document.getElementById('called-customer-info');
  if (!info || !booking) return;
  const safe = (v) => escapeHtml(v);
  info.innerHTML = `
    <div class="ccd-title">تفاصيل العميل المستدعى</div>
    <div class="ccd-main">#${safe(booking.queueNumber)} — ${safe(booking.customerName)}</div>
    <div class="ccd-meta">${safe(booking.serviceName)} · الموعد ${safe(booking.timeSlot)} · رمز الحجز ${safe(booking.bookingCode)}</div>
    <div class="ccd-meta">المشرف: ${safe(booking.calledByName || adminUser?.name || '—')}</div>
    <div class="ccd-note">✓ ${safe(note)}</div>`;
  info.classList.remove('hidden');
}

async function callNextCustomer() {
  const next = currentBookings.find(b => b.status === 'confirmed' && b.id);
  if (!next) return alert('لا يوجد عملاء في قائمة الانتظار لهذا اليوم!');

  playCallChime();
  const updated = await window.updateStatus(next.id, 'in_chair');
  if (!updated) return;

  const fresh = currentBookings.find(b => String(b.id) === String(next.id)) || { ...next, status: 'in_chair', calledByName: adminUser?.name || '' };
  showCalledCustomerDetails(fresh);
}

let qrStream = null;
let qrScanFrameId = null;
let lastScannedQr = '';
let lastScannedAt = 0;

function setupQrScanner() {
}

async function startAutoQrScanner() {
  const video = document.getElementById('qr-video');
  const msg = document.getElementById('qr-scan-msg');
  const shell = document.getElementById('qr-scanner-modal');
  if (!video || !shell || sessionStorage.getItem('yf_admin_session') !== 'true' || qrStream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    if (msg) msg.textContent = 'الكاميرا غير مدعومة';
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = qrStream;
    await video.play();
    shell.classList.remove('hidden');
    if (msg) msg.textContent = 'الكاميرا تعمل';
    if (qrScanFrameId) cancelAnimationFrame(qrScanFrameId);
    scanQrFrame();
  } catch (e) {
    console.error('QR camera error:', e);
    if (msg) msg.textContent = 'اسمح للكاميرا من المتصفح';
  }
}

function scanQrFrame() {
  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-scan-canvas');
  if (!video || !canvas || !qrStream) return;

  if (video.readyState >= 2 && video.videoWidth && video.videoHeight && typeof jsQR === 'function') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });

    if (code?.data) {
      const now = Date.now();
      if (code.data !== lastScannedQr || now - lastScannedAt > 5000) {
        lastScannedQr = code.data;
        lastScannedAt = now;
        handleScannedCode(code.data);
      }
    }
  }
  qrScanFrameId = requestAnimationFrame(scanQrFrame);
}

function closeQrScanner() {
  if (qrScanFrameId) cancelAnimationFrame(qrScanFrameId);
  qrScanFrameId = null;
  if (qrStream) {
    qrStream.getTracks().forEach(track => track.stop());
    qrStream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
}

async function handleScannedCode(value) {
  const raw = String(value || '').trim();
  const code = raw.match(/YF-[A-Z0-9-]+/i)?.[0] || raw;
  const booking = currentBookings.find(b =>
    String(b.bookingCode || '').toLowerCase() === code.toLowerCase() ||
    String(b.token || '').toLowerCase() === code.toLowerCase()
  );

  if (!booking) {
    const info = document.getElementById('called-customer-info');
    if (info) {
      info.innerHTML = `<div class="ccd-title">QR غير معروف</div><div class="ccd-main">لم يتم العثور على الحجز</div><div class="ccd-meta">الرمز المقروء: ${escapeHtml(raw)}</div>`;
      info.classList.remove('hidden');
    }
    return;
  }

  if (booking.status === 'confirmed') {
    playCallChime();
    if (window.updateStatus) {
      const updated = await window.updateStatus(booking.id, 'in_chair');
      if (!updated) return;
    }
    const fresh = currentBookings.find(b => String(b.id) === String(booking.id)) || { ...booking, status: 'in_chair', calledByName: adminUser?.name || '' };
    showCalledCustomerDetails(fresh, 'تم مسح QR ونقل العميل إلى الكرسي تلقائيًا');
    const msg = document.getElementById('qr-scan-msg');
    if (msg) msg.textContent = 'تم مسح QR ونقل العميل إلى الكرسي';
    return;
  }

  if (booking.status === 'in_chair') {
    showCalledCustomerDetails(booking, 'العميل موجود بالفعل على الكرسي');
  } else if (booking.status === 'completed') {
    showCalledCustomerDetails(booking, 'هذا الحجز مكتمل');
  } else if (booking.status === 'cancelled') {
    showCalledCustomerDetails(booking, 'هذا الحجز ملغي');
  } else {
    showCalledCustomerDetails(booking, 'تمت قراءة الحجز');
  }
}

function playCallChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}
