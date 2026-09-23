(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const form = $("bookingForm");
  const dateInput = $("date");
  const slotsBox = $("slots");
  const timeInput = $("time");
  const message = $("message");
  const submitButton = $("submitButton");

  const SERVICES = ["قص شعر","حلاقة","قص شعر + حلاقة","أطفال"];

  function localDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }

  function makeTimes() {
    const times = [];
    for (let h = 12; h <= 24; h++) {
      const hour = h === 24 ? 0 : h;
      const labelHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
      const suffix = hour >= 12 ? "م" : "ص";
      times.push(`${String(hour).padStart(2,"0")}:00|${labelHour}:00 ${suffix}`);
    }
    for (let h = 1; h <= 1; h++) times.push(`0${h}:00|${h}:00 ص`);
    return times;
  }

  function showMessage(text, type="error") {
    message.textContent = text;
    message.className = `message show ${type}`;
  }

  function clearMessage() {
    message.textContent = "";
    message.className = "message";
  }

  async function api(path, options={}) {
    const res = await fetch(path, {
      ...options,
      headers: {"Content-Type":"application/json", ...(options.headers || {})}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "تعذر تنفيذ الطلب");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function loadSlots() {
    clearMessage();
    slotsBox.innerHTML = "";
    timeInput.value = "";
    const date = dateInput.value;
    if (!date) return;

    try {
      const data = await api(`/api/availability?date=${encodeURIComponent(date)}`);
      for (const item of data.slots) {
        const [value,label] = item.time.split("|");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot";
        button.dataset.time = value;
        button.disabled = item.count >= 2;
        button.innerHTML = `${label}<small>${item.count >= 2 ? "مكتمل" : `${2-item.count} متاح`}</small>`;
        button.addEventListener("click", () => {
          document.querySelectorAll(".slot").forEach(x => x.classList.remove("selected"));
          button.classList.add("selected");
          timeInput.value = value;
          clearMessage();
        });
        slotsBox.appendChild(button);
      }
    } catch (e) {
      showMessage(e.message);
    }
  }

  function renderBooking(booking) {
    $("bookingSection").classList.add("hidden");
    $("bookingCard").classList.remove("hidden");
    $("queue").textContent = booking.queue;
    $("outName").textContent = booking.name;
    $("outPhone").textContent = booking.phone;
    $("outService").textContent = booking.service;
    $("outDate").textContent = booking.date;
    $("outTime").textContent = booking.time;
    $("outSlot").textContent = booking.slot === 1 ? "1" : "2";

    const qrData = `${location.origin}/api/bookings/token/${encodeURIComponent(booking.token)}`;
    const img = document.createElement("img");
    img.alt = "QR";
    img.src = `https://quickchart.io/qr?text=${encodeURIComponent(qrData)}&size=240`;
    $("qrBox").replaceChildren(img);
  }

  dateInput.min = localDate();
  dateInput.value = localDate();
  dateInput.addEventListener("change", loadSlots);
  loadSlots();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const name = $("name").value.trim();
    const phone = $("phone").value.trim();
    const service = $("service").value;
    const date = dateInput.value;
    const time = timeInput.value;

    if (!name || !phone || !service || !date || !time) {
      showMessage("أكمل جميع البيانات واختر الوقت.");
      return;
    }
    if (!SERVICES.includes(service)) {
      showMessage("الخدمة غير صحيحة.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "جارٍ تأكيد الحجز...";

    try {
      const data = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({name, phone, service, date, time})
      });
      renderBooking(data.booking);
    } catch (e) {
      showMessage(e.message);
      await loadSlots();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "تأكيد الحجز";
    }
  });
})();
