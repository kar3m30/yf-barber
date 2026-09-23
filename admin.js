let scanner = null;

const loginBox = document.getElementById("login");
const appBox = document.getElementById("app");
const loginErr = document.getElementById("loginErr");

const dateInput = document.getElementById("date");
const barberSelect = document.getElementById("barber");
const list = document.getElementById("list");
const current = document.getElementById("current");
const scanResult = document.getElementById("scanResult");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type) =>
    parts.find((item) => item.type === type)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function login() {
  loginErr.textContent = "";

  const username = document.getElementById("user").value.trim();
  const password = document.getElementById("pass").value;

  if (!username || !password) {
    loginErr.textContent = "أدخل اسم المستخدم وكلمة المرور";
    return;
  }

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "فشل تسجيل الدخول");
    }

    loginBox.classList.add("hidden");
    appBox.classList.remove("hidden");

    await loadConfig();
    await loadBookings();
  } catch (error) {
    loginErr.textContent =
      error.message || "تعذر تسجيل الدخول";
  }
}

async function checkLogin() {
  try {
    const response = await fetch("/api/admin/me");

    if (!response.ok) return;

    loginBox.classList.add("hidden");
    appBox.classList.remove("hidden");

    await loadConfig();
    await loadBookings();
  } catch (error) {
    console.error(error);
  }
}

async function logout() {
  try {
    await fetch("/api/admin/logout", {
      method: "POST"
    });
  } finally {
    location.reload();
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "تعذر تحميل الإعدادات");
  }

  barberSelect.innerHTML =
    '<option value="">كل الحلاقين</option>' +
    data.barbers
      .map(
        (barber) =>
          `<option value="${escapeHtml(
            barber.id
          )}">${escapeHtml(barber.name)}</option>`
      )
      .join("");

  if (!dateInput.value) {
    dateInput.value = cairoToday();
  }
}

function statusText(status) {
  const map = {
    waiting: "بانتظار",
    called: "تم الاستدعاء",
    completed: "مكتمل",
    cancelled: "ملغي"
  };

  return map[status] || status;
}

async function loadBookings() {
  list.innerHTML = "<p>جاري تحميل الحجوزات...</p>";

  try {
    const date = dateInput.value;
    const barber = barberSelect.value;

    const url =
      `/api/admin/bookings?date=${encodeURIComponent(date)}` +
      `&barber=${encodeURIComponent(barber)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر تحميل الحجوزات");
    }

    renderBookings(data.bookings || []);
  } catch (error) {
    list.innerHTML = `
      <p class="error">
        ${escapeHtml(error.message || "حدث خطأ")}
      </p>
    `;
  }
}

function renderBookings(bookings) {
  if (!bookings.length) {
    list.innerHTML = "<p>لا توجد حجوزات لهذا اليوم.</p>";
    current.textContent = "لا يوجد عميل مستدعى";
    return;
  }

  list.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم</th>
          <th>العميل</th>
          <th>الهاتف</th>
          <th>الحلاق</th>
          <th>الخدمة</th>
          <th>الوقت</th>
          <th>الدور</th>
          <th>الحالة</th>
          <th>الإجراء</th>
        </tr>
      </thead>

      <tbody>
        ${bookings
          .map(
            (booking) => `
          <tr>
            <td>#${escapeHtml(booking.id)}</td>
            <td><strong>${escapeHtml(booking.customerName)}</strong></td>
            <td>${escapeHtml(booking.phone)}</td>
            <td>${escapeHtml(booking.barberName)}</td>
            <td>${escapeHtml(booking.serviceName)}</td>
            <td>${escapeHtml(booking.time)}</td>
            <td>${escapeHtml(booking.slotNumber)}</td>
            <td>
              <span class="status">
                ${escapeHtml(statusText(booking.status))}
              </span>
            </td>
            <td>
              <select onchange="changeStatus(${booking.id}, this.value)">
                <option value="">تغيير الحالة</option>
                <option value="waiting">بانتظار</option>
                <option value="called">تم الاستدعاء</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function changeStatus(id, status) {
  if (!status) return;

  try {
    const response = await fetch(
      `/api/admin/bookings/${id}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر تحديث الحالة");
    }

    await loadBookings();
  } catch (error) {
    alert(error.message || "تعذر تحديث الحالة");
  }
}

async function nextBooking() {
  try {
    const response = await fetch("/api/admin/next", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date: dateInput.value,
        barberId: barberSelect.value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "تعذر استدعاء العميل التالي"
      );
    }

    const booking = data.booking;

    current.innerHTML = `
      <div class="current-card">
        <h3>${escapeHtml(booking.customerName)}</h3>

        <p>
          <strong>الهاتف:</strong>
          ${escapeHtml(booking.phone)}
        </p>

        <p>
          <strong>الحلاق:</strong>
          ${escapeHtml(booking.barberName)}
        </p>

        <p>
          <strong>الخدمة:</strong>
          ${escapeHtml(booking.serviceName)}
        </p>

        <p>
          <strong>الموعد:</strong>
          ${escapeHtml(booking.time)}
        </p>

        <p>
          <strong>الدور:</strong>
          ${escapeHtml(booking.slotNumber)}
        </p>

        <p class="called">
          العميل مستدعى الآن
        </p>
      </div>
    `;

    await loadBookings();
  } catch (error) {
    alert(error.message || "لا يوجد عميل منتظر");
  }
}

async function startScanner() {
  scanResult.textContent = "";

  if (typeof Html5Qrcode === "undefined") {
    scanResult.textContent =
      "تعذر تحميل قارئ QR. تأكد من اتصال الإنترنت.";
    return;
  }

  try {
    if (scanner) {
      try {
        await scanner.stop();
      } catch (_) {}

      scanner.clear();
      scanner = null;
    }

    scanner = new Html5Qrcode("reader");

    await scanner.start(
      {
        facingMode: "environment"
      },
      {
        fps: 10,
        qrbox: {
          width: 250,
          height: 250
        }
      },
      async (decodedText) => {
        await handleQr(decodedText);
      },
      () => {}
    );
  } catch (error) {
    console.error(error);

    scanResult.textContent =
      "تعذر تشغيل الكاميرا. اسمح للمتصفح باستخدام الكاميرا.";
  }
}

async function handleQr(decodedText) {
  let bookingId = null;

  try {
    const url = new URL(decodedText);
    bookingId = url.searchParams.get("booking");
  } catch (_) {
    const match = String(decodedText).match(/booking=(\d+)/);

    if (match) {
      bookingId = match[1];
    }
  }

  if (!bookingId || !/^\d+$/.test(String(bookingId))) {
    scanResult.textContent =
      "رمز QR غير تابع لحجز يوسف فاروق.";
    return;
  }

  try {
    const response = await fetch(
      `/api/admin/scan/${bookingId}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "الحجز غير موجود"
      );
    }

    const booking = data.booking;

    scanResult.innerHTML = `
      <div class="scan-card">
        <h3>تم التعرف على الحجز</h3>

        <p>
          <strong>رقم الحجز:</strong>
          #${escapeHtml(booking.id)}
        </p>

        <p>
          <strong>العميل:</strong>
          ${escapeHtml(booking.customerName)}
        </p>

        <p>
          <strong>الهاتف:</strong>
          ${escapeHtml(booking.phone)}
        </p>

        <p>
          <strong>الحلاق:</strong>
          ${escapeHtml(booking.barberName)}
        </p>

        <p>
          <strong>الموعد:</strong>
          ${escapeHtml(booking.time)}
        </p>

        <p>
          <strong>الحالة:</strong>
          ${escapeHtml(statusText(booking.status))}
        </p>
      </div>
    `;

    await loadBookings();
  } catch (error) {
    scanResult.textContent =
      error.message || "تعذر قراءة الحجز";
  }
}

dateInput.addEventListener("change", loadBookings);
barberSelect.addEventListener("change", loadBookings);

window.login = login;
window.logout = logout;
window.loadBookings = loadBookings;
window.nextBooking = nextBooking;
window.startScanner = startScanner;
window.changeStatus = changeStatus;

checkLogin();
