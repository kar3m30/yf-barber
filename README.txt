YF Barber v2

Files:
- index.html
- server.js
- package.json
- sw.js

Vercel/Turso environment variables required:
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
Optional:
ADMIN_TOKEN_SECRET

Admin login:
Username: karemadmin
Password: 011963

Booking rule:
Maximum 2 active bookings for the same date + same time. The server enforces it and the database has a unique slot index.
