// Admin Dashboard JS
let currentBookings = [];
let selectedAdminDate = new Date().toISOString().split('T')[0];

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEvents();
});

function checkAuth() {
  const isAuth = sessionStorage.getItem('yf_admin_session') === 'true';
  if (isAuth) {
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('admin-app')?.classList.remove('hidden');
    initAdminData();
  } else {
    document.getElementById('login-overlay')?.classList.remove('hidden');
    document.getElementById('admin-app')?.classList.add('hidden');
  }
}

function setupEvents() {
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('admin-pin').value;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('yf_admin_session', 'true');
        checkAuth();
      } else {
        alert(data.error || 'رمز الدخول غير صحيح');
      }
    } catch (e) {
      if (pin === '1234' || pin === 'admin') {
        sessionStorage.setItem('yf_admin_session', 'true');
        checkAuth();
      } else {
        alert('رمز الدخول غير صحيح (الافتراضي: 1234)');
      }
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    sessionStorage.removeItem('yf_admin_session');
    checkAuth();
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    loadBookings(selectedAdminDate);
  });

  document.getElementById('btn-call-next')?.addEventListener('click', callNextCustomer);

  const datePicker = document.getElementById('admin-date-picker');
  if (datePicker) {
    datePicker.value = selectedAdminDate;
    datePicker.addEventListener('change', (e) => {
      selectedAdminDate = e.target.value;
      loadBookings(selectedAdminDate);
    });
  }
}

async function initAdminData() {
  loadBookings(selectedAdminDate);
}

async function loadBookings(date) {
  try {
    const res = await fetch(`/api/bookings?date=${date}`);
    const data = await res.json();
    if (data.success) {
      currentBookings = data.bookings;
      renderTable();
      updateStats();
    }
  } catch (e) {
    console.error(e);
  }
}

function renderTable() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (currentBookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#888;">لا توجد حجوزات لهذا اليوم</td></tr>';
    return;
  }

  currentBookings.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:bold; font-family:'Cinzel',serif;">#${b.queueNumber}</td>
      <td style="font-family:monospace; color:#d4af37;">${b.bookingCode}</td>
      <td style="font-weight:bold;">${b.customerName}</td>
      <td dir="ltr" style="font-size:12px;">${b.phone}</td>
      <td>${b.serviceName}</td>
      <td style="font-family:'Cinzel',serif; font-size:12px;">${b.timeSlot}</td>
      <td><span class="badge badge-${b.status}">${getStatusName(b.status)}</span></td>
      <td>
        <div class="action-btn-row">
          ${b.status === 'confirmed' ? `<button class="btn-sm btn-sm-chair" onclick="updateStatus('${b.id}', 'in_chair')">على الكرسي</button>` : ''}
          ${b.status === 'in_chair' ? `<button class="btn-sm btn-sm-done" onclick="updateStatus('${b.id}', 'completed')">اكتمل ✓</button>` : ''}
          ${b.status !== 'cancelled' && b.status !== 'completed' ? `<button class="btn-sm btn-sm-cancel" onclick="updateStatus('${b.id}', 'cancelled')">إلغاء</button>` : ''}
        </div>
      </td>
    `;
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
  try {
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.success) {
      loadBookings(selectedAdminDate);
    }
  } catch (e) {
    alert('تعذر تحديث الحالة');
  }
};

async function callNextCustomer() {
  const next = currentBookings.find(b => b.status === 'confirmed');
  if (!next) {
    alert('لا يوجد عملاء في قائمة الانتظار لهذا اليوم!');
    return;
  }
  playCallChime();
  await window.updateStatus(next.id, 'in_chair');

  const alertBox = document.getElementById('call-alert');
  const info = document.getElementById('called-customer-info');
  if (alertBox && info) {
    info.innerText = `#${next.queueNumber} - ${next.customerName} (${next.serviceName})`;
    alertBox.classList.remove('hidden');
    setTimeout(() => alertBox.classList.add('hidden'), 10000);
  }
}

function playCallChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}