# SAKAY Project Architecture (ARCHITECTURE.md)

This document maps out the monorepo workspace layouts, the directory structure of the client-side apps, and traces each feature folder in the Passenger PWA back to the SAKAY Capstone Paper specifications.

---

## 1. Workspaces Structure (Monorepo)

The repository uses **NPM Workspaces** at the root directory (`C:\SAKAY\client`) to isolate the mobile apps, administrative portals, backend server, and common configuration modules:

```
C:\SAKAY\client/
├── package.json                   # Root package.json defining NPM Workspaces
├── tsconfig.json                  # Root TypeScript configurations
├── ARCHITECTURE.md                # This mapping guide
├── apps/
│   ├── passenger-pwa/             # Passenger PWA (React 19 + Vite + MUI)
│   ├── driver-pwa/                # Driver PWA (React 19 + Vite + MUI)
│   └── admin-portal/              # LGU + TODA Admin Portal (React 19 + Vite + MUI)
├── packages/
│   └── shared/                    # Shared Types & Shared Helper Utilities
└── server/                        # Express API Backend (Node.js + TS)
```

---

## 2. Passenger PWA Module Features Mapping

The features of SAKAY are organized into **5 core modules** matching the Capstone Paper exactly. 

The **Passenger Module** contains the following **8 features** implemented inside `apps/passenger-pwa/src/features/`:

| Folder Path | Feature Name | Capstone Paper Specs Reference | Key Actions & Components |
|---|---|---|---|
| `features/account-management/` | 1.1 Account Management | Section III.C.1.1 (p. 77 / p. 134) | Registration form, SMS OTP verify, profile details, password recovery. |
| `features/ride-booking/` | 1.2 Ride Booking | Section III.C.1.2 (p. 77 / p. 135) | GPS pickup, address search, passenger count, fare estimation. |
| `features/scheduled-booking/` | 1.3 Scheduled Booking | Section III.C.1.3 (p. 77 / p. 136) | Reserve future rides, modify booking, cancel scheduled reservations. |
| `features/ride-sharing/` | 1.4 Ride Sharing | Section III.C.1.4 (p. 77 / p. 136) | Co-passenger pairing (max 2 bookings / max 4 passengers), split fare estimate. |
| `features/trip-monitoring/` | 1.5 Trip Monitoring | Section III.C.1.5 (p. 77 / p. 137) | Near real-time location (5s updates), driver details, progress tracker, ETA. |
| `features/feedback/` | 1.6 Passenger Feedback | Section III.C.1.6 (p. 78 / p. 138) | Post-trip star rating and text comments. |
| `features/incident-reporting/` | 1.7 Incident Reporting | Section III.C.1.7 (p. 78 / p. 139) | Safety reports, category selection, description, photo uploads, review status. |
| `features/trip-history/` | 1.8 Trip History | Section III.C.1.8 (p. 78 / p. 139) | Completed trips listing, digital receipts, quick rebooking. |

---

## 3. Key Configurations

### PWA Asset Cache & Service Worker
The service worker is configured inside [apps/passenger-pwa/vite.config.ts](file:///C:/SAKAY/client/apps/passenger-pwa/vite.config.ts) and [apps/passenger-pwa/public/manifest.json](file:///C:/SAKAY/client/apps/passenger-pwa/public/manifest.json). Per the Capstone Paper limits, **offline booking and offline database synchronization are not supported**. The service worker's role is restricted to:
* Enabling installability to the homescreen (A2HS).
* Pre-caching static assets for faster load times.

### Supabase Client
The singleton typed Supabase client is initialized at [apps/passenger-pwa/src/services/supabaseClient.ts](file:///C:/SAKAY/client/apps/passenger-pwa/src/services/supabaseClient.ts). Environment variables are loaded via:
* `VITE_SUPABASE_URL`
* `VITE_SUPABASE_ANON_KEY`
An `.env.example` has been committed to the passenger app directory for deployment settings.
