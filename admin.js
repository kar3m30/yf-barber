// Admin Dashboard JS
let currentBookings = [];
let selectedAdminDate = getLocalDate();

function getLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

document.addEventListener('DOMContentLoaded', () => { checkAuth(); setupEvents(); });

function checkAuth() {
  const isAuth = sessionStorage.getItem('yf_admin_session') === 'true';
  document.getElementById('login-overlay')?.classList.toggle('hidden', isAuth);
  document.getElementById('admin-app')?.classList.toggle('hidden', !isAuth);
  if (isAuth) initAdminData();
}

function setupEvents() {
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('admin-pin').value;
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const data = await res.json();
      if (data.success) { sessionStorage.setItem('yf_admin_session', 'true'); checkAuth(); }
      else alert(data.error || 'رمز الدخول غير صحيح');
    } catch (e) { alert('تعذر الاتصال بالخادم للتحقق من رمز الدخول'); }
  });
  document.getElementById('btn-logout')?.addEventListener('click', () => { sessionStorage.removeItem('yf_admin_session'); checkAuth(); });
  document.getElementById('btn-refresh')?.addEventListener('click', () => loadBookings(selectedAdminDate));
  document.getElementById('btn-call-next')?.addEventListener('click', callNextCustomer);
  setupQrScanner();

  const datePicker = document.getElementById('admin-date-picker');
  if (datePicker) { datePicker.value = selectedAdminDate; datePicker.addEventListener('change', e => { selectedAdminDate = e.target.value; loadBookings(selectedAdminDate); }); }
}

async function initAdminData() { await loadBookings(selectedAdminDate); }

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
    status: normalizeStatus(b.status)
  };
}

async function loadBookings(date) {
  try {
    const res = await fetch(`/api/bookings?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'API error');
    currentBookings = data.bookings.map(normalizeBooking); renderTable(); updateStats();
  } catch (e) { console.error(e); currentBookings = []; renderTable(); updateStats(); }
}

function renderTable() {
  const tbody = document.getElementById('admin-table-body'); if (!tbody) return; tbody.innerHTML = '';
  if (!currentBookings.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#888;">لا توجد حجوزات لهذا اليوم</td></tr>'; return; }
  currentBookings.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-weight:bold; font-family:'Cinzel',serif;">#${b.queueNumber}</td><td style="font-family:monospace; color:#d4af37;">${b.bookingCode}</td><td style="font-weight:bold;">${b.customerName}</td><td dir="ltr" style="font-size:12px;">${b.phone}</td><td>${b.serviceName}</td><td style="font-family:'Cinzel',serif; font-size:12px;">${b.timeSlot}</td><td><span class="badge badge-${b.status}">${getStatusName(b.status)}</span></td><td><div class="action-btn-row">${b.status === 'confirmed' ? `<button class="btn-sm btn-sm-chair" onclick="updateStatus('${b.id}', 'in_chair')">على الكرسي</button>` : ''}${b.status === 'in_chair' ? `<button class="btn-sm btn-sm-done" onclick="updateStatus('${b.id}', 'completed')">اكتمل ✓</button>` : ''}${b.status !== 'cancelled' && b.status !== 'completed' ? `<button class="btn-sm btn-sm-cancel" onclick="updateStatus('${b.id}', 'cancelled')">إلغاء</button>` : ''}</div></td>`;
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
    const res = await fetch(`/api/bookings/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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

let qrStream = null;
let qrScanFrameId = null;

function setupQrScanner() {
  document.getElementById('btn-open-scanner')?.addEventListener('click', openQrScanner);
  document.getElementById('btn-close-scanner')?.addEventListener('click', closeQrScanner);
}

async function openQrScanner() {
  const modal = document.getElementById('qr-scanner-modal');
  const video = document.getElementById('qr-video');
  const msg = document.getElementById('qr-scan-msg');
  if (!modal || !video) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    alert('الكاميرا غير مدعومة في هذا المتصفح.');
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = qrStream;
    await video.play();
    modal.classList.remove('hidden');
    if (msg) msg.textContent = 'وجّه الكاميرا نحو رمز QR...';
    scanQrFrame();
  } catch (e) {
    console.error('QR camera error:', e);
    alert('تعذر فتح الكاميرا. اسمح للمتصفح باستخدام الكاميرا ثم حاول مرة أخرى.');
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
      handleScannedCode(code.data);
      return;
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
  document.getElementById('qr-scanner-modal')?.classList.add('hidden');
}

function handleScannedCode(value) {
  closeQrScanner();

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
