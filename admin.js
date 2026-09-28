// Admin Dashboard JS
let currentBookings = [];
let selectedAdminDate = getLocalDate();
let adminLiveRefreshTimer = null;
let adminLastBookingsSignature = '';
let adminToken = sessionStorage.getItem('yf_admin_token') || '';
let adminUser = null;

function getLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

document.addEventListener('DOMContentLoaded', () => { setupEvents(); checkAuth(); });

async function adminFetch(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (adminToken) opts.headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) {
    adminToken = '';
    adminUser = null;
    sessionStorage.removeItem('yf_admin_token');
    stopAdminLiveRefresh();
    document.getElementById('login-overlay')?.classList.remove('hidden');
    document.getElementById('admin-app')?.classList.add('hidden');
  }
  return { res, data };
}

async function checkAuth() {
  if (!adminToken) {
    showLoggedOut();
    return;
  }
  try {
    const { res, data } = await adminFetch('/api/admin/me');
    if (!res.ok || !data.success || !data.user) throw new Error(data.error || 'جلسة غير صالحة');
    adminUser = data.user;
    showLoggedIn();
    await initAdminData();
    startAdminLiveRefresh();
    setTimeout(startAutoQrScanner, 250);
  } catch (e) {
    adminToken = '';
    adminUser = null;
    sessionStorage.removeItem('yf_admin_token');
    showLoggedOut(e.message);
  }
}

function showLoggedIn() {
  document.getElementById('login-overlay')?.classList.add('hidden');
  document.getElementById('admin-app')?.classList.remove('hidden');
  const currentUser = document.getElementById('admin-current-user');
  if (currentUser && adminUser) currentUser.textContent = `👤 ${adminUser.name}`;
  const isOwner = adminUser?.role === 'owner' && adminUser?.username === 'karem.01';
  const ownerManagement = document.getElementById('owner-management');
  const adminActivity = document.getElementById('admin-activity');
  if (ownerManagement) ownerManagement.classList.toggle('hidden', !isOwner);
  if (adminActivity) adminActivity.classList.toggle('hidden', !isOwner);
  if (isOwner) { loadAdminUsers(); loadAdminActivity(); }
}

function showLoggedOut(message = '') {
  closeQrScanner();
  stopAdminLiveRefresh();
  document.getElementById('login-overlay')?.classList.remove('hidden');
  document.getElementById('admin-app')?.classList.add('hidden');
  document.getElementById('owner-management')?.classList.add('hidden');
  document.getElementById('admin-activity')?.classList.add('hidden');
  const err = document.getElementById('login-error');
  if (err) {
    err.textContent = message || '';
    err.classList.toggle('hidden', !message);
  }
}

function setupEvents() {
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const errorBox = document.getElementById('login-error');
    const submit = e.submitter || document.querySelector('#login-form button[type="submit"]');
    if (submit) submit.disabled = true;
    if (errorBox) { errorBox.textContent = ''; errorBox.classList.add('hidden'); }
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.token) {
        if (errorBox) { errorBox.textContent = data.error || 'اسم المستخدم أو كلمة المرور غير صحيحة'; errorBox.classList.remove('hidden'); }
        return;
      }
      adminToken = data.token;
      adminUser = data.user;
      sessionStorage.setItem('yf_admin_token', adminToken);
      sessionStorage.removeItem('yf_admin_session');
      await checkAuth();
    } catch (err) {
      if (errorBox) { errorBox.textContent = 'تعذر الاتصال بالخادم'; errorBox.classList.remove('hidden'); }
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    closeQrScanner();
    adminToken = '';
    adminUser = null;
    sessionStorage.removeItem('yf_admin_token');
    sessionStorage.removeItem('yf_admin_session');
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-username').value = '';
    showLoggedOut();
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => loadBookings(selectedAdminDate));
  document.getElementById('btn-call-next')?.addEventListener('click', callNextCustomer);
  document.getElementById('btn-add-admin')?.addEventListener('click', addAdminUser);
  setupQrScanner();

  const datePicker = document.getElementById('admin-date-picker');
  if (datePicker) {
    datePicker.value = selectedAdminDate;
    datePicker.addEventListener('change', e => {
      selectedAdminDate = e.target.value;
      adminLastBookingsSignature = '';
      loadBookings(selectedAdminDate);
      if (adminUser?.role === 'owner' && adminUser?.username === 'karem.01') loadAdminActivity();
    });
  }
}

async function initAdminData() {
  await loadBookings(selectedAdminDate);
  if (adminUser?.role === 'owner' && adminUser?.username === 'karem.01') {
    await loadAdminUsers();
    await loadAdminActivity();
  }
}

function startAdminLiveRefresh() {
  stopAdminLiveRefresh();
  adminLiveRefreshTimer = setInterval(() => {
    if (adminToken) {
      loadBookings(selectedAdminDate, true);
      if (adminUser?.role === 'owner' && adminUser?.username === 'karem.01') loadAdminActivity(true);
    }
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
    calledByName: b.calledByName ?? b.called_by_name ?? null,
    calledByUsername: b.calledByUsername ?? b.called_by_username ?? null,
    servedByName: b.servedByName ?? b.served_by_name ?? null,
    servedByUsername: b.servedByUsername ?? b.served_by_username ?? null,
    status: normalizeStatus(b.status)
  };
}

async function loadBookings(date, silent = false) {
  try {
    if (!adminToken) return;
    const { res, data } = await adminFetch(`/api/bookings?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error(data.error || 'API error');
    if (!data.success) throw new Error(data.error || 'API error');
    const nextBookings = data.bookings.map(normalizeBooking);
    const signature = JSON.stringify(nextBookings);
    if (signature !== adminLastBookingsSignature) {
      currentBookings = nextBookings;
      adminLastBookingsSignature = signature;
      renderTable();
      updateStats();
    }
  } catch (e) {
    if (!silent) console.error(e);
  }
}

function renderTable() {
  const tbody = document.getElementById('admin-table-body'); if (!tbody) return; tbody.innerHTML = '';
  if (!currentBookings.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px; color:#888;">لا توجد حجوزات لهذا اليوم</td></tr>'; return; }
  currentBookings.forEach(b => {
    const tr = document.createElement('tr');
    const calledBy = b.calledByName ? `${b.calledByName}${b.calledByUsername ? ` (@${b.calledByUsername})` : ''}` : '—';
    const servedBy = b.servedByName ? `${b.servedByName}${b.servedByUsername ? ` (@${b.servedByUsername})` : ''}` : '—';
    tr.innerHTML = `<td style="font-weight:bold; font-family:'Cinzel',serif;">#${b.queueNumber}</td><td style="font-family:monospace; color:#d4af37;">${b.bookingCode}</td><td style="font-weight:bold;">${b.customerName}</td><td dir="ltr" style="font-size:12px;">${b.phone}</td><td>${b.serviceName}</td><td style="font-family:'Cinzel',serif; font-size:12px;">${b.timeSlot}</td><td><span class="badge badge-${b.status}">${getStatusName(b.status)}</span></td><td>${escapeAdminText(calledBy)}</td><td>${escapeAdminText(servedBy)}</td><td><div class="action-btn-row">${b.status === 'confirmed' ? `<button class="btn-sm btn-sm-chair" onclick="updateStatus('${b.id}', 'in_chair')">على الكرسي</button>` : ''}${b.status === 'in_chair' ? `<button class="btn-sm btn-sm-done" onclick="updateStatus('${b.id}', 'completed')">اكتمل ✓</button>` : ''}${b.status !== 'cancelled' && b.status !== 'completed' ? `<button class="btn-sm btn-sm-cancel" onclick="updateStatus('${b.id}', 'cancelled')">إلغاء</button>` : ''}</div></td>`;
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
    const { res, data } = await adminFetch(`/api/bookings/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
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

async function callNextCustomer() {
  const next = currentBookings.find(b => b.status === 'confirmed' && b.id);
  if (!next) return alert('لا يوجد عملاء في قائمة الانتظار لهذا اليوم!');
  playCallChime();
  const updated = await window.updateStatus(next.id, 'in_chair');
  if (!updated) return;
  const alertBox = document.getElementById('call-alert'), info = document.getElementById('called-customer-info');
  if (alertBox && info) {
    info.innerText = `#${next.queueNumber} - ${next.customerName} (${next.serviceName})`;
    alertBox.classList.remove('hidden');
    setTimeout(() => alertBox.classList.add('hidden'), 10000);
  }
}

async function loadAdminUsers() {
  const panel = document.getElementById('owner-management');
  if (!panel || adminUser?.role !== 'owner' || adminUser?.username !== 'karem.01') return;
  try {
    const { res, data } = await adminFetch('/api/admin/users');
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل حسابات الإدارة');
    const users = Array.isArray(data.users) ? data.users : [];
    const admins = users.filter(u => u.role === 'admin');
    document.getElementById('admin-count').textContent = `${admins.length} إداريين`;
    const list = document.getElementById('admin-users-list');
    list.innerHTML = '';

    users.forEach(user => {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      const meta = document.createElement('div');
      meta.className = 'admin-user-meta';
      const name = document.createElement('div');
      name.className = 'admin-user-name';
      name.textContent = user.name;
      const username = document.createElement('div');
      username.className = 'admin-user-username';
      username.textContent = '@' + user.username;
      const role = document.createElement('div');
      role.className = 'admin-user-role';
      role.textContent = user.role === 'owner' ? 'مالك النظام' : 'إداري';
      meta.append(name, username, role);
      row.appendChild(meta);

      if (user.role !== 'owner') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'admin-user-delete';
        del.textContent = 'حذف الإداري';
        del.addEventListener('click', () => deleteAdminUser(user.id, user.name));
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    if (!users.length) list.textContent = 'لا توجد حسابات إدارة.';
  } catch (e) {
    const list = document.getElementById('admin-users-list');
    if (list) list.textContent = e.message || 'تعذر تحميل الحسابات';
  }
}

async function loadAdminActivity(silent = false) {
  if (adminUser?.role !== 'owner' || adminUser?.username !== 'karem.01') return;
  const list = document.getElementById('admin-activity-list');
  if (!list) return;
  try {
    const { res, data } = await adminFetch('/api/admin/activity?date=' + encodeURIComponent(selectedAdminDate));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل نشاط المشرفين');
    const users = Array.isArray(data.users) ? data.users : [];
    list.innerHTML = '';
    if (!users.length) {
      list.innerHTML = '<div style="padding:14px;color:#aaa;text-align:center;">لا توجد حسابات إدارة حالياً.</div>';
      return;
    }
    users.forEach(user => {
      const row = document.createElement('div');
      row.className = 'admin-activity-row';
      const state = Number(user.active) ? 'نشط' : 'معطّل';
      const last = user.lastActivityAt ? formatAdminActivityDate(user.lastActivityAt) : 'لا يوجد نشاط مسجل';
      row.innerHTML = `<div class="admin-activity-main"><div class="admin-activity-name">${escapeAdminText(user.name)} <span class="admin-activity-role">${user.role === 'owner' ? 'مالك النظام' : 'مشرف'}</span></div><div class="admin-activity-username">@${escapeAdminText(user.username)} · ${state} · آخر نشاط: ${escapeAdminText(last)}</div></div><div class="admin-activity-metrics"><span><b>${Number(user.callsToday || 0)}</b> استدعاء</span><span><b>${Number(user.servicesToday || 0)}</b> خدمة مكتملة</span></div>`;
      list.appendChild(row);
    });
  } catch (e) {
    if (!silent) list.innerHTML = `<div style="padding:14px;color:#e9b2aa;">${escapeAdminText(e.message || 'تعذر تحميل نشاط المشرفين')}</div>`;
  }
}

function escapeAdminText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function formatAdminActivityDate(value) {
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch { return String(value || ''); }
}

async function addAdminUser() {
  if (adminUser?.role !== 'owner' || adminUser?.username !== 'karem.01') return;
  const username = document.getElementById('new-admin-username').value.trim();
  const name = document.getElementById('new-admin-name').value.trim();
  const password = document.getElementById('new-admin-password').value;
  const err = document.getElementById('owner-management-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  try {
    const { res, data } = await adminFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, password })
    });
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إضافة الإداري');
    document.getElementById('new-admin-username').value = '';
    document.getElementById('new-admin-name').value = '';
    document.getElementById('new-admin-password').value = '';
    await loadAdminUsers();
    alert('تمت إضافة الإداري بنجاح');
  } catch (e) {
    if (err) { err.textContent = e.message || 'تعذر إضافة الإداري'; err.classList.remove('hidden'); }
  }
}

async function deleteAdminUser(id, name) {
  if (adminUser?.role !== 'owner' || adminUser?.username !== 'karem.01') return;
  if (!confirm(`هل تريد حذف حساب الإداري «${name}»؟`)) return;
  try {
    const { res, data } = await adminFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حذف الإداري');
    await loadAdminUsers();
    alert('تم حذف الإداري');
  } catch (e) {
    const err = document.getElementById('owner-management-error');
    if (err) { err.textContent = e.message || 'تعذر حذف الإداري'; err.classList.remove('hidden'); }
  }
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
  if (!video || !shell || !adminToken || qrStream) return;

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

function handleScannedCode(value) {
  const raw = String(value || '').trim();
  const code = raw.match(/YF-[A-Z0-9-]+/i)?.[0] || raw;
  const booking = currentBookings.find(b =>
    String(b.bookingCode || '').toLowerCase() === code.toLowerCase() ||
    String(b.token || '').toLowerCase() === code.toLowerCase()
  );

  if (booking) {
    alert(`تم العثور على الحجز\n\n${booking.customerName}\n${booking.timeSlot}\nرقم الدور: #${booking.queueNumber}\nرمز الحجز: ${booking.bookingCode}`);
  } else {
    alert(`تمت قراءة الرمز: ${raw}\nلكن الحجز غير موجود ضمن حجوزات التاريخ المحدد.`);
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
