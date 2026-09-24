const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const isProduction =
  process.env.VERCEL === '1' ||
  process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname)));


/* =========================================================
   TURSO / LIBSQL
========================================================= */

let tursoClient = null;

try {
  if (process.env.TURSO_DATABASE_URL) {
    const { createClient } = require('@libsql/client');

    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
} catch (err) {
  console.error('Turso init error:', err);
}


/* =========================================================
   FALLBACK MEMORY DATA - LOCAL DEVELOPMENT ONLY
========================================================= */

let memoryBookings = [];

let memoryReviews = [
  {
    id: 'rev-1',
    bookingCode: 'YF-1042',
    customerName: 'أحمد محمود العطار',
    serviceName: 'باقة VIP الملكية المتكاملة',
    rating: 5,
    comment:
      'تجربة ملكية استثنائية! اهتمام الأستاذ يوسف بأدق التفاصيل ودقة تدريج اللحية لا مثيل لها.',
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
  },
];


/* =========================================================
   SERVICES
========================================================= */

const SERVICES = {
  'vip-royal': {
    name: 'باقة VIP الملكية المتكاملة',
    price: 350,
    duration: 60,
  },

  'hair-beard': {
    name: 'باقة يوسف فاروق (شعر + لحية)',
    price: 250,
    duration: 45,
  },

  haircut: {
    name: 'قص وتصفيف شعر كلاسيكي',
    price: 150,
    duration: 30,
  },

  'beard-sculpt': {
    name: 'تحديد ونحت اللحية بالفوطة الساخنة',
    price: 120,
    duration: 25,
  },

  'royal-facial': {
    name: 'جلسة تنظيف بشرة وماسك الذهب',
    price: 180,
    duration: 30,
  },
};


/* =========================================================
   STATUSES
========================================================= */

const VALID_STATUSES = new Set([
  'confirmed',
  'in_chair',
  'completed',
  'cancelled',
]);


/* =========================================================
   DATABASE READY STATE
========================================================= */

let dbReadyPromise = null;


/* =========================================================
   LOCAL DATE
========================================================= */

function localDate() {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}


/* =========================================================
   BOOKING MAPPER
========================================================= */

function mapBooking(row) {
  if (!row) return row;

  return {
    id: row.id,

    bookingCode:
      row.booking_code ??
      row.bookingCode ??
      '',

    customerName:
      row.customer_name ??
      row.customerName ??
      '',

    phone:
      row.phone ??
      '',

    serviceId:
      row.service_id ??
      row.serviceId ??
      '',

    serviceName:
      row.service_name ??
      row.serviceName ??
      '',

    servicePrice:
      Number(
        row.service_price ??
        row.servicePrice ??
        0
      ),

    serviceDuration:
      Number(
        row.service_duration ??
        row.serviceDuration ??
        0
      ),

    barberName:
      row.barber_name ??
      row.barberName ??
      'يوسف فاروق',

    date:
      row.date ??
      '',

    timeSlot:
      row.time_slot ??
      row.timeSlot ??
      '',

    queueNumber:
      Number(
        row.queue_number ??
        row.queueNumber ??
        0
      ),

    status:
      row.status ??
      'confirmed',

    notes:
      row.notes ||
      '',

    createdAt:
      row.created_at ??
      row.createdAt ??
      '',
  };
}


/* =========================================================
   REVIEW MAPPER
========================================================= */

function mapReview(row) {
  if (!row) return row;

  return {
    id: row.id,

    bookingId:
      row.booking_id ??
      row.bookingId ??
      '',

    bookingCode:
      row.booking_code ??
      row.bookingCode ??
      '',

    customerName:
      row.customer_name ??
      row.customerName ??
      '',

    serviceName:
      row.service_name ??
      row.serviceName ??
      '',

    rating:
      Number(row.rating || 0),

    comment:
      row.comment ??
      '',

    date:
      row.date ??
      '',

    createdAt:
      row.created_at ??
      row.createdAt ??
      '',
  };
}


/* =========================================================
   DATABASE INITIALIZATION + SAFE MIGRATION
========================================================= */

async function ensureDatabase() {
  if (dbReadyPromise) {
    return dbReadyPromise;
  }

  dbReadyPromise = (async () => {

    /*
      If Turso isn't configured:
      - local development can use memory
      - production must fail safely
    */

    if (!tursoClient) {
      if (isProduction) {
        throw new Error(
          'Turso database is not configured'
        );
      }

      return;
    }


    /* -------------------------------------------------------
       CREATE BOOKINGS TABLE IF IT DOES NOT EXIST
    ------------------------------------------------------- */

    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        booking_code TEXT UNIQUE,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        service_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        service_price REAL NOT NULL DEFAULT 0,
        service_duration INTEGER NOT NULL DEFAULT 0,
        barber_name TEXT DEFAULT 'يوسف فاروق',
        date TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        queue_number INTEGER NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'confirmed',
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `);


    /* -------------------------------------------------------
       SAFE MIGRATION FOR EXISTING DATABASE
       DOES NOT DELETE EXISTING DATA
    ------------------------------------------------------- */

    const bookingColumns = [
      {
        name: 'booking_code',
        sql: `ALTER TABLE bookings ADD COLUMN booking_code TEXT`,
      },
      {
        name: 'customer_name',
        sql: `ALTER TABLE bookings ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'phone',
        sql: `ALTER TABLE bookings ADD COLUMN phone TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'service_id',
        sql: `ALTER TABLE bookings ADD COLUMN service_id TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'service_name',
        sql: `ALTER TABLE bookings ADD COLUMN service_name TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'service_price',
        sql: `ALTER TABLE bookings ADD COLUMN service_price REAL NOT NULL DEFAULT 0`,
      },
      {
        name: 'service_duration',
        sql: `ALTER TABLE bookings ADD COLUMN service_duration INTEGER NOT NULL DEFAULT 0`,
      },
      {
        name: 'barber_name',
        sql: `ALTER TABLE bookings ADD COLUMN barber_name TEXT DEFAULT 'يوسف فاروق'`,
      },
      {
        name: 'date',
        sql: `ALTER TABLE bookings ADD COLUMN date TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'time_slot',
        sql: `ALTER TABLE bookings ADD COLUMN time_slot TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'queue_number',
        sql: `ALTER TABLE bookings ADD COLUMN queue_number INTEGER NOT NULL DEFAULT 0`,
      },
      {
        name: 'status',
        sql: `ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'confirmed'`,
      },
      {
        name: 'notes',
        sql: `ALTER TABLE bookings ADD COLUMN notes TEXT`,
      },
      {
        name: 'created_at',
        sql: `ALTER TABLE bookings ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`,
      },
    ];


    /*
      Read existing columns.
      This is the important part that fixes the
      "no such column: queue_number" problem.
    */

    const bookingInfo =
      await tursoClient.execute(
        `PRAGMA table_info(bookings)`
      );

    const existingBookingColumns =
      new Set(
        bookingInfo.rows.map(
          row => String(row.name)
        )
      );


    for (const column of bookingColumns) {
      if (!existingBookingColumns.has(column.name)) {
        try {
          await tursoClient.execute(column.sql);

          console.log(
            `Added missing bookings column: ${column.name}`
          );

        } catch (e) {
          const message =
            String(e.message || '').toLowerCase();

          /*
            Ignore duplicate-column errors.
            Everything else is logged.
          */

          if (
            !message.includes('duplicate column')
          ) {
            console.error(
              `Migration error for ${column.name}:`,
              e
            );
          }
        }
      }
    }


    /* -------------------------------------------------------
       RE-READ BOOKINGS COLUMNS
    ------------------------------------------------------- */

    const bookingInfoAfter =
      await tursoClient.execute(
        `PRAGMA table_info(bookings)`
      );

    const finalBookingColumns =
      new Set(
        bookingInfoAfter.rows.map(
          row => String(row.name)
        )
      );


    /*
      If queue_number now exists, make sure old NULL values
      don't break the application.
    */

    if (finalBookingColumns.has('queue_number')) {
      await tursoClient.execute(`
        UPDATE bookings
        SET queue_number = 0
        WHERE queue_number IS NULL
      `);
    }


    /* -------------------------------------------------------
       CREATE REVIEWS TABLE
    ------------------------------------------------------- */

    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        booking_id TEXT,
        booking_code TEXT,
        customer_name TEXT NOT NULL,
        service_name TEXT,
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);


    /* -------------------------------------------------------
       SAFE REVIEW MIGRATION
    ------------------------------------------------------- */

    const reviewColumns = [
      {
        name: 'booking_id',
        sql: `ALTER TABLE reviews ADD COLUMN booking_id TEXT`,
      },
      {
        name: 'booking_code',
        sql: `ALTER TABLE reviews ADD COLUMN booking_code TEXT`,
      },
      {
        name: 'customer_name',
        sql: `ALTER TABLE reviews ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'service_name',
        sql: `ALTER TABLE reviews ADD COLUMN service_name TEXT`,
      },
      {
        name: 'rating',
        sql: `ALTER TABLE reviews ADD COLUMN rating INTEGER NOT NULL DEFAULT 5`,
      },
      {
        name: 'comment',
        sql: `ALTER TABLE reviews ADD COLUMN comment TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'date',
        sql: `ALTER TABLE reviews ADD COLUMN date TEXT NOT NULL DEFAULT ''`,
      },
      {
        name: 'created_at',
        sql: `ALTER TABLE reviews ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`,
      },
    ];


    const reviewInfo =
      await tursoClient.execute(
        `PRAGMA table_info(reviews)`
      );

    const existingReviewColumns =
      new Set(
        reviewInfo.rows.map(
          row => String(row.name)
        )
      );


    for (const column of reviewColumns) {
      if (!existingReviewColumns.has(column.name)) {
        try {
          await tursoClient.execute(column.sql);

          console.log(
            `Added missing reviews column: ${column.name}`
          );

        } catch (e) {
          const message =
            String(e.message || '').toLowerCase();

          if (
            !message.includes('duplicate column')
          ) {
            console.error(
              `Review migration error for ${column.name}:`,
              e
            );
          }
        }
      }
    }

  })();


  try {
    await dbReadyPromise;
  } catch (e) {
    dbReadyPromise = null;
    throw e;
  }

  return dbReadyPromise;
}


/* =========================================================
   DATABASE HELPER
========================================================= */

async function requireDb(res) {
  try {
    await ensureDatabase();
    return true;

  } catch (e) {
    console.error('DB error:', e);

    res.status(503).json({
      success: false,
      error: 'قاعدة البيانات غير متاحة حالياً',
    });

    return false;
  }
}


/* =========================================================
   GET BOOKINGS
========================================================= */

app.get('/api/bookings', async (req, res) => {

  const targetDate =
    String(
      req.query.date ||
      localDate()
    );


  if (tursoClient) {

    if (!(await requireDb(res))) {
      return;
    }

    try {

      const result =
        await tursoClient.execute({
          sql: `
            SELECT *
            FROM bookings
            WHERE date = ?
            ORDER BY
              time_slot ASC,
              queue_number ASC,
              created_at ASC
          `,
          args: [targetDate],
        });


      return res.json({
        success: true,
        bookings:
          result.rows.map(mapBooking),
      });

    } catch (e) {

      console.error(
        'GET bookings error:',
        e
      );

      return res.status(500).json({
        success: false,
        error: 'Database error',
      });
    }
  }


  /* -------------------------------------------------------
     LOCAL DEVELOPMENT FALLBACK
  ------------------------------------------------------- */

  if (isProduction) {

    return res.status(503).json({
      success: false,
      error: 'قاعدة البيانات غير متاحة حالياً',
    });
  }


  return res.json({
    success: true,
    bookings:
      memoryBookings.filter(
        b => b.date === targetDate
      ),
  });
});


/* =========================================================
   CREATE BOOKING
========================================================= */

app.post('/api/bookings', async (req, res) => {

  const {
    customerName,
    phone,
    serviceId,
    date,
    timeSlot,
    notes,
  } = req.body || {};


  if (
    !customerName ||
    !phone ||
    !date ||
    !timeSlot ||
    !serviceId
  ) {

    return res.status(400).json({
      success: false,
      error: 'جميع الحقول مطلوبة',
    });
  }


  const service =
    SERVICES[serviceId];


  if (!service) {

    return res.status(400).json({
      success: false,
      error: 'الخدمة غير صحيحة',
    });
  }


  const cleanName =
    String(customerName).trim();

  const cleanPhone =
    String(phone).trim();

  const cleanDate =
    String(date).trim();

  const cleanTimeSlot =
    String(timeSlot).trim();

  const cleanNotes =
    String(notes || '').trim();


  if (tursoClient) {

    if (!(await requireDb(res))) {
      return;
    }


    /*
      Retry protects against a rare booking-code collision.
    */

    for (let attempt = 0; attempt < 5; attempt++) {

      const id =
        'book-' +
        Date.now() +
        '-' +
        Math.random()
          .toString(36)
          .slice(2, 7);


      const bookingCode =
        'YF-' +
        Math.floor(
          1000 +
          Math.random() * 9000
        );


      const createdAt =
        new Date().toISOString();


      try {

        /*
          Maximum 2 customers per exact date/time.

          Queue:
          first customer = 1
          second customer = 2
        */

        const result =
          await tursoClient.execute({
            sql: `
              INSERT INTO bookings (
                id,
                booking_code,
                customer_name,
                phone,
                service_id,
                service_name,
                service_price,
                service_duration,
                barber_name,
                date,
                time_slot,
                queue_number,
                status,
                notes,
                created_at
              )

              SELECT
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'يوسف فاروق',
                ?,
                ?,
                COALESCE(MAX(queue_number), 0) + 1,
                'confirmed',
                ?,
                ?

              FROM bookings

              WHERE
                date = ?
                AND time_slot = ?
                AND status != 'cancelled'

              HAVING COUNT(*) < 2
            `,

            args: [
              id,
              bookingCode,
              cleanName,
              cleanPhone,
              serviceId,
              service.name,
              service.price,
              service.duration,
              cleanDate,
              cleanTimeSlot,
              cleanNotes,
              createdAt,
              cleanDate,
              cleanTimeSlot,
            ],
          });


        if (!result.rowsAffected) {

          return res.status(409).json({
            success: false,
            error:
              'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)',
          });
        }


        const fresh =
          await tursoClient.execute({
            sql: `
              SELECT *
              FROM bookings
              WHERE id = ?
            `,
            args: [id],
          });


        const booking =
          fresh.rows[0];


        return res.status(201).json({
          success: true,
          booking:
            mapBooking(booking),
        });

      } catch (e) {

        const message =
          String(
            e.message || ''
          ).toLowerCase();


        /*
          Booking code collision:
          try again with another code.
        */

        if (
          message.includes('unique') &&
          message.includes('booking')
        ) {
          continue;
        }


        console.error(
          'Booking insert error:',
          e
        );


        return res.status(500).json({
          success: false,
          error: 'تعذر حفظ الحجز',
        });
      }
    }


    return res.status(500).json({
      success: false,
      error:
        'تعذر إنشاء رمز الحجز، حاول مرة أخرى',
    });
  }


  /* -------------------------------------------------------
     LOCAL DEVELOPMENT FALLBACK
  ------------------------------------------------------- */

  if (isProduction) {

    return res.status(503).json({
      success: false,
      error: 'قاعدة البيانات غير متاحة حالياً',
    });
  }


  const existing =
    memoryBookings.filter(
      b =>
        b.date === cleanDate &&
        b.timeSlot === cleanTimeSlot &&
        b.status !== 'cancelled'
    );


  if (existing.length >= 2) {

    return res.status(409).json({
      success: false,
      error:
        'هذا الموعد مكتمل بالكامل (الحد الأقصى شخصان)',
    });
  }


  const newBooking = {

    id:
      'book-' +
      Date.now(),

    bookingCode:
      'YF-' +
      Math.floor(
        1000 +
        Math.random() * 9000
      ),

    customerName:
      cleanName,

    phone:
      cleanPhone,

    serviceId,

    serviceName:
      service.name,

    servicePrice:
      service.price,

    serviceDuration:
      service.durati
      
    barberName:
      'يوسف فاروق',

    date:
      cleanDate,

    timeSlot:
      cleanTimeSlot,

    queueNumber:
      existing.length + 1,

    status:
      'confirmed',

    notes:
      cleanNotes,

    createdAt:
      new Date().toISOString(),
  };


  memoryBookings.push(
    newBooking
  );


  return res.status(201).json({
    success: true,
    booking: newBooking,
  });
});


/* =========================================================
   UPDATE BOOKING STATUS
========================================================= */

app.patch(
  '/api/bookings/:id/status',
  async (req, res) => {

    const { id } =
      req.params;

    const { status } =
      req.body || {};


    if (!VALID_STATUSES.has(status)) {

      return res.status(400).json({
        success: false,
        error: 'حالة غير صحيحة',
      });
    }


    if (tursoClient) {

      if (!(await requireDb(res))) {
        return;
      }


      try {

        const result =
          await tursoClient.execute({
            sql: `
              UPDATE bookings
              SET status = ?
              WHERE id = ?
            `,
            args: [
              status,
              id,
            ],
          });


        if (!result.rowsAffected) {

          return res.status(404).json({
            success: false,
            error: 'الحجز غير موجود',
          });
        }


        return res.json({
          success: true,
        });

      } catch (e) {

        console.error(
          'Status update error:',
          e
        );

        return res.status(500).json({
          success: false,
          error:
            'تعذر تحديث الحالة',
        });
      }
    }


    if (isProduction) {

      return res.status(503).json({
        success: false,
        error:
          'قاعدة البيانات غير متاحة حالياً',
      });
    }


    const booking =
      memoryBookings.find(
        b => b.id === id
      );


    if (!booking) {

      return res.status(404).json({
        success: false,
        error:
          'الحجز غير موجود',
      });
    }


    booking.status =
      status;


    return res.json({
      success: true,
    });
  }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  '/api/admin/login',
  (req, res) => {

    const pin =
      String(
        req.body?.pin || ''
      );


    const correctPin =
      String(
        process.env.ADMIN_PIN || ''
      );


    if (!correctPin) {

      return res.status(503).json({
        success: false,
        error:
          'تسجيل دخول الإدارة غير مُعدّ بعد',
      });
    }


    if (pin !== correctPin) {

      return res.status(401).json({
        success: false,
        error:
          'رمز المرور غير صحيح',
      });
    }


    return res.json({
      success: true,
    });
  }
);


/* =========================================================
   GET REVIEWS
========================================================= */

app.get(
  '/api/reviews',
  async (req, res) => {

    if (tursoClient) {

      if (!(await requireDb(res))) {
        return;
      }


      try {

        const result =
          await tursoClient.execute(`
            SELECT *
            FROM reviews
            ORDER BY created_at DESC
          `);


        return res.json({
          success: true,
          reviews:
            result.rows.map(mapReview),
        });

      } catch (e) {

        console.error(
          'Reviews GET error:',
          e
        );

        return res.status(500).json({
          success: false,
          error:
            'تعذر تحميل التقييمات',
        });
      }
    }


    if (isProduction) {

      return res.status(503).json({
        success: false,
        error:
          'قاعدة البيانات غير متاحة حالياً',
      });
    }


    return res.json({
      success: true,
      reviews:
        memoryReviews,
    });
  }
);


/* =========================================================
   VERIFY REVIEW ELIGIBILITY
========================================================= */

app.post(
  '/api/reviews/verify',
  async (req, res) => {

    const q =
      String(
        req.body?.codeOrPhone || ''
      )
        .trim()
        .toLowerCase();


    if (!q) {

      return res.status(400).json({
        success: false,
        eligible: false,
        message:
          'أدخل رمز الحجز أو رقم الهاتف',
      });
    }


    let found = [];


    if (tursoClient) {

      if (!(await requireDb(res))) {
        return;
      }


      try {

        const result =
          await tursoClient.execute({
            sql: `
              SELECT *
              FROM bookings
              WHERE
                LOWER(booking_code) = ?
                OR phone = ?
            `,
            args: [
              q,
              q,
            ],
          });


        found =
          result.rows.map(
            mapBooking
          );

      } catch (e) {

        console.error(
          'Review verify error:',
          e
        );

        return res.status(500).json({
          success: false,
          eligible: false,
          message:
            'تعذر التحقق حالياً',
        });
      }

    } else if (!isProduction) {

      found =
        memoryBookings.filter(
          b =>
            String(
              b.bookingCode || ''
            )
              .toLowerCase() === q ||

            String(
              b.phone || ''
            ) === q
        );
    }


    const completed =
      found.find(
        b =>
          b.status ===
          'completed'
      );


    if (completed) {

      return res.json({
        success: true,
        eligible: true,
        booking:
          completed,
      });
    }


    return res.json({
      success: false,
      eligible: false,
      message:
        'لم يتم العثور على حجز مكتمل بهذا الرمز',
    });
  }
);


/* =========================================================
   CREATE REVIEW
========================================================= */

app.post(
  '/api/reviews',
  async (req, res) => {

    const {
      bookingId,
      rating,
      comment,
    } = req.body || {};


    const cleanComment =
      String(
        comment || ''
      ).trim();


    const numericRating =
      Number(rating);


    if (
      !bookingId ||
      !cleanComment ||
      numericRating < 1 ||
      numericRating > 5
    ) {

      return res.status(400).json({
        success: false,
        error:
          'بيانات التقييم غير مكتملة',
      });
    }


    let booking = null;


    if (tursoClient) {

      if (!(await requireDb(res))) {
        return;
      }


      try {

        const result =
          await tursoClient.execute({
            sql: `
              SELECT *
              FROM bookings
              WHERE id = ?
            `,
            args: [
              bookingId,
            ],
          });


        booking =
          mapBooking(
            result.rows[0]
          );

      } catch (e) {

        console.error(
          'Review booking lookup error:',
          e
        );

        return res.status(500).json({
          success: false,
          error:
            'تعذر التحقق من الحجز',
        });
      }

    } else if (!isProduction) {

      booking =
        memoryBookings.find(
          b =>
            b.id ===
            bookingId
        );
    }


    /*
      Only completed bookings can review.
    */

    if (
      !booking ||
      booking.status !==
        'completed'
    ) {

      return res.status(403).json({
        success: false,
        error:
          'يمكن تقييم الحجوزات المكتملة فقط',
      });
    }


    const newReview = {

      id:
        'rev-' +
        Date.now(),

      bookingId:
        booking.id,

      bookingCode:
        booking.bookingCode,

      customerName:
        booking.customerName,

      serviceName:
        booking.serviceName,

      rating:
        numericRating,

      comment:
        cleanComment,

      date:
        localDate(),

      createdAt:
        new Date().toISOString(),
    };


    if (tursoClient) {

      try {

        /*
          Prevent duplicate review
          for the same booking.
        */

        const duplicate =
          await tursoClient.execute({
            sql: `
              SELECT id
              FROM reviews
              WHERE booking_id = ?
              LIMIT 1
            `,
            args: [
              booking.id,
            ],
          });


        if (duplicate.rows.length) {

          return res.status(409).json({
            success: false,
            error:
              'تم إرسال تقييم لهذا الحجز مسبقاً',
          });
        }


        await tursoClient.execute({
          sql: `
            INSERT INTO reviews (
              id,
              booking_id,
              booking_code,
              customer_name,
              service_name,
              rating,
              comment,
              date,
              created_at
            )

            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?
            )
          `,

          args: [
            newReview.id,
            newReview.bookingId,
            newReview.bookingCode,
            newReview.customerName,
            newReview.serviceName,
            newReview.rating,
            newReview.comment,
            newReview.date,
            newReview.createdAt,
          ],
        });

      } catch (e) {

        console.error(
          'Review insert error:',
          e
        );

        return res.status(500).json({
          success: false,
          error:
            'تعذر حفظ التقييم',
        });
      }

    } else {

      memoryReviews.unshift(
        newReview
      );
    }


    return res.status(201).json({
      success: true,
      review:
        newReview,
    });
  }
);


/* =========================================================
   ADMIN PAGE
========================================================= */

app.get(
  '/admin',
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'admin.html'
      )
    );
  }
);


/* =========================================================
   LOCAL SERVER
========================================================= */

if (!isProduction) {

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `Server running on http://localhost:${PORT}`
      );
    }
  );
}


/* =========================================================
   EXPORT FOR VERCEL
========================================================= */

module.exports = app;
