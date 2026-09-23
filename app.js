let currentTicket = null;

document.getElementById('booking-form').addEventListener('submit', function(e) {
  e.preventDefault();
  
  const name = document.getElementById('cust-name').value;
  const phone = document.getElementById('cust-phone').value;
  const service = document.getElementById('cust-service').value;
  const date = document.getElementById('cust-date').value;
  const time = document.getElementById('cust-time').value;
  const code = 'YF-' + Math.floor(1000 + Math.random() * 9000);

  currentTicket = { name, phone, service, date, time, code };

  document.getElementById('t-code').innerText = 'رمز الحجز: ' + code;
  document.getElementById('t-name').innerText = 'العميل: ' + name;
  document.getElementById('t-service').innerText = 'الخدمة: ' + service;
  document.getElementById('t-datetime').innerText = 'الموعد: ' + date + ' (' + time + ')';

  const canvas = document.getElementById('t-qr');
  if (typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, code, { width: 130, margin: 1 });
  }

  document.getElementById('ticket-modal').style.display = 'flex';
});

function shareTicket() {
  if (!currentTicket) return;
  const msg = 'صالون يوسف فاروق - YF Barber House\nتم تأكيد حجزك الملكي!\nرمز الحجز: ' + currentTicket.code + '\nالخدمة: ' + currentTicket.service + '\nالموعد: ' + currentTicket.date + ' (' + currentTicket.time + ')';
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }
