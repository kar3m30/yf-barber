(() => {
  "use strict";

  const TOKEN_KEY = "yf_admin_token";
  const $ = (id) => document.getElementById(id);

  function show(view) {
    $("loginView").classList.toggle("hidden", view !== "login");
    $("dashboard").classList.toggle("hidden", view !== "dashboard");
  }

  function msg(id, text, type="error") {
    const el = $(id);
    el.textContent = text || "";
    el.className = text ? `message show ${type}` : "message";
  }

  async function api(path, options={}) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const headers = {"Content-Type":"application/json", ...(options.headers || {})};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, {...options, headers});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "تعذر تنفيذ الطلب");
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  async function login(event) {
    event.preventDefault();
    msg("loginMessage", "");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("username").value.trim(),
          password: $("password").value
        })
      });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      show("dashboard");
      $("filterDate").value = localDate();
      await loadBookings();
    } catch (e) {
      msg("loginMessage", e.message);
    }
  }

  async function checkSession() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      await api("/api/admin/me");
      return true;
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
      return false;
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[ch]));
  }

  async function loadBookings() {
    const date = $("filterDate").value;
    const status = $("filterStatus").value;
    msg("listMessage", "");
    try {
      const data = await api(`/api/admin/bookings?date=${encodeURIComponent(date)}&status=${encodeURIComponent(status)}`);
      $("bookingsBody").innerHTML = data.bookings.map(b => `
        <tr>
          <td>${esc(b.queue)}</td>
          <td>${esc(b.time)}</td>
          <td>${esc(b.name)}</td>
          <td>${esc(b.phone)}</td>
          <td>${esc(b.service)}</td>
          <td>${esc(b.slot)}</td>
          <td><span class="badge ${b.status === "cancelled" ? "cancelled":"active"}">${b.status === "cancelled" ? "ملغي":"نشط"}</span></td>
          <td>${b.status === "cancelled" ? "—" : `<button class="danger cancel-btn" data-id="${esc(b.id)}">إلغاء</button>`}</td>
        </tr>
      `).join("") || `<tr><td colspan="8" class="muted">لا توجد حجوزات لهذا اليوم.</td></tr>`;

      document.querySelectorAll(".cancel-btn").forEach(btn => {
        btn.addEventListener("click", () => cancelBooking(btn.dataset.id));
      });
    } catch (e) {
      msg("listMessage", e.message);
    }
  }

  async function cancelBooking(id) {
    if (!confirm("هل تريد إلغاء هذا الحجز؟")) return;
    try {
      await api(`/api/admin/bookings/${encodeURIComponent(id)}/cancel`, {method:"POST"});
      await loadBookings();
    } catch (e) {
      msg("listMessage", e.message);
    }
  }

  let scanner = null;

  async function startScanner() {
    if (!window.Html5Qrcode) {
      msg("listMessage", "تعذر تحميل أداة QR. افتح الصفحة مع اتصال بالإنترنت.");
      return;
    }
    if (scanner) return;
    scanner = new Html5Qrcode("reader");
    try {
      await scanner.start(
        {facingMode:"environment"},
        {fps:10, qrbox:{width:250,height:250}},
        async (decodedText) => {
          await stopScanner();
          await lookupQR(decodedText);
        },
        () => {}
      );
    } catch (e) {
      msg("listMessage", "تعذر تشغيل الكاميرا: " + e.message);
      scanner = null;
    }
  }

  async function stopScanner() {
    if (!scanner) return;
    try { await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
    scanner = null;
  }

  async function lookupQR(value) {
    const result = $("scanResult");
    result.textContent = "جارٍ البحث...";
    try {
      let token = value;
      const match = String(value).match(/\/api\/bookings\/token\/([^/?#]+)/);
      if (match) token = decodeURIComponent(match[1]);
      const data = await api(`/api/bookings/token/${encodeURIComponent(token)}`);
      const b = data.booking;
      result.innerHTML = `
        <h3>الحجز موجود ✓</h3>
        <p><b>الاسم:</b> ${esc(b.name)}</p>
        <p><b>الهاتف:</b> ${esc(b.phone)}</p>
        <p><b>الخدمة:</b> ${esc(b.service)}</p>
        <p><b>التاريخ:</b> ${esc(b.date)}</p>
        <p><b>الوقت:</b> ${esc(b.time)}</p>
        <p><b>الدور:</b> ${esc(b.queue)} — <b>المقعد:</b> ${esc(b.slot)}</p>
        <p><b>الحالة:</b> ${esc(b.status)}</p>`;
    } catch (e) {
      result.textContent = e.message;
    }
  }

  $("loginForm").addEventListener("submit", login);
  $("refreshButton").addEventListener("click", loadBookings);
  $("loadButton").addEventListener("click", loadBookings);
  $("logoutButton").addEventListener("click", async () => {
    sessionStorage.removeItem(TOKEN_KEY);
    await stopScanner();
    show("login");
  });
  $("startScan").addEventListener("click", startScanner);

  (async () => {
    const logged = await checkSession();
    if (logged) {
      show("dashboard");
      $("filterDate").value = localDate();
      await loadBookings();
    } else {
      show("login");
    }
  })();
})();
