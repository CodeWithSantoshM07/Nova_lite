# NovaBank – Banking and ATM Management System
Landing page + customer dashboard + ATM simulator + admin dashboard, backed by MySQL.

## Run (Windows)
1. Make sure MySQL is running. Open `start.bat` in Notepad and set `DB_PASS` to your MySQL root password (file default: 1234).
2. Double-click `start.bat`. The browser opens http://localhost:8080. The database `bank_db` and demo data are created automatically on first run.
- Customer: demo@bank.com / Demo@123 (card 4000000000000002, PIN 1234) | Admin: admin@bank.com / Admin@123

## Features
- Customer: overview + charts, deposit/withdraw/transfer, transactions (filter, CSV export, print), saved payees, loans with EMI calculator, ATM simulator, profile (change password/PIN)
- Admin: analytics dashboard (2 charts), customer search, freeze accounts, unlock ATM cards, loan approvals (credits the account), audit log, ATM cash refill, **Reset demo data**
- Payments (GPay/Paytm style): UPI ID per customer (name@novabank), pay by UPI ID or account with PIN, request money (accept/decline), personal QR code, bills & recharge with 1% cashback, insights & rewards; admin Payments view with bill and cashback totals
- Sample data: 12 customers, ~30 days of transactions, loans, payees, audit entries (loaded automatically on first run; `seed.js`)
- Accessibility: skip link, labelled forms, keyboard navigation, screen-reader labels, text size A-/A+, high-contrast and light themes, reduced-motion support

## Structure
- `seed.js` – sample data generator
- `server.js` – REST API + all banking logic (Node.js + mysql2). `runtime\node.exe` is a bundled Node (not needed if Node is installed).
- `frontend/index.html` – whole UI (single page app)
- `database/schema.sql` – MySQL schema + demo data
- `cpp-backend/` – C++ (Crow) version of the same API, to finish later. Identical endpoints, so the frontend works with either backend.

## API
POST /api/register, /api/login | GET /api/summary, /api/transactions | POST /api/deposit, /api/withdraw, /api/transfer, /api/atm/withdraw | Admin: GET /api/admin/stats, /customers, /transactions, /loans, /audit; POST /api/admin/status, /refill, /loan, /unlock, /reset-demo. Payments: POST /api/upi/pay, /api/requests, /api/requests/respond, /api/bills; GET /api/requests; Admin GET /api/admin/payments. Customer extras: /api/beneficiaries, /api/loans, /api/profile/password, /api/profile/pin
