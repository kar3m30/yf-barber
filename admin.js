/* =========================================================
   يوسف فاروق — لوحة الإدارة
   admin.js
   ========================================================= */

(() => {
  alert('admin.js يعمل');
  'use strict';

  const API = '/api';
  const TOKEN_KEY = 'yf_admin_token';

  let adminToken = sessionStorage.getItem(TOKEN_KEY) || '';
  let adminUser = null;

  let bookings = [];
  let selectedBooking = null;

  let scannerStream = null;
  let scannerTimer = null;
  let scannerBusy = false;

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

  const STATUS = {
    waiting: 'في الانتظار',
    serving: 'جاري الخدمة',
    done: 'تمت الخدمة',
    cancelled: 'ملغي'
  };

  /* =========================================================
     أدوات عامة
  ========================================================= */

  function $(id) {
    return document.getElementById(id);
  }
function escapeHTML(value) 
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  }

  function getTodayCairo() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function formatDate(date) {
    if (!date) return '';

    try {
      return new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(new Date(`${date}T12:00:00`));
    } catch {
      return date;
    }
  }

  function serviceName(service) {
    return SERVICES[service]?.name || service || '—';
  }

  function servicePrice(service) {
    return SERVICES[service]?.price ?? 0;
  }

  function statusName(status) {
    return STATUS[status] || status || '—';
  }
function statusClass(status) 
  return `status-${status || 'unknown'}`;

  }

  function setMessage(text, type = '') {
    const el = $('adminMessage');
    if (!el) return;

    el.textContent = text || '';
    el.className = `message ${type}`.trim();
  }

  function setLoginMessage(text, type = '') {
    const el = $('loginMessage');
    if (!el) return;

    el.textContent = text || '';
    el.className = `login-message ${type}`.trim();
  }

  function setScannerMessage(text, type = '') {
    const el = $('scannerMessage');
    if (!el) return;

    el.textContent = text || '';
    el.className = `scanner-message ${type}`.trim();
  }

  async function api(path, options = {}) {
    const headers = {
      ...(options.headers || {})
    };

    if (!headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json';
    }

    if (adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    }

    const response = await fetch(`${API}${path}`, {
      ...options,
      headers
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        data?.error ||
        data?.message ||
        `حدث خطأ (${response.status})`;

      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  /* =========================================================
     إظهار / إخفاء الواجهات
  ========================================================= */

  function showLogin() {
    $('loginScreen')?.classList.remove('hidden');
    $('dashboard')?.classList.add('hidden');
  }

  function showDashboard() {
    $('loginScreen')?.classList.add('hidden');
    $('dashboard')?.classList.remove('hidden');
  }

  /* =========================================================
     تسجيل الدخول
  ========================================================= */

  async function login(event) {
    event.preventDefault();

    const username = String($('adminUsername')?.value || '').trim();
    const password = String($('adminPassword')?.value || '');

    if (!username || !password) {
      setLoginMessage('أدخل اسم المستخدم وكلمة المرور.', 'error');
      return;
    }

    const button = $('loginButton');

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'جاري الدخول...';
    }

    setLoginMessage('');

    try {
      const data = await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password
        })
      });

      if (!data?.token) {
        throw new Error('لم يتم استلام جلسة الدخول.');
      }

      adminToken = data.token;
      adminUser = data.user || null;

      sessionStorage.setItem(TOKEN_KEY, adminToken);

      if ($('adminUsername')) $('adminUsername').value = '';
      if ($('adminPassword')) $('adminPassword').value = '';

      showDashboard();

      await initializeDashboard();
    } catch (error) {
      console.error(error);
      setLoginMessage(
        error.message || 'اسم المستخدم أو كلمة المرور غير صحيحة.',
        'error'
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          button.dataset.originalText || 'تسجيل الدخول';
      }
    }
  }

  async function checkSession() {
    if (!adminToken) {
      showLogin();
      return false;
    }

    try {
      const data = await api('/admin/me');

      adminUser = data?.user || data || null;

      showDashboard();

      return true;
    } catch (error) {
      console.warn('الجلسة غير صالحة:', error);

      logout(false);

      return false;
    }
  }

  function logout(showLoginScreen = true) {
    stopScanner();

    adminToken = '';
    adminUser = null;

    sessionStorage.removeItem(TOKEN_KEY);

    if (showLoginScreen) {
      showLogin();
    }
  }

  /* =========================================================
     لوحة التحكم
  ========================================================= */

  async function initializeDashboard() {
    setupDate();

    updateWelcome();

    await loadBookings();

    await loadUsersIfOwner();
  }

  function setupDate() {
    const input = $('adminDate');
    if (!input) return;

    const today = getTodayCairo();

    input.min = today;

    if (!input.value) {
      input.value = today;
    }
  }

  function updateWelcome() {
    const el = $('adminWelcome');

    if (!el) return;

    const name =
      adminUser?.name ||
      adminUser?.username ||
      'مدير يوسف فاروق';

    el.textContent = `مرحباً ${name}`;
  }

  async function loadBookings() {
    const date = $('adminDate')?.value || getTodayCairo();

    setMessage('جاري تحميل الحجوزات...');

    try {
      const data = await api(
        `/bookings?date=${encodeURIComponent(date)}`
      );

      bookings = Array.isArray(data)
        ? data
        : Array.isArray(data?.bookings)
          ? data.bookings
          : [];

      renderStats();
      renderBookings();
      renderCurrentQueue();

      setMessage('');
    } catch (error) {
      console.error(error);

      bookings = [];

      renderStats();
      renderBookings();
      renderCurrentQueue();

      if (error.status === 401) {
        logout();
        setLoginMessage('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.', 'error');
        return;
      }

      setMessage(
        error.message || 'تعذر تحميل الحجوزات.',
        'error'
      );
    }
  }

  /* =========================================================
     الإحصائيات
  ========================================================= */

  function renderStats() {
    const total = bookings.length;

    const waiting = bookings.filter(
      b => b.status === 'waiting'
    ).length;

    const serving = bookings.filter(
      b => b.status === 'serving'
    ).length;

    const done = bookings.filter(
      b => b.status === 'done'
    ).length;

    if ($('totalCount')) $('totalCount').textContent = total;
    if ($('waitingCount')) $('waitingCount').textContent = waiting;
    if ($('servingCount')) $('servingCount').textContent = serving;
    if ($('doneCount')) $('doneCount').textContent = done;

    const date = $('adminDate')?.value;

    if ($('selectedDateLabel')) {
      $('selectedDateLabel').textContent =
        date ? formatDate(date) : '';
    }
  }

  /* =========================================================
     قائمة الحجوزات
  ========================================================= */

  function renderBookings() {
    const container = $('bookingList');

    if (!container) return;

    if (!bookings.length) {
      container.innerHTML = `
        <div class="empty-state">
          لا توجد حجوزات لهذا اليوم.
        </div>
      `;
      return;
    }

    const sorted = [...bookings].sort((a, b) => {
      const qa = Number(a.queue || 0);
      const qb = Number(b.queue || 0);

      if (qa !== qb) return qa - qb;

      return String(a.time || '').localeCompare(
        String(b.time || '')
      );
    });

    container.innerHTML = sorted
      .map(renderBookingCard)
      .join('');

    container
      .querySelectorAll('[data-booking-action]')
      .forEach(button => {
        button.addEventListener('click', handleBookingAction);
      });

    container
      .querySelectorAll('[data-booking-details]')
      .forEach(button => {
        button.addEventListener('click', () => {
          const token = button.dataset.bookingDetails;
          const booking = bookings.find(
            b => String(b.token) === String(token)
          );

          if (booking) {
            openBookingOverlay(booking);
          }
        });
      });
  }

  function renderBookingCard(booking) {
    const token = escapeHTML(booking.token);
    const status = booking.status || 'waiting';

    const canServe =
      status === 'waiting';

    const canDone =
      status === 'serving';

    const canCancel =
      status === 'waiting' ||
      status === 'serving';

    return `
      <article class="booking-card ${statusClass(status)}">

        <div class="booking-card-top">

          <div class="booking-number">
            <span>الدور</span>
            <strong>${escapeHTML(booking.queue)}</strong>
          </div>

          <div class="booking-status ${statusClass(status)}">
            ${escapeHTML(statusName(status))}
          </div>

        </div>

        <div class="booking-main">

          <div class="booking-customer">
            <h3>
              ${escapeHTML(booking.name || 'بدون اسم')}
            </h3>

            <p>
              📞 ${escapeHTML(booking.phone || '—')}
            </p>
          </div>

          <div class="booking-info">

            <div>
              <span>الخدمة</span>
              <strong>
                ${escapeHTML(serviceName(booking.service))}
              </strong>
            </div>

            <div>
              <span>السعر</span>
              <strong>
                ${servicePrice(booking.service)} ج.م
              </strong>
            </div>

            <div>
              <span>التاريخ</span>
              <strong>
                ${escapeHTML(booking.date || '—')}
              </strong>
            </div>

            <div>
              <span>الوقت</span>
              <strong>
                ${escapeHTML(booking.time || '—')}
              </strong>
            </div>

            <div>
              <span>المكان</span>
              <strong>
                ${booking.slot ? `الحجز ${escapeHTML(booking.slot)}` : '—'}
              </strong>
            </div>

          </div>

        </div>

        <div class="booking-actions">

          <button
            type="button"
            class="action-button secondary"
            data-booking-details="${token}"
          >
            التفاصيل
          </button>

          ${
            canServe
              ? `
                <button
                  type="button"
                  class="action-button primary"
                  data-booking-action="serving"
                  data-booking-token="${token}"
                >
                  بدء الخدمة
                </button>
              `
              : ''
          }

          ${
            canDone
              ? `
                <button
                  type="button"
                  class="action-button primary"
                  data-booking-action="done"
                  data-booking-token="${token}"
                >
                  إنهاء الخدمة
                </button>
              `
              : ''
          }

          ${
            canCancel
              ? `
                <button
                  type="button"
                  class="action-button danger"
                  data-booking-action="cancelled"
                  data-booking-token="${token}"
                >
                  إلغاء
                </button>
              `
              : ''
          }

        </div>

      </article>
    `;
  }

  /* =========================================================
     تغيير حالة الحجز
  ========================================================= */

  async function handleBookingAction(event) {
    const button = event.currentTarget;

    const token = button.dataset.bookingToken;
    const status = button.dataset.bookingAction;

    if (!token || !status) return;

    const booking = bookings.find(
      b => String(b.token) === String(token)
    );

    if (!booking) {
      setMessage('الحجز غير موجود.', 'error');
      return;
    }

    if (status === 'cancelled') {
      const confirmed = window.confirm(
        `هل تريد إلغاء حجز ${booking.name}؟`
      );

      if (!confirmed) return;
    }

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = 'جاري التنفيذ...';

    try {
      await api(`/bookings/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status
        })
      });

      setMessage('تم تحديث حالة الحجز.', 'success');

      closeBookingOverlay();

      await loadBookings();
    } catch (error) {
      console.error(error);

      if (error.status === 401) {
        logout();
        setLoginMessage(
          'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.',
          'error'
        );
        return;
      }

      setMessage(
        error.message || 'تعذر تحديث حالة الحجز.',
        'error'
      );

      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /* =========================================================
     العميل التالي
  ========================================================= */

  async function nextCustomer() {
    const date = $('adminDate')?.value || getTodayCairo();

    const button = $('nextBtn');

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'جاري الاستدعاء...';
    }

    setMessage('');

    try {
      const data = await api('/admin/next', {
        method: 'POST',
        body: JSON.stringify({
          date
        })
      });

      if (!data?.booking) {
        setMessage('لا يوجد عميل في قائمة الانتظار.', 'info');
      } else {
        setMessage(
          `تم استدعاء الدور ${data.booking.queue} — ${data.booking.name}`,
          'success'
        );
      }

      await loadBookings();
    } catch (error) {
      console.error(error);

      setMessage(
        error.message || 'تعذر استدعاء العميل التالي.',
        'error'
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          button.dataset.originalText || 'العميل التالي';
      }
    }
  }

  /* =========================================================
     العميل الحالي
  ========================================================= */

  function renderCurrentQueue() {
    const current = bookings.find(
      booking => booking.status === 'serving'
    );

    const queueElement = $('currentQueue');
    const nameElement = $('currentName');

    if (!current) {
      if (queueElement) queueElement.textContent = '—';
      if (nameElement) nameElement.textContent = 'لا يوجد عميل حالياً';
      return;
    }

    if (queueElement) {
      queueElement.textContent = current.queue ?? '—';
    }

    if (nameElement) {
      nameElement.textContent =
        current.name || 'بدون اسم';
    }
  }

  /* =========================================================
     تفاصيل الحجز
  ========================================================= */

  function openBookingOverlay(booking) {
    selectedBooking = booking;

    const overlay = $('bookingOverlay');

    if (!overlay) return;

    const details = $('overlayBookingDetails');
    const actions = $('overlayBookingActions');

    if (details) {
      details.innerHTML = `
        <div class="overlay-title">
          تفاصيل الحجز
        </div>

        <div class="detail-row">
          <span>الاسم</span>
          <strong>${escapeHTML(booking.name)}</strong>
        </div>

        <div class="detail-row">
          <span>رقم الهاتف</span>
          <strong>${escapeHTML(booking.phone || '—')}</strong>
        </div>

        <div class="detail-row">
          <span>الخدمة</span>
          <strong>${escapeHTML(serviceName(booking.service))}</strong>
        </div>

        <div class="detail-row">
          <span>السعر</span>
          <strong>${servicePrice(booking.service)} ج.م</strong>
        </div>

        <div class="detail-row">
          <span>التاريخ</span>
          <strong>${escapeHTML(booking.date)}</strong>
        </div>

        <div class="detail-row">
          <span>الوقت</span>
          <strong>${escapeHTML(booking.time)}</strong>
        </div>

        <div class="detail-row">
          <span>الدور</span>
          <strong>${escapeHTML(booking.queue)}</strong>
        </div>

        <div class="detail-row">
          <span>الحجز في الموعد</span>
          <strong>${escapeHTML(booking.slot || '—')}</strong>
        </div>

        <div class="detail-row">
          <span>الحالة</span>
          <strong>${escapeHTML(statusName(booking.status))}</strong>
        </div>
      `;
    }

    if (actions) {
      actions.innerHTML = renderOverlayActions(booking);

      actions
        .querySelectorAll('[data-overlay-action]')
        .forEach(button => {
          button.addEventListener('click', async () => {
            const status = button.dataset.overlayAction;

            await updateSelectedBooking(status);
          });
        });
    }

    overlay.classList.add('open');
    overlay.classList.remove('hidden');
  }

  function renderOverlayActions(booking) {
    const token = escapeHTML(booking.token);

    let html = '';

    if (booking.status === 'waiting') {
      html += `
        <button
          type="button"
          class="action-button primary"
          data-overlay-action="serving"
          data-booking-token="${token}"
        >
          تأكيد دخول العميل
        </button>

        <button
          type="button"
          class="action-button danger"
          data-overlay-action="cancelled"
        >
          إلغاء الحجز
        </button>
      `;
    }

    if (booking.status === 'serving') {
      html += `
        <button
          type="button"
          class="action-button primary"
          data-overlay-action="done"
        >
          إنهاء الخدمة
        </button>
      `;
    }

    return html;
  }

  async function updateSelectedBooking(status) {
    if (!selectedBooking?.token) return;

    try {
      await api(
        `/bookings/${encodeURIComponent(selectedBooking.token)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
                        status
          })
        }
      );

      closeBookingOverlay();

      await loadBookings();

      setMessage('تم تحديث الحجز.', 'success');
    } catch (error) {
      console.error(error);

      setMessage(
        error.message || 'تعذر تحديث الحجز.',
        'error'
      );
    }
  }

  function closeBookingOverlay() {
    selectedBooking = null;

    const overlay = $('bookingOverlay');

    if (!overlay) return;

    overlay.classList.remove('open');
    overlay.classList.add('hidden');
  }

  /* =========================================================
     QR Scanner
  ========================================================= */

  function createBarcodeDetector() {
    if (!('BarcodeDetector' in window)) {
      return null;
    }

    try {
      return new BarcodeDetector({
        formats: ['qr_code']
      });
    } catch {
      return null;
    }
  }

  async function startScanner() {
    if (scannerStream) {
      return;
    }

    const video = $('scannerVideo');

    if (!video) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerMessage(
        'الكاميرا غير مدعومة على هذا الجهاز أو المتصفح.',
        'error'
      );
      return;
    }

    const detector = createBarcodeDetector();

    if (!detector) {
      setScannerMessage(
        'قارئ QR بالكاميرا غير مدعوم في هذا المتصفح. استخدم رفع صورة QR.',
        'error'
      );
    }

    try {
      scannerStream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: 'environment'
            }
          },
          audio: false
        });

      video.srcObject = scannerStream;

      await video.play();

      setScannerMessage(
        'وجّه الكاميرا نحو رمز QR الخاص بالعميل.',
        'success'
      );

      if (detector) {
        scanWithCamera(detector);
      }
    } catch (error) {
      console.error(error);

      stopScanner();

      let message =
        'تعذر تشغيل الكاميرا.';

      if (error?.name === 'NotAllowedError') {
        message =
          'تم رفض صلاحية الكاميرا. اسمح للمتصفح باستخدام الكاميرا ثم حاول مرة أخرى.';
      }

      setScannerMessage(message, 'error');
    }
  }

  async function scanWithCamera(detector) {
    if (!scannerStream || scannerBusy) {
      if (scannerStream) {
        scannerTimer = setTimeout(
          () => scanWithCamera(detector),
          500
        );
      }

      return;
    }

    const video = $('scannerVideo');

    if (!video || video.readyState < 2) {
      scannerTimer = setTimeout(
        () => scanWithCamera(detector),
        500
      );
      return;
    }

    scannerBusy = true;

    try {
      const codes = await detector.detect(video);

      if (codes?.length) {
        const rawValue = codes[0]?.rawValue;

        if (rawValue) {
          await handleQRValue(rawValue);

          stopScanner();
          return;
        }
      }
    } catch (error) {
      console.warn('QR scan:', error);
    } finally {
      scannerBusy = false;
    }

    if (scannerStream) {
      scannerTimer = setTimeout(
        () => scanWithCamera(detector),
        500
      );
    }
  }

  function stopScanner() {
    if (scannerTimer) {
      clearTimeout(scannerTimer);
      scannerTimer = null;
    }

    scannerBusy = false;

    if (scannerStream) {
      scannerStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });

      scannerStream = null;
    }

    const video = $('scannerVideo');

    if (video) {
      video.pause();

      try {
        video.srcObject = null;
      } catch {}
    }
  }

  async function handleQRValue(rawValue) {
    const value = String(rawValue || '').trim();

    if (!value) {
      setScannerMessage('رمز QR فارغ.', 'error');
      return;
    }

    setScannerMessage('جاري قراءة الحجز...', 'info');

    let token = value;

    /*
      رمز QR الخاص بالموقع يحتوي عادةً على token فقط.
      ولو تم وضع رابط كامل، نحاول استخراج token منه.
    */

    try {
      if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);

        const pathParts = url.pathname
          .split('/')
          .filter(Boolean);

        const tokenIndex =
          pathParts.findIndex(
            part =>
              part.toLowerCase() === 'booking' ||
              part.toLowerCase() === 'book'
          );

        if (tokenIndex >= 0 && pathParts[tokenIndex + 1]) {
          token = pathParts[tokenIndex + 1];
        } else if (url.searchParams.get('token')) {
          token = url.searchParams.get('token');
        }
      }
    } catch {
      // القيمة نفسها قد تكون token
    }

    try {
      const data = await api(
        `/admin/bookings/token/${encodeURIComponent(token)}`
      );

      const booking = data?.booking || data;

      if (!booking?.token) {
        throw new Error('لم يتم العثور على الحجز.');
      }

      showScannedBooking(booking);

      setScannerMessage(
        'تم التعرف على الحجز بنجاح.',
        'success'
      );
    } catch (error) {
      console.error(error);

      setScannerMessage(
        error.message || 'لم يتم العثور على هذا الحجز.',
        'error'
      );
    }
  }

  function showScannedBooking(booking) {
    const result = $('scannerResult');

    if (!result) return;

    result.innerHTML = `
      <div class="scanner-result-card">

        <div class="scanner-result-title">
          بيانات العميل
        </div>

        <div class="detail-row">
          <span>الاسم</span>
          <strong>${escapeHTML(booking.name)}</strong>
        </div>

        <div class="detail-row">
          <span>الهاتف</span>
          <strong>${escapeHTML(booking.phone || '—')}</strong>
        </div>

        <div class="detail-row">
          <span>الخدمة</span>
          <strong>${escapeHTML(serviceName(booking.service))}</strong>
        </div>

        <div class="detail-row">
          <span>التاريخ</span>
          <strong>${escapeHTML(booking.date)}</strong>
        </div>

        <div class="detail-row">
          <span>الوقت</span>
          <strong>${escapeHTML(booking.time)}</strong>
        </div>

        <div class="detail-row">
          <span>الدور</span>
          <strong>${escapeHTML(booking.queue)}</strong>
        </div>

        <div class="detail-row">
          <span>الحالة</span>
          <strong>${escapeHTML(statusName(booking.status))}</strong>
        </div>

        <div class="scanner-result-actions">

          ${
            booking.status === 'waiting'
              ? `
                <button
                  type="button"
                  class="action-button primary"
                  id="confirmScannedBooking"
                >
                  تأكيد دخول العميل
                </button>
              `
              : ''
          }

          <button
            type="button"
            class="action-button secondary"
            id="openScannedBooking"
          >
            فتح التفاصيل
          </button>

        </div>

      </div>
    `;

    const openButton = $('openScannedBooking');

    openButton?.addEventListener('click', () => {
      openBookingOverlay(booking);
    });

    const confirmButton =
      $('confirmScannedBooking');

    confirmButton?.addEventListener(
      'click',
      async () => {
        confirmButton.disabled = true;
        confirmButton.textContent = 'جاري التأكيد...';

        try {
          await api(
            `/bookings/${encodeURIComponent(booking.token)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                status: 'serving'
              })
            }
          );

          setScannerMessage(
            'تم تأكيد دخول العميل وبدء الخدمة.',
            'success'
          );

          result.innerHTML = `
            <div class="scanner-result-card success-card">
              <strong>تم تأكيد دخول العميل</strong>
              <p>
                ${escapeHTML(booking.name)}
              </p>
            </div>
          `;

          await loadBookings();
        } catch (error) {
          console.error(error);

          confirmButton.disabled = false;
          confirmButton.textContent =
            'تأكيد دخول العميل';

          setScannerMessage(
            error.message || 'تعذر تأكيد دخول العميل.',
            'error'
          );
        }
      }
    );
  }

  /* =========================================================
     رفع صورة QR
  ========================================================= */

  async function handleQRFile(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setScannerMessage(
      'جاري قراءة صورة QR...',
      'info'
    );

    try {
      const detector = createBarcodeDetector();

      if (detector) {
        const image = await loadImage(file);

        const codes = await detector.detect(image);

        if (codes?.length && codes[0]?.rawValue) {
          await handleQRValue(codes[0].rawValue);
          return;
        }
      }

      /*
        BarcodeDetector غير مدعوم في بعض المتصفحات.
        نحاول تحميل jsQR كحل احتياطي لصورة QR.
      */

      const value = await scanImageWithJsQR(file);

      if (value) {
        await handleQRValue(value);
        return;
      }

      throw new Error(
        'لم يتم العثور على رمز QR واضح داخل الصورة.'
      );
    } catch (error) {
      console.error(error);

      setScannerMessage(
        error.message ||
        'تعذر قراءة رمز QR من الصورة.',
        'error'
      );
    } finally {
      event.target.value = '';
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      const url = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(
          new Error('تعذر فتح صورة QR.')
        );
      };

      image.src = url;
    });
  }

  function loadJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) {
        resolve(window.jsQR);
        return;
      }

      const script = document.createElement('script');

      script.src =
        'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

      script.onload = () => {
        if (window.jsQR) {
          resolve(window.jsQR);
        } else {
          reject(
            new Error('تعذر تحميل قارئ QR.')
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error('تعذر تحميل قارئ QR.')
        );
      };

      document.head.appendChild(script);
    });
  }

  async function scanImageWithJsQR(file) {
    const jsQR = await loadJsQR();

    const image = await loadImage(file);

    const canvas = document.createElement('canvas');

    const maxSize = 1600;

    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;

    if (width > maxSize || height > maxSize) {
      const scale =
        maxSize / Math.max(width, height);

      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', {
      willReadFrequently: true
    });

    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    const imageData = context.getImageData(
      0,
      0,
      width,
      height
    );

    const code = jsQR(
      imageData.data,
      imageData.width,
      imageData.height,
      {
        inversionAttempts: 'attemptBoth'
      }
    );

    return code?.data || null;
  }

  /* =========================================================
     المستخدمون
  ========================================================= */

  function isOwner() {
    return (
      adminUser?.role === 'owner' ||
      adminUser?.role === 'admin'
    );
  }

  async function loadUsersIfOwner() {
    const card = $('usersCard');

    if (!card) return;

    if (!isOwner()) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');

    await loadUsers();
  }

  async function loadUsers() {
    const list = $('usersList');

    if (!list) return;

    try {
      const data = await api('/admin/users');

      const users = Array.isArray(data)
        ? data
        : Array.isArray(data?.users)
          ? data.users
          : [];

      if (!users.length) {
        list.innerHTML = `
          <div class="empty-state">
            لا يوجد مستخدمون.
          </div>
        `;
        return;
      }

      list.innerHTML = users
        .map(user => {
          const id = escapeHTML(user.id);

          return `
            <div class="user-row">

              <div>
                <strong>
                  ${escapeHTML(user.name || user.username)}
                </strong>

                <small>
                  @${escapeHTML(user.username)}
                </small>

                <small>
                  ${user.role === 'owner' ? 'مالك' : 'موظف'}
                  —
                  ${Number(user.active) ? 'نشط' : 'غير نشط'}
                </small>
              </div>

              ${
                user.role !== 'owner'
                  ? `
                    <button
                      type="button"
                      class="action-button danger small"
                      data-delete-user="${id}"
                    >
                      حذف
                    </button>
                  `
                  : ''
              }

            </div>
          `;
        })
        .join('');

      list
        .querySelectorAll('[data-delete-user]')
        .forEach(button => {
          button.addEventListener(
            'click',
            () => deleteUser(button.dataset.deleteUser)
          );
        });
    } catch (error) {
      console.error(error);

      if (error.status === 403) {
        card.classList.add('hidden');
        return;
      }

      list.innerHTML = `
        <div class="empty-state error">
          ${escapeHTML(
            error.message ||
            'تعذر تحميل المستخدمين.'
          )}
        </div>
      `;
    }
  }

  async function addUser(event) {
    event.preventDefault();

    const name =
      String($('newUserName')?.value || '').trim();

    const username =
      String($('newUsername')?.value || '')
        .trim()
        .toLowerCase();

    const password =
      String($('newUserPassword')?.value || '');

    const role =
      $('newUserRole')?.value || 'staff';

    const message = $('userMessage');

    if (!name || !username || !password) {
      if (message) {
        message.textContent =
          'أكمل بيانات المستخدم.';
        message.className = 'user-message error';
      }
      return;
    }

    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name,
          username,
          password,
          role
        })
      });

      if ($('userForm')) {
        $('userForm').reset();
      }

      if (message) {
        message.textContent =
          'تم إنشاء المستخدم بنجاح.';
        message.className =
          'user-message success';
      }

      await loadUsers();
    } catch (error) {
      console.error(error);

      if (message) {
        message.textContent =
          error.message ||
          'تعذر إنشاء المستخدم.';
        message.className =
          'user-message error';
      }
    }
  }

  async function deleteUser(id) {
    if (!id) return;

    const confirmed = window.confirm(
      'هل تريد حذف هذا المستخدم؟'
    );

    if (!confirmed) return;

    try {
      await api(
        `/admin/users/${encodeURIComponent(id)}`,
        {
          method: 'DELETE'
        }
      );

      await loadUsers();
    } catch (error) {
      console.error(error);

      window.alert(
        error.message ||
        'تعذر حذف المستخدم.'
      );
    }
  }

  /* =========================================================
     الإشعارات
  ========================================================= */

  async function enablePushNotifications() {
    const button = $('enablePushBtn');
    const message = $('pushMessage');

    if (!('Notification' in window)) {
      if (message) {
        message.textContent =
          'الإشعارات غير مدعومة في هذا المتصفح.';
      }
      return;
    }

    try {
      if (button) {
        button.disabled = true;
        button.textContent =
          'جاري التفعيل...';
      }

      if (!('serviceWorker' in navigator)) {
        throw new Error(
          'Service Worker غير مدعوم.'
        );
      }

      const permission =
        await Notification.requestPermission();

      if (permission !== 'granted') {
        throw new Error(
          'لم يتم السماح بالإشعارات.'
        );
      }

      const registration =
        await navigator.serviceWorker.register(
          '/sw.js'
        );

      let publicKeyResponse;

      try {
        publicKeyResponse =
          await api('/push/public-key');
      } catch (error) {
        if (error.status === 404) {
          throw new Error(
            'خدمة الإشعارات لم تُفعّل على الخادم بعد.'
          );
        }

        throw error;
      }

      const publicKey =
        publicKeyResponse?.publicKey;

      if (!publicKey) {
        throw new Error(
          'مفتاح الإشعارات غير موجود على الخادم.'
        );
      }

      const applicationServerKey =
        urlBase64ToUint8Array(publicKey);

      const subscription =
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });

      try {
        await api('/push/subscribe', {
          method: 'POST',
          body: JSON.stringify(subscription)
        });
      } catch (error) {
        if (error.status === 404) {
          throw new Error(
            'خدمة حفظ اشتراك الإشعارات لم تُفعّل على الخادم بعد.'
          );
        }

        throw error;
      }

      if (message) {
        message.textContent =
          'تم تفعيل إشعارات لوحة الإدارة.';
        message.className =
          'push-message success';
      }
    } catch (error) {
      console.error(error);

      if (message) {
        message.textContent =
          error.message ||
          'تعذر تفعيل الإشعارات.';
        message.className =
          'push-message error';
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          'تفعيل الإشعارات';
      }
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding =
      '='.repeat(
        (4 - (base64String.length % 4)) % 4
      );

    const base64 =
      (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData =
      window.atob(base64);

    return Uint8Array.from(
      [...rawData].map(char =>
        char.charCodeAt(0)
      )
    );
  }

  /* =========================================================
     الأحداث
  ========================================================= */

  function bindEvents() {
    $('adminLoginForm')?.addEventListener(
      'submit',
      login
    );

    $('logoutBtn')?.addEventListener(
      'click',
      () => logout(true)
    );

    $('refreshBtn')?.addEventListener(
      'click',
      loadBookings
    );

    $('nextBtn')?.addEventListener(
      'click',
      nextCustomer
    );

    $('adminDate')?.addEventListener(
      'change',
      loadBookings
    );

    $('openSiteBtn')?.addEventListener(
      'click',
      () => {
        window.location.href = '/';
      }
    );

    $('startScannerBtn')?.addEventListener(
      'click',
      startScanner
    );

    $('stopScannerBtn')?.addEventListener(
      'click',
      () => {
        stopScanner();

        setScannerMessage(
          'تم إيقاف الكاميرا.'
        );
      }
    );

    $('qrFileInput')?.addEventListener(
      'change',
      handleQRFile
    );

    $('enablePushBtn')?.addEventListener(
      'click',
      enablePushNotifications
    );

    $('addUserBtn')?.addEventListener(
      'click',
      () => {
        $('userOverlay')?.classList.add('open');
        $('userOverlay')?.classList.remove('hidden');
      }
    );

    $('closeBookingOverlay')?.addEventListener(
      'click',
      closeBookingOverlay
    );

    $('bookingOverlay')?.addEventListener(
      'click',
      event => {
        if (event.target === $('bookingOverlay')) {
          closeBookingOverlay();
        }
      }
    );

    $('closeUserOverlay')?.addEventListener(
      'click',
      closeUserOverlay
    );

    $('userOverlay')?.addEventListener(
      'click',
      event => {
        if (event.target === $('userOverlay')) {
          closeUserOverlay();
        }
      }
    );

    $('userForm')?.addEventListener(
      'submit',
      addUser
    );

    window.addEventListener(
      'beforeunload',
      stopScanner
    );
  }

  function closeUserOverlay() {
    $('userOverlay')?.classList.remove('open');
    $('userOverlay')?.classList.add('hidden');

    if ($('userMessage')) {
      $('userMessage').textContent = '';
      $('userMessage').className = 'user-message';
    }
  }

  /* =========================================================
     تشغيل لوحة الإدارة
  ========================================================= */

  async function boot() {
    bindEvents();

    showLogin();

    const loggedIn =
      await checkSession();

    if (loggedIn) {
      await initializeDashboard();
    }
  }

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();
