const form = document.getElementById("bookingForm");
const barberSelect = document.getElementById("barber");
const serviceSelect = document.getElementById("service");
const dateInput = document.getElementById("bookingDate");
const timeSelect = document.getElementById("bookingTime");
const errorBox = document.getElementById("error");
const ticket = document.getElementById("ticket");
const bookingPanel = document.getElementById("bookingPanel");

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

  const get = (type) => parts.find((p) => p.type === type)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function showError(message) {
  errorBox.textContent = message || "";
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر تحميل إعدادات الموقع");
    }

    barberSelect.innerHTML =
      '<option value="">اختر الحلاق</option>' +
      data.barbers
        .map(
          (barber) =>
            `<option value="${escapeHtml(barber.id)}">${escapeHtml(
              barber.name
            )}</option>`
        )
        .join("");

    serviceSelect.innerHTML =
      '<option value="">اختر الخدمة</option>' +
      data.services
        .map(
          (service) =>
            `<option value="${escapeHtml(service.id)}">${escapeHtml(
              service.name
            )} — ${Number(service.price).toFixed(0)} جنيه</option>`
        )
        .join("");

    dateInput.min = cairoToday();
  } catch (error) {
    showError(error.message || "تعذر تحميل الموقع");
  }
}

async function loadAvailability() {
  showError("");

  const date = dateInput.value;
  const barber = barberSelect.value;

  if (!date || !barber) {
    timeSelect.innerHTML =
      '<option value="">اختر التاريخ والحلاق أولاً</option>';
    return;
  }

  timeSelect.innerHTML =
    '<option value="">جاري تحميل المواعيد...</option>';

  try {
    const response = await fetch(
      `/api/availability?date=${encodeURIComponent(
        date
      )}&barber=${encodeURIComponent(barber)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر تحميل المواعيد");
    }

    timeSelect.innerHTML = "";

    let availableCount = 0;

    for (const slot of data.slots) {
      const option = document.createElement("option");

      option.value = slot.value;

      if (slot.available > 0) {
        option.textContent = `${slot.label} — متاح ${slot.available}`;
        availableCount++;
      } else {
        option.textContent = `${slot.label} — مكتمل`;
        option.disabled = true;
      }

      timeSelect.appendChild(option);
    }

    if (!availableCount) {
      timeSelect.innerHTML =
        '<option value="">لا توجد مواعيد متاحة لهذا اليوم</option>';
    }
  } catch (error) {
    timeSelect.innerHTML =
      '<option value="">تعذر تحميل المواعيد</option>';

    showError(error.message || "تعذر تحميل المواعيد");
  }
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(`${dateString}T12:00:00`);

  return new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatStatus(status) {
  const statuses = {
    waiting: "بانتظار الدور",
    called: "تم الاستدعاء",
    completed: "تم الانتهاء",
    cancelled: "ملغي"
  };

  return statuses[status] || status;
}

function renderTicket(booking, qrCode) {
  bookingPanel.classList.add("hidden");
  ticket.classList.remove("hidden");

  ticket.innerHTML = `
    <div class="ticket-head">
      <div class="logo">YF</div>
      <div>
        <h2>تم تأكيد الحجز</h2>
        <p>يوسف فاروق — BARBER HOUSE</p>
      </div>
    </div>

    <div class="ticket-number">
      <span>رقم الحجز</span>
      <strong>#${escapeHtml(booking.id)}</strong>
    </div>

    <div class="ticket-grid">
      <div>
        <small>اسم العميل</small>
        <strong>${escapeHtml(booking.customerName)}</strong>
      </div>

      <div>
        <small>رقم الهاتف</small>
        <strong>${escapeHtml(booking.phone)}</strong>
      </div>

      <div>
        <small>الحلاق</small>
        <strong>${escapeHtml(booking.barberName)}</strong>
      </div>

      <div>
        <small>الخدمة</small>
        <strong>${escapeHtml(booking.serviceName)}</strong>
      </div>

      <div>
        <small>التاريخ</small>
        <strong>${escapeHtml(formatDate(booking.date))}</strong>
      </div>

      <div>
        <small>الموعد</small>
        <strong>${escapeHtml(booking.time)}</strong>
      </div>

      <div>
        <small>دورك في هذا الموعد</small>
        <strong>${escapeHtml(booking.slotNumber)}</strong>
      </div>

      <div>
        <small>الحالة</small>
        <strong>${escapeHtml(formatStatus(booking.status))}</strong>
      </div>
    </div>

    <div class="qr-box">
      <p>رمز الدخول للحجز</p>
      <img src="${qrCode}" alt="QR Code">
      <small>احتفظ بهذا الرمز لإظهاره عند الوصول.</small>
    </div>

    <button class="primary" type="button" onclick="location.reload()">
      حجز موعد جديد
    </button>
  `;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  showError("");

  const button = form.querySelector("button[type='submit']");
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "جاري تأكيد الحجز...";

  try {
    const payload = {
      customerName: document.getElementById("customerName").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      barberId: barberSelect.value,
      serviceId: serviceSelect.value,
      date: dateInput.value,
      time: timeSelect.value
    };

    if (
      !payload.customerName ||
      !payload.phone ||
      !payload.barberId ||
      !payload.serviceId ||
      !payload.date ||
      !payload.time
    ) {
      throw new Error("يرجى إكمال جميع بيانات الحجز");
    }

    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر إنشاء الحجز");
    }

    renderTicket(data.booking, data.qrCode);

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  } catch (error) {
    showError(error.message || "حدث خطأ أثناء الحجز");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

barberSelect.addEventListener("change", loadAvailability);
dateInput.addEventListener("change", loadAvailability);

dateInput.value = cairoToday();

loadConfig();
