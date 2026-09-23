// YF Barber House - Client App Script
const SERVICES = [
  { id: 'vip-royal', name: 'باقة VIP الملكية المتكاملة', price: 350, duration: 60, icon: '👑' },
  { id: 'hair-beard', name: 'باقة يوسف فاروق (شعر + لحية)', price: 250, duration: 45, icon: '✂' },
  { id: 'haircut', name: 'قص وتصفيف شعر كلاسيكي', price: 150, duration: 30, icon: '💈' },
  { id: 'beard-sculpt', name: 'تحديد ونحت اللحية بالفوطة الساخنة', price: 120, duration: 25, icon: '🪒' },
  { id: 'royal-facial', name: 'جلسة تنظيف بشرة وماسك الذهب', price: 180, duration: 30, icon: '✨' },
];

let selectedService = null;
let selectedSlot = null;
let currentBooking = null;

document.addEventListener('DOMContentLoaded', () => {
  renderServices();
  setupDateInput();
  setupFormEvents();
  initReviewsSection();
});

function renderServices() {
  const container = document.getElementById('services-options');
  if (!container) return;
  container.innerHTML = '';

  SERVICES.forEach((srv) => {
    const card = document.createElement('div');
    card.className = 'service-card-choice';
    card.innerHTML = `
      <div>
        <span class="srv-name">${srv.icon} ${srv.name}</span>
        <span class="srv-duration">${srv.duration} دقيقة</span>
      </div>
      <span class="srv-price">${srv.price} ج.م</span>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.service-card-choice').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedService = srv;
      document.getElementById('selected-service-id').value = srv.id;
      if (document.getElementById('booking-date').value) {
        loadSlotsForDate(document.getElementById('booking-date').value);
      }
    });
    container.appendChild(card);
  });
}

function setupDateInput() {
  const dateInput = document.getElementById('booking-date');
  if (!dateInput) return;
  const today = new Date().toISOString().split('T')[0];
  dateInput.value = today;
  dateInput.min = today;
  dateInput.addEventListener('change', (e) => {
    loadSlotsForDate(e.target.value);
  });
  loadSlotsForDate(today);
}

function generateTimeSlots() {
  const slots = [];
  // 12:00 PM to 01:00 AM
  for (let h = 12; h <= 24; h++) {
    const isNextDay = h === 24;
    const hour12 = isNextDay ? 12 : (h > 12 ? h - 12 : h);
    const period = (h >= 12 && h < 24) ? 'م' : 'ص';
    slots.push(`${hour12}:00 ${period}`);
    if (!isNextDay) {
      slots.push(`${hour12}:30 ${period}`);
    }
  }
  slots.push('01:00 ص');
  return slots;
}

async function loadSlotsForDate(date) {
  const container = document.getElementById('slots-container');
  if (!container) return;
  container.innerHTML = '<span class="placeholder-text">جاري تحميل المواعيد...</span>';

  const allSlots = generateTimeSlots();

  try {
    const res = await fetch(`/api/bookings?date=${date}`);
    const data = await res.json();
    const bookings = data.success ? data.bookings : [];

    const slotCounts = {};
    bookings.forEach(b => {
      if (b.status !== 'cancelled') {
        slotCounts[b.timeSlot] = (slotCounts[b.timeSlot] || 0) + 1;
      }
    });

    container.innerHTML = '';
    allSlots.forEach(timeStr => {
      const bookedCount = slotCounts[timeStr] || 0;
      const isFull = bookedCount >= 2;

      const btn = document.createElement('div');
      btn.className = `slot-btn ${isFull ? 'disabled' : ''}`;
      btn.innerHTML = `
        <span>${timeStr}</span>
        <span class="slot-seats">${isFull ? 'مكتمل' : (bookedCount === 1 ? 'مقعد 1 متاح' : 'شاغر')}</span>
      `;

      if (!isFull) {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selectedSlot = timeStr;
          document.getElementById('selected-time-slot').value = timeStr;
        });
      }
      container.appendChild(btn);
    });
  } catch (err) {
    container.innerHTML = '';
    allSlots.forEach(timeStr => {
      const btn = document.createElement('div');
      btn.className = 'slot-btn';
      btn.innerText = timeStr;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSlot = timeStr;
        document.getElementById('selected-time-slot').value = timeStr;
      });
      container.appendChild(btn);
    });
  }
}

function setupFormEvents() {
  const form = document.getElementById('booking-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedService) {
      alert('يرجى اختيار إحدى باقات الحلاقة أولاً');
      return;
    }
    if (!selectedSlot) {
      alert('يرجى اختيار الموعد المناسب');
      return;
    }

    const custName = document.getElementById('cust-name').value.trim();
    const custPhone = document.getElementById('cust-phone').value.trim();
    const bookingDate = document.getElementById('booking-date').value;
    const notes = document.getElementById('booking-notes').value.trim();

    const submitBtn = document.getElementById('btn-submit-booking');
    submitBtn.disabled = true;
    submitBtn.innerText = 'جاري تأكيد حجزك الملكي...';

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: custName,
          phone: custPhone,
          serviceId: selectedService.id,
          serviceName: selectedService.name,
          servicePrice: selectedService.price,
          serviceDuration: selectedService.duration,
          date: bookingDate,
          timeSlot: selectedSlot,
          notes,
        }),
      });

      const data = await res.json();
      if (data.success && data.booking) {
        currentBooking = data.booking;
        showTicketModal(data.booking);
        if (typeof confetti === 'function') {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
      } else {
        alert(data.error || 'عذراً، هذا الموعد أصبح مكتملاً، يرجى اختيار موعد آخر.');
        loadSlotsForDate(bookingDate);
      }
    } catch (err) {
      alert('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'تأكيد الحجز والحصول على التذكرة الملكية 🎟️';
    }
  });

  document.getElementById('btn-close-ticket')?.addEventListener('click', () => {
    document.getElementById('ticket-modal')?.classList.add('hidden');
  });

  document.getElementById('btn-share-whatsapp')?.addEventListener('click', () => {
    if (!currentBooking) return;
    const text = `تم تأكيد حجز صالون يوسف فاروق!\nرمز الحجز: ${currentBooking.bookingCode}\nالموعد: ${currentBooking.timeSlot} (${currentBooking.date})\nرقم الدور: #${currentBooking.queueNumber}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });
}

function showTicketModal(booking) {
  document.getElementById('t-code').innerText = booking.bookingCode;
  document.getElementById('t-queue').innerText = '#' + booking.queueNumber;
  document.getElementById('t-name').innerText = booking.customerName;
  document.getElementById('t-service').innerText = booking.serviceName;
  document.getElementById('t-price-duration').innerText = `${booking.servicePrice} ج.م (${booking.serviceDuration} دقيقة)`;
  document.getElementById('t-datetime').innerText = `${booking.date} | ${booking.timeSlot}`;

  const canvas = document.getElementById('ticket-qr-canvas');
  if (canvas && typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, booking.bookingCode, { width: 140, margin: 1 });
  }

  document.getElementById('ticket-modal')?.classList.remove('hidden');
}

// -------------------------------------------------------------
// Reviews Logic
// -------------------------------------------------------------
let reviewsList = [];
let currentReviewIdx = 0;
let carouselTimer = null;
let selectedStarRating = 5;
let verifiedBookingData = null;

async function initReviewsSection() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  await loadReviewsData();
  setupCarouselControls();
  setupReviewForm();
}

async function loadReviewsData() {
  try {
    const res = await fetch('/api/reviews');
    const data = await res.json();
    if (data.success && Array.isArray(data.reviews) && data.reviews.length > 0) {
      reviewsList = data.reviews;
    } else {
      reviewsList = getDefaultReviews();
    }
  } catch (e) {
    reviewsList = getDefaultReviews();
  }
  renderReviewSlide(currentReviewIdx);
  renderCarouselDots();
  startCarouselAutoPlay();
}

function getDefaultReviews() {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      id: 'rev-1',
      customerName: 'أحمد محمود العطار',
      serviceName: 'باقة VIP الملكية المتكاملة',
      rating: 5,
      comment: 'تجربة ملكية استثنائية! اهتمام الأستاذ يوسف بأدق التفاصيل ودقة تدريج اللحية لا مثيل لها.',
      date: today,
    },
    {
      id: 'rev-2',
      customerName: 'د. مصطفى الشناوي',
      serviceName: 'تحديد ونحت لحية ملكي بالفوطة الساخنة',
      rating: 5,
      comment: 'أفضل صالون حلاقة دون منازع. الالتزام بالموعد بالدقيقة والفوط الساخنة مريحة للغاية.',
      date: today,
    },
  ];
}

function renderReviewSlide(idx) {
  const track = document.getElementById('carousel-track');
  if (!track || reviewsList.length === 0) return;
  const rev = reviewsList[idx];
  const starsHtml = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);

  track.innerHTML = `
    <div class="review-slide">
      <div class="review-stars">
        <span>${starsHtml}</span>
        <span class="review-tag">✓ خدمة مكتملة وموثقة</span>
      </div>
      <p class="review-quote">"${rev.comment}"</p>
      <div class="review-author">
        <div>
          <span class="author-name">${rev.customerName}</span>
          <span class="author-service">✂ ${rev.serviceName}</span>
        </div>
        <span class="review-date">${rev.date}</span>
      </div>
    </div>
  `;
  renderCarouselDots();
}

function renderCarouselDots() {
  const dotsContainer = document.getElementById('carousel-dots');
  if (!dotsContainer) return;
  dotsContainer.innerHTML = '';
  reviewsList.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `dot ${idx === currentReviewIdx ? 'active' : ''}`;
    dot.addEventListener('click', () => {
      stopCarouselAutoPlay();
      currentReviewIdx = idx;
      renderReviewSlide(currentReviewIdx);
      startCarouselAutoPlay();
    });
    dotsContainer.appendChild(dot);
  });
}

function setupCarouselControls() {
  document.getElementById('btn-next-review')?.addEventListener('click', () => {
    stopCarouselAutoPlay();
    currentReviewIdx = (currentReviewIdx + 1) % reviewsList.length;
    renderReviewSlide(currentReviewIdx);
    startCarouselAutoPlay();
  });
  document.getElementById('btn-prev-review')?.addEventListener('click', () => {
    stopCarouselAutoPlay();
    currentReviewIdx = (currentReviewIdx - 1 + reviewsList.length) % reviewsList.length;
    renderReviewSlide(currentReviewIdx);
    startCarouselAutoPlay();
  });
}

function startCarouselAutoPlay() {
  stopCarouselAutoPlay();
  if (reviewsList.length <= 1) return;
  carouselTimer = setInterval(() => {
    currentReviewIdx = (currentReviewIdx + 1) % reviewsList.length;
    renderReviewSlide(currentReviewIdx);
  }, 5000);
}

function stopCarouselAutoPlay() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function setupReviewForm() {
  const btnVerify = document.getElementById('btn-verify-booking');
  const inputVerify = document.getElementById('verify-booking-input');
  const verifyMsg = document.getElementById('verify-msg');
  const reviewForm = document.getElementById('review-form');

  if (btnVerify && inputVerify) {
    btnVerify.addEventListener('click', async () => {
      const codeOrPhone = inputVerify.value.trim();
      if (!codeOrPhone) return;

      btnVerify.disabled = true;
      btnVerify.innerText = 'جاري التحقق...';

      try {
        const res = await fetch('/api/reviews/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codeOrPhone }),
        });
        const data = await res.json();

        if (data.success && data.eligible && data.booking) {
          verifiedBookingData = data.booking;
          document.getElementById('verified-customer-name').innerText = data.booking.customerName;
          document.getElementById('verified-service-name').innerText = data.booking.serviceName;
          reviewForm?.classList.remove('hidden');
          document.getElementById('verify-step')?.classList.add('hidden');
        } else {
          verifyMsg.innerText = data.message || 'لم نتمكن من العثور على حجز مكتمل بهذا الرمز';
          verifyMsg.className = 'verify-msg error';
          verifyMsg.classList.remove('hidden');
        }
      } catch (e) {
        verifyMsg.innerText = 'تعذر التحقق حالياً';
        verifyMsg.className = 'verify-msg error';
        verifyMsg.classList.remove('hidden');
      } finally {
        btnVerify.disabled = false;
        btnVerify.innerText = 'تحقق من الخدمة';
      }
    });
  }

  const stars = document.querySelectorAll('#star-rating .star');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      selectedStarRating = Number(star.getAttribute('data-val'));
      stars.forEach(s => {
        s.classList.toggle('active', Number(s.getAttribute('data-val')) <= selectedStarRating);
      });
    });
  });

  reviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!verifiedBookingData) return;
    const comment = document.getElementById('review-comment').value.trim();
    if (!comment) return;

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: verifiedBookingData.id,
          bookingCode: verifiedBookingData.bookingCode,
          customerName: verifiedBookingData.customerName,
          serviceName: verifiedBookingData.serviceName,
          rating: selectedStarRating,
          comment,
        }),
      });
      const data = await res.json();
      if (data.success && data.review) {
        reviewForm.classList.add('hidden');
        document.getElementById('review-success-msg')?.classList.remove('hidden');
        reviewsList.unshift(data.review);
        currentReviewIdx = 0;
        renderReviewSlide(0);
      }
    } catch (e) {
      alert('تعذر إرسال التقييم');
    }
  });
}