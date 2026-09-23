'use strict';

/* =========================================================
   YF — يوسف فاروق
   Customer App
   لا يحتوي على أي CSS أو تغيير في التصميم
========================================================= */

const $ = (id) =>
  document.getElementById(id);

const API = '/api';

/* =========================================================
   الخدمات
========================================================= */

const services = {
  signature: 'الحلاقة والتشذيب المميز',
  classic: 'الحلاقة الكلاسيكية',
  beard: 'تهذيب اللحية الملكية'
};

const servicePrices = {
  signature: 180,
  classic: 120,
  beard: 80
};

/* =========================================================
   الحالة
========================================================= */

let currentBooking = null;
let queueTimer = null;
let qrInstance = null;

/* =========================================================
   أدوات عامة
========================================================= */

function todayCairo() {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function formatDate(date) {
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat(
      'ar-EG',
      {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Africa/Cairo'
      }
    ).format(
      new Date(`${date}T12:00:00`)
    );
  } catch {
    return date;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showMessage(message, type = 'error') {
  /*
    نحاول استخدام عناصر الرسائل الموجودة
    في التصميم الحالي بدون إنشاء تصميم جديد.
  */

  const candidates = [
    $('message'),
    $('formMessage'),
    $('bookingMessage'),
    $('errorMessage'),
    $('alertMessage'),
    $('statusMessage')
  ];

  const box =
    candidates.find(Boolean);

  if (!box) {
    alert(message);
    return;
  }

  box.textContent = message;

  box.dataset.type = type;

  box.classList.remove(
    'show',
    'success',
    'error'
  );

  box.classList.add(
    'show',
    type
  );
}

function clearMessage() {
  const candidates = [
    $('message'),
    $('formMessage'),
    $('bookingMessage'),
    $('errorMessage'),
    $('alertMessage'),
    $('statusMessage')
  ];

  const box =
    candidates.find(Boolean);

  if (!box) return;

  box.textContent = '';

  box.classList.remove(
    'show',
    'success',
    'error'
  );
}

/* =========================================================
   API
========================================================= */

async function apiRequest(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,
      headers: {
        'Content-Type':
          'application/json',
        ...(options.headers || {})
      }
    });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error =
      new Error(
        data.error ||
        'حدث خطأ غير متوقع'
      );

    error.status =
      response.status;

    throw error;
  }

  return data;
}

/* =========================================================
   التنقل داخل الموقع
========================================================= */

function hideAllSections() {
  const sectionIds = [
    'home',
    'booking',
    'book',
    'pass',
    'queue',
    'myBooking',
    'confirmation'
  ];

  sectionIds.forEach(id => {
    const element = $(id);

    if (element) {
      element.classList.remove('active');
      element.hidden = true;
    }
  });
}

function showSection(id) {
  const element = $(id);

  if (!element) {
    return false;
  }

  hideAllSections();

  element.hidden = false;
  element.classList.add('active');

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  return true;
}

function navigateTo(name) {
  const aliases = {
    home: [
      'home'
    ],

    booking: [
      'booking',
      'book'
    ],

    pass: [
      'pass',
      'myBooking',
      'confirmation'
    ],

    queue: [
      'queue'
    ]
  };

  const ids =
    aliases[name] || [name];

  for (const id of ids) {
    if ($(id)) {
      showSection(id);
      return;
    }
  }
}

/* =========================================================
   ربط أزرار التنقل الموجودة في التصميم
========================================================= */

function bindNavigation() {
  document.addEventListener(
    'click',
    event => {
      const button =
        event.target.closest(
          '[data-page], [data-nav], [data-section]'
        );

      if (!button) return;

      const page =
        button.dataset.page ||
        button.dataset.nav ||
        button.dataset.section;

      if (!page) return;

      event.preventDefault();

      navigateTo(page);
    }
  );

  /*
    أزرار شائعة موجودة في النسخ السابقة
  */

  const homeButtons = [
    'homeBtn',
    'homeNav',
    'navHome'
  ];

  const bookingButtons = [
    'bookBtn',
    'bookingBtn',
    'startBookingBtn',
    'navBooking'
  ];

  const passButtons = [
    'passBtn',
    'myBookingBtn',
    'navPass'
  ];

  const queueButtons = [
    'queueBtn',
    'queueNav',
    'navQueue'
  ];

  homeButtons.forEach(id => {
    const element = $(id);

    if (element) {
      element.addEventListener(
        'click',
        () => navigateTo('home')
      );
    }
  });

  bookingButtons.forEach(id => {
    const element = $(id);

    if (element) {
      element.addEventListener(
        'click',
        () => navigateTo('booking')
      );
    }
  });

  passButtons.forEach(id => {
    const element = $(id);

    if (element) {
      element.addEventListener(
        'click',
        () => navigateTo('pass')
      );
    }
  });

  queueButtons.forEach(id => {
    const element = $(id);

    if (element) {
      element.addEventListener(
        'click',
        () => navigateTo('queue')
      );
    }
  });
}

/* =========================================================
   التاريخ
========================================================= */

function setupDateInputs() {
  const today =
    todayCairo();

  const inputs = [
    $('date'),
    $('bookingDate'),
    $('dateInput')
  ];

  inputs.forEach(input => {
    if (!input) return;

    input.min = today;

    if (!input.value) {
      input.value = today;
    }
  });
}

/* =========================================================
   الأوقات
========================================================= */

async function loadTimes() {
  const selects = [
    $('time'),
    $('bookingTime'),
    $('timeSelect')
  ].filter(Boolean);

  if (!selects.length) {
    return;
  }

  try {
    const data =
      await apiRequest(
        `${API}/times`
      );

    const times =
      Array.isArray(data.times)
        ? data.times
        : [];

    selects.forEach(select => {
      const current =
        select.value;

      /*
        لا نغيّر شكل select.
        فقط نملأ الاختيارات.
      */

      select.innerHTML = '';

      const placeholder =
        document.createElement('option');

      placeholder.value = '';
      placeholder.textContent =
        'اختر الوقت';

      select.appendChild(
        placeholder
      );

      times.forEach(time => {
        const option =
          document.createElement(
            'option'
          );

        option.value = time;
        option.textContent = time;

        select.appendChild(
          option
        );
      });

      if (
        current &&
        times.includes(current)
      ) {
        select.value = current;
      }
    });
  } catch (error) {
    console.error(
      'Failed to load times:',
      error
    );
  }
}

/* =========================================================
   الخدمات
========================================================= */

function getSelectedService() {
  const candidates = [
    $('service'),
    $('serviceSelect'),
    $('bookingService')
  ];

  const select =
    candidates.find(Boolean);

  if (select) {
    return select.value;
  }

  const checked =
    document.querySelector(
      'input[name="service"]:checked'
    );

  return checked
    ? checked.value
    : '';
}

function bindServiceCards() {
  /*
    يدعم التصميم الحالي سواء كانت الخدمات
    buttons أو radio inputs.
  */

  document.addEventListener(
    'click',
    event => {
      const serviceElement =
        event.target.closest(
          '[data-service]'
        );

      if (!serviceElement) {
        return;
      }

      const service =
        serviceElement.dataset.service;

      if (!services[service]) {
        return;
      }

      document
        .querySelectorAll(
          '[data-service]'
        )
        .forEach(element => {
          element.classList.remove(
            'selected',
            'active'
          );
        });

      serviceElement.classList.add(
        'selected',
        'active'
      );

      const hiddenInputs =
        document.querySelectorAll(
          'input[name="service"]'
        );

      hiddenInputs.forEach(input => {
        input.checked =
          input.value === service;
      });

      const serviceSelect =
        $('service') ||
        $('serviceSelect') ||
        $('bookingService');

      if (serviceSelect) {
        serviceSelect.value =
          service;
      }

      updateServicePrice(service);
    }
  );
}

function updateServicePrice(service) {
  const price =
    servicePrices[service];

  if (!price) return;

  const elements = [
    $('servicePrice'),
    $('selectedServicePrice'),
    $('price'),
    $('bookingPrice')
  ].filter(Boolean);

  elements.forEach(element => {
    element.textContent =
      `${price} ج.م`;
  });
}

/* =========================================================
   بيانات نموذج الحجز
========================================================= */

function getBookingForm() {
  const nameInput =
    $('name') ||
    $('customerName') ||
    $('bookingName');

  const phoneInput =
    $('phone') ||
    $('customerPhone') ||
    $('bookingPhone');

  const dateInput =
    $('date') ||
    $('bookingDate') ||
    $('dateInput');

  const timeInput =
    $('time') ||
    $('bookingTime') ||
    $('timeSelect');

  return {
    nameInput,
    phoneInput,
    dateInput,
    timeInput
  };
}

/* =========================================================
   الحجز
========================================================= */

async function submitBooking(event) {
  if (event) {
    event.preventDefault();
  }

  clearMessage();

  const form =
    getBookingForm();

  if (
    !form.nameInput ||
    !form.phoneInput ||
    !form.dateInput ||
    !form.timeInput
  ) {
    console.error(
      'Booking form elements not found'
    );

    return;
  }

  const name =
    form.nameInput.value.trim();

  const phone =
    form.phoneInput.value.trim();

  const date =
    form.dateInput.value.trim();

  const time =
    form.timeInput.value.trim();

  const service =
    getSelectedService();

  if (!name) {
    showMessage(
      'يرجى إدخال الاسم'
    );

    form.nameInput.focus();

    return;
  }

  if (!phone) {
    showMessage(
      'يرجى إدخال رقم الهاتف'
    );

    form.phoneInput.focus();

    return;
  }

  if (!date) {
    showMessage(
      'يرجى اختيار التاريخ'
    );

    form.dateInput.focus();

    return;
  }

  if (!time) {
    showMessage(
      'يرجى اختيار الوقت'
    );

    form.timeInput.focus();

    return;
  }

  if (!service) {
    showMessage(
      'يرجى اختيار الخدمة'
    );

    return;
  }

  const submitButtons =
    document.querySelectorAll(
      '#bookingForm button[type="submit"],' +
      '#bookForm button[type="submit"],' +
      '#confirmBookingBtn,' +
      '#submitBookingBtn'
    );

  submitButtons.forEach(button => {
    button.disabled = true;

    button.dataset.originalText =
      button.textContent;

    button.textContent =
      'جارٍ تأكيد الحجز...';
  });

  try {
    const data =
      await apiRequest(
        `${API}/bookings`,
        {
          method: 'POST',

          body: JSON.stringify({
            name,
            phone,
            date,
            time,
            service
          })
        }
      );

    currentBooking =
      data.booking;

    saveBookingLocally(
      currentBooking
    );

    renderBookingCard(
      currentBooking
    );

    navigateTo('pass');

    startQueueUpdates();

  } catch (error) {
    console.error(error);

    if (error.status === 409) {
      showMessage(
        'هذا الموعد مكتمل. اختر وقتًا آخر.'
      );
    } else {
      showMessage(
        error.message ||
        'تعذر إنشاء الحجز. حاول مرة أخرى.'
      );
    }
  } finally {
    submitButtons.forEach(button => {
      button.disabled = false;

      if (
        button.dataset.originalText
      ) {
        button.textContent =
          button.dataset.originalText;
      }
    });
  }
}

/* =========================================================
   ربط نموذج الحجز
========================================================= */

function bindBookingForm() {
  const forms = [
    $('bookingForm'),
    $('bookForm')
  ].filter(Boolean);

  forms.forEach(form => {
    form.addEventListener(
      'submit',
      submitBooking
    );
  });

  const buttons = [
    $('confirmBookingBtn'),
    $('submitBookingBtn')
  ].filter(Boolean);

  buttons.forEach(button => {
    /*
      لو الزر خارج form.
    */

    if (
      button.type !== 'submit'
    ) {
      button.addEventListener(
        'click',
        submitBooking
      );
    }
  });
}

/* =========================================================
   تخزين الحجز محليًا
========================================================= */

function saveBookingLocally(
  booking
) {
  try {
    localStorage.setItem(
      'yf_booking_token',
      booking.token
    );
  } catch (error) {
    console.warn(
      'Unable to save booking:',
      error
    );
  }
}

function getSavedBookingToken() {
  try {
    return localStorage.getItem(
      'yf_booking_token'
    );
  } catch {
    return null;
  }
}

/* =========================================================
   تحميل الحجز السابق
========================================================= */

async function loadSavedBooking() {
  const token =
    getSavedBookingToken();

  if (!token) {
    return null;
  }

  try {
    const booking =
      await apiRequest(
        `${API}/bookings/token/${encodeURIComponent(token)}`
      );

    currentBooking =
      booking;

    renderBookingCard(
      booking
    );

    return booking;
  } catch (error) {
    console.warn(
      'Saved booking unavailable:',
      error
    );

    return null;
  }
}

/* =========================================================
   بطاقة الحجز
========================================================= */

function renderBookingCard(
  booking
) {
  if (!booking) {
    return;
  }

  const serviceName =
    services[booking.service] ||
    booking.service;

  const price =
    servicePrices[booking.service];

  const values = {
    name:
      booking.name,

    phone:
      booking.phone,

    service:
      serviceName,

    price:
      price
        ? `${price} ج.م`
        : '',

    date:
      formatDate(
        booking.date
      ),

    rawDate:
      booking.date,

    time:
      booking.time,

    queue:
      booking.queue,

    slot:
      booking.slot,

    status:
      booking.status
  };

  /*
    ندعم أسماء العناصر الموجودة
    في التصميم الحالي بدون تغييرها.
  */

  const map = {
    bookingName: values.name,
    passName: values.name,
    cardName: values.name,

    bookingPhone: values.phone,
    passPhone: values.phone,
    cardPhone: values.phone,

    bookingService: values.service,
    passService: values.service,
    cardService: values.service,

    bookingPrice: values.price,
    passPrice: values.price,
    cardPrice: values.price,

    bookingDate: values.date,
    passDate: values.date,
    cardDate: values.date,

    bookingTime: values.time,
    passTime: values.time,
    cardTime: values.time,

    bookingQueue:
      values.queue,

    passQueue:
      values.queue,

    queueNumber:
      values.queue,

    cardQueue:
      values.queue
  };

  Object.entries(map)
    .forEach(
      ([id, value]) => {
        const element = $(id);

        if (!element) return;

        element.textContent =
          value ?? '';
      }
    );

  /*
    عناصر data-booking-field
    تجعل البطاقة متوافقة مع التصميم
    حتى لو اختلفت IDs.
  */

  document
    .querySelectorAll(
      '[data-booking-field]'
    )
    .forEach(element => {
      const field =
        element.dataset.bookingField;

      if (
        Object.prototype.hasOwnProperty.call(
          values,
          field
        )
      ) {
        element.textContent =
          values[field] ?? '';
      }
    });

  updateBookingStatus(
    booking
  );

  renderQR(
    booking
  );
}

/* =========================================================
   حالة الحجز
========================================================= */

function statusArabic(
  status
) {
  switch (status) {
    case 'waiting':
      return 'في الانتظار';

    case 'serving':
      return 'جاري خدمتك';

    case 'done':
      return 'تمت الخدمة';

    case 'cancelled':
      return 'ملغي';

    default:
      return status || '';
  }
}

function updateBookingStatus(
  booking
) {
  const text =
    statusArabic(
      booking.status
    );

  const elements = [
    $('bookingStatus'),
    $('passStatus'),
    $('cardStatus'),
    $('status')
  ].filter(Boolean);

  elements.forEach(element => {
    element.textContent = text;

    element.dataset.status =
      booking.status;

    element.classList.remove(
      'waiting',
      'serving',
      'done',
      'cancelled'
    );

    element.classList.add(
      booking.status
    );
  });
}

/* =========================================================
   QR Code
========================================================= */

function renderQR(
  booking
) {
  const containers = [
    $('qrcode'),
    $('qrCode'),
    $('bookingQR'),
    $('passQR'),
    $('qr')
  ].filter(Boolean);

  if (!containers.length) {
    return;
  }

  /*
    QR يحتوي token فقط.
    لوحة الإدارة تستطيع استخدامه
    للوصول للحجز.
  */

  containers.forEach(container => {
    container.innerHTML = '';

    if (
      typeof QRCode ===
      'undefined'
    ) {
      container.textContent =
        'QR';
      return;
    }

    try {
      new QRCode(
        container,
        {
          text: booking.token,
          width: 180,
          height: 180,
          correctLevel:
            QRCode.CorrectLevel.H
        }
      );
    } catch (error) {
      console.error(
        'QR generation failed:',
        error
      );
    }
  });
}

/* =========================================================
   الطابور
========================================================= */

async function loadQueue(
  date,
  myToken = null
) {
  if (!date) {
    return;
  }

  try {
    const data =
      await apiRequest(
        `${API}/queue?date=${encodeURIComponent(date)}`
      );

    renderQueue(
      data,
      myToken
    );
  } catch (error) {
    console.error(
      'Queue error:',
      error
    );
  }
}

function renderQueue(
  data,
  myToken
) {
  const bookings =
    Array.isArray(data.bookings)
      ? data.bookings
      : [];

  const waiting =
    Array.isArray(data.waiting)
      ? data.waiting
      : [];

  const current =
    data.current;

  /*
    العميل الحالي
  */
const currentElements = [
    $('currentQueue'),
    $('currentNumber'),
    $('nowServing'),
    $('currentCustomer')
  ].filter(Boolean);

  currentElements.forEach(
    element => {
      element.textContent =
        current ?? '—';
    }
  );

  /*
    عدد المنتظرين
  */

  const waitingElements = [
    $('waitingCount'),
    $('queueWaitingCount'),
    $('peopleWaiting')
  ].filter(Boolean);

  waitingElements.forEach(
    element => {
      element.textContent =
        waiting.length;
    }
  );

  /*
    دور العميل نفسه
  */

  if (myToken) {
    const mine =
      bookings.find(
        booking =>
          booking.token ===
          myToken
      );

    if (mine) {
      const ahead =
        bookings.filter(
          booking =>
            booking.queue <
              mine.queue &&
            (
              booking.status ===
                'waiting' ||
              booking.status ===
                'serving'
            )
        ).length;

      const ownElements = [
        $('myQueue'),
        $('myQueueNumber'),
        $('myTurn'),
        $('passQueue')
      ].filter(Boolean);

      ownElements.forEach(
        element => {
          element.textContent =
            mine.queue;
        }
      );

      const aheadElements = [
        $('peopleAhead'),
        $('aheadCount'),
        $('queueAhead')
      ].filter(Boolean);

      aheadElements.forEach(
        element => {
          element.textContent =
            Math.max(
              0,
              ahead
            );
        }
      );

      updateBookingStatus(
        mine
      );
    }
  }

  /*
    قائمة الطابور إن كانت موجودة
    في التصميم الحالي.
  */

  const list =
    $('queueList');

  if (list) {
    list.innerHTML = '';

    bookings.forEach(
      booking => {
        const item =
          document.createElement(
            'div'
          );

        item.className =
          'queue-item';

        item.dataset.status =
          booking.status;

        item.innerHTML = `
          <span>${escapeHtml(
            booking.queue
          )}</span>
          <span>${escapeHtml(
            statusArabic(
              booking.status
            )
          )}</span>
        `;

        list.appendChild(
          item
        );
      }
    );
  }
}

/* =========================================================
   تحديث الطابور تلقائيًا
========================================================= */

function startQueueUpdates() {
  stopQueueUpdates();

  if (!currentBooking) {
    return;
  }

  loadQueue(
    currentBooking.date,
    currentBooking.token
  );

  queueTimer =
    setInterval(
      () => {
        if (!currentBooking) {
          return;
        }

        loadQueue(
          currentBooking.date,
          currentBooking.token
        );
      },
      15000
    );
}

function stopQueueUpdates() {
  if (queueTimer) {
    clearInterval(
      queueTimer
    );

    queueTimer = null;
  }
}

/* =========================================================
   صفحة الطابور
========================================================= */

function setupQueuePage() {
  const dateInputs = [
    $('queueDate'),
    $('queueDateInput')
  ].filter(Boolean);

  dateInputs.forEach(
    input => {
      input.min =
        todayCairo();

      if (!input.value) {
        input.value =
          currentBooking?.date ||
          todayCairo();
      }

      input.addEventListener(
        'change',
        () => {
          loadQueue(
            input.value,
            currentBooking?.token
          );
        }
      );
    }
  );

  const date =
    dateInputs[0]?.value ||
    currentBooking?.date ||
    todayCairo();

  loadQueue(
    date,
    currentBooking?.token
  );
}

/* =========================================================
   تحميل QRCode.js
========================================================= */

function loadQRCodeLibrary() {
  return new Promise(
    resolve => {
      if (
        typeof QRCode !==
        'undefined'
      ) {
        resolve(true);
        return;
      }

      const existing =
        document.querySelector(
          'script[data-yf-qrcode]'
        );

      if (existing) {
        existing.addEventListener(
          'load',
          () => resolve(true)
        );

        existing.addEventListener(
          'error',
          () => resolve(false)
        );

        return;
      }

      const script =
        document.createElement(
          'script'
        );

      script.src =
        'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

      script.async = true;

      script.dataset.yfQrcode =
        'true';

      script.onload =
        () => resolve(true);

      script.onerror =
        () => resolve(false);

      document.head.appendChild(
        script
      );
    }
  );
}

/* =========================================================
   Service Worker
========================================================= */

async function registerServiceWorker() {
  if (
    !('serviceWorker' in navigator)
  ) {
    return;
  }

  try {
    await navigator.serviceWorker.register(
      '/sw.js'
    );
  } catch (error) {
    console.warn(
      'Service worker unavailable:',
      error
    );
  }
}

/* =========================================================
   زر الإدارة
========================================================= */

function bindAdminLink() {
  const buttons =
    document.querySelectorAll(
      '[data-admin-link], #adminLink, #adminBtn'
    );

  buttons.forEach(button => {
    button.addEventListener(
      'click',
      event => {
        event.preventDefault();

        window.location.href =
          '/admin';
      }
    );
  });
}

/* =========================================================
   منع الإرسال المكرر
========================================================= */

function preventDoubleSubmit() {
  document.addEventListener(
    'submit',
    event => {
      const form =
        event.target;

      if (
        !form ||
        !form.matches(
          '#bookingForm, #bookForm'
        )
      ) {
        return;
      }

      if (
        form.dataset.submitting ===
        'true'
      ) {
        event.preventDefault();
      }

      form.dataset.submitting =
        'true';

      setTimeout(
        () => {
          form.dataset.submitting =
            'false';
        },
        3000
      );
    },
    true
  );
}

/* =========================================================
   التشغيل
========================================================= */

async function initCustomerApp() {
  try {
    setupDateInputs();

    bindNavigation();

    bindServiceCards();

    bindBookingForm();

    setupQueuePage();

    bindAdminLink();

    preventDoubleSubmit();

    await loadTimes();

    await loadQRCodeLibrary();

    await registerServiceWorker();

    /*
      إذا كان هناك حجز سابق على الجهاز،
      نعيد تحميله تلقائيًا.
    */

    const saved =
      await loadSavedBooking();

    if (saved) {
      renderBookingCard(
        saved
      );

      startQueueUpdates();
    }

    /*
      الصفحة الرئيسية هي الافتراضية
      إذا لم توجد صفحة محددة.
    */

    if (
      !document.querySelector(
        '.active'
      )
    ) {
      navigateTo('home');
    }

  } catch (error) {
    console.error(
      'YF Customer App initialization failed:',
      error
    );
  }
}

/* =========================================================
   DOM Ready
========================================================= */

if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    initCustomerApp
  );
} else {
  initCustomerApp();
      }
