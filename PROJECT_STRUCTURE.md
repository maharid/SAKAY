# SAKAY Client Project Structure (PROJECT_STRUCTURE.md)

This document provides a comprehensive overview of the current folder and file structure of the SAKAY client repository located at [C:/SAKAY/client](file:///C:/SAKAY/client). It lists the full folder tree, describes the purpose of each directory, details the role of every file currently in the project, and flags any inconsistencies or structural cleanup needs.

---

## 1. Directory Tree (Recursive Listing)

Below is the recursive folder and file structure of the SAKAY repository (excluding `node_modules`, `.git`, and build outputs):

```
C:\SAKAY\client/
├── .gitignore
├── AGENTS.md
├── ARCHITECTURE.md
├── package-lock.json
├── package.json
├── README.md
├── supabase_schema.sql
├── apps/
│   ├── admin-portal/
│   │   └── package.json
│   ├── driver-pwa/
│   │   └── package.json
│   └── passenger-pwa/
│       ├── .env.example
│       ├── eslint.config.js
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.app.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       ├── vite.config.ts
│       ├── public/
│       │   ├── favicon.svg
│       │   ├── icons.svg
│       │   ├── manifest.webmanifest
│       │   └── icons/
│       │       ├── icon-192.png
│       │       ├── icon-512-maskable.png
│       │       └── icon-512.png
│       └── src/
│           ├── App.tsx
│           ├── index.css
│           ├── main.tsx
│           ├── vite-env.d.ts
│           ├── common/
│           │   └── components/
│           │       ├── LanguageSelector.tsx
│           │       ├── Logo.tsx
│           │       ├── PrimaryButton.tsx
│           │       └── SuccessModal.tsx
│           ├── features/
│           │   ├── account-management/
│           │   │   └── components/
│           │   │       ├── AccountSelection/
│           │   │       │   └── AccountSelection.tsx
│           │   │       ├── ForgotPassword/
│           │   │       │   └── ForgotPassword.tsx
│           │   │       ├── Login/
│           │   │       │   └── Login.tsx
│           │   │       ├── ProfileEditor/
│           │   │       │   └── ProfileEditor.tsx
│           │   │       ├── Register/
│           │   │       │   └── Register.tsx
│           │   │       ├── RegistrationSuccess/
│           │   │       │   └── RegistrationSuccess.tsx
│           │   │       ├── ResetPassword/
│           │   │       │   └── ResetPassword.tsx
│           │   │       ├── Splash/
│           │   │       │   └── Splash.tsx
│           │   │       └── VerifyOtp/
│           │   │           └── VerifyOtp.tsx
│           │   ├── feedback/ (empty)
│           │   ├── incident-reporting/ (empty)
│           │   ├── ride-booking/
│           │   │   └── components/
│           │   │       └── Dashboard/
│           │   │           └── Dashboard.tsx
│           │   ├── ride-sharing/ (empty)
│           │   ├── scheduled-booking/ (empty)
│           │   ├── trip-history/ (empty)
│           │   └── trip-monitoring/ (empty)
│           ├── services/
│           │   └── supabaseClient.ts
│           ├── styles/
│           │   ├── animations.css
│           │   ├── globals.css
│           │   ├── responsive.css
│           │   ├── theme.ts
│           │   ├── utilities.css
│           │   └── variables.css
│           └── utils/
│               ├── LanguageContext.tsx
│               └── phone.ts
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── assets/
│           │   ├── icons/
│           │   │   └── app-icon.png
│           │   └── images/
│           │       ├── logo-text-black.png
│           │       ├── logo-text-orange.png
│           │       ├── logo-text-white.png
│           │       └── splash-bg.png
│           ├── components/
│           │   └── OnboardingIllustrations.tsx
│           └── types/
│               └── database.ts
├── reference/
│   ├── app_icon.png
│   ├── AUTH LOGIN.png
│   ├── AUTH SIGNUP.png
│   ├── BOOK - SOLO.png
│   ├── BOOK.png
│   ├── DRIVER MATCHED.png
│   ├── FAILED.png
│   ├── logo_text_black.png
│   ├── logo_text_white.png
│   ├── main_logo.png
│   ├── PASSENGER AUTH SIGNUP (1).png
│   ├── PASSENGER AUTH SIGNUP (2).png
│   ├── PASSENGER AUTH SIGNUP (3).png
│   ├── PASSENGER AUTH SIGNUP.png
│   ├── PASSENGER HISTORY.png
│   ├── PASSENGER HOME.png
│   ├── PASSENGER LOCATION PERMISSION.png
│   ├── PASSENGER NEW TRIP.png
│   ├── PASSENGER RATE.png
│   ├── RIDE SHARE - DRIVER OTW.png
│   ├── SET PLACE-1.png
│   ├── SOLO - DRIVER OTW-1.png
│   ├── SOLO - DRIVER OTW.png
│   ├── SPLASH SCREEN (1).png
│   ├── SPLASH SCREEN (2).png
│   ├── SPLASH SCREEN (3).png
│   ├── SPLASH SCREEN (4).png
│   ├── SPLASH SCREEN.png
│   └── TIER 1 - SOLO.png
├── server/
│   ├── package.json
│   └── tsconfig.json
└── supabase/
    ├── .gitignore
    ├── config.toml
    └── migrations/
        └── 20260717123236_init_schema.sql
```

---

## 2. Directory Summaries

Here is the purpose and structural scope of each directory in the monorepo:

*   **[C:/SAKAY/client](file:///C:/SAKAY/client)** (Root Directory): Central workspace repository enclosing workspaces for web PWAs, packages, Node server APIs, database schema, and reference documents.
*   **[apps/](file:///C:/SAKAY/client/apps)**: Contains the client-facing UI applications. All web apps are built with React 19, Vite, and Material UI.
*   **[apps/admin-portal/](file:///C:/SAKAY/client/apps/admin-portal)**: Intended space for the administrative application servicing Local Government Units (LGU) and TODA managers. (Currently scaffolded).
*   **[apps/driver-pwa/](file:///C:/SAKAY/client/apps/driver-pwa)**: Intended workspace for the Driver PWA to accept ride requests and manage trips. (Currently scaffolded).
*   **[apps/passenger-pwa/](file:///C:/SAKAY/client/apps/passenger-pwa)**: Core active PWA codebase for passengers to sign up, select accounts, log in, verify OTPs, and book tricycle rides.
*   **[apps/passenger-pwa/public/](file:///C:/SAKAY/client/apps/passenger-pwa/public)**: Holds static asset files and the PWA webmanifest that are served directly as-is to the browser client.
*   **[apps/passenger-pwa/public/icons/](file:///C:/SAKAY/client/apps/passenger-pwa/public/icons)**: Directory specifically containing PNG icons at various resolutions required by the browser to render high-DPI PWA launcher graphics.
*   **[apps/passenger-pwa/src/](file:///C:/SAKAY/client/apps/passenger-pwa/src)**: Main React application development folder, housing entry points, styles, routes, configurations, components, and pages.
*   **[apps/passenger-pwa/src/common/components/](file:///C:/SAKAY/client/apps/passenger-pwa/src/common/components)**: Contains generic UI elements that do not contain business logic and are reused across several app modules (e.g. customized buttons, generic success popups).
*   **[apps/passenger-pwa/src/features/](file:///C:/SAKAY/client/apps/passenger-pwa/src/features)**: Subdivided module folder where components, pages, and hooks are grouped by feature domain matching the system specifications (e.g. account management, bookings).
*   **[apps/passenger-pwa/src/features/account-management/](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management)**: Sub-module containing the components for the guest onboarding flow, user signup, login, password recovery, and passenger profiles.
*   **[apps/passenger-pwa/src/features/ride-booking/](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/ride-booking)**: Sub-module for immediate tricycle bookings, address searches, and ride dashboard controls.
*   **[apps/passenger-pwa/src/services/](file:///C:/SAKAY/client/apps/passenger-pwa/src/services)**: Wraps external client initializations and database API hooks (currently Supabase only).
*   **[apps/passenger-pwa/src/styles/](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles)**: Core design system container housing MUI JavaScript configuration themes and centralized CSS styling scripts.
*   **[apps/passenger-pwa/src/utils/](file:///C:/SAKAY/client/apps/passenger-pwa/src/utils)**: Storage for global React Contexts (e.g., translations) and standalone helper scripts.
*   **[packages/](file:///C:/SAKAY/client/packages)**: Shared monorepo packages containing shared configurations, assets, components, or utilities.
*   **[packages/shared/](file:///C:/SAKAY/client/packages/shared)**: Modular library holding typescript models, asset files, and React illustrations shared between client PWAs and backend workspaces.
*   **[packages/shared/src/assets/](file:///C:/SAKAY/client/packages/shared/src/assets)**: Unified asset library containing common icons and logos used across multiple workspace PWAs.
*   **[packages/shared/src/components/](file:///C:/SAKAY/client/packages/shared/src/components)**: Repository for reusable UI presentations that are common to multiple application targets.
*   **[packages/shared/src/types/](file:///C:/SAKAY/client/packages/shared/src/types)**: Contains typescript type definitions mirroring database schemas or API contracts.
*   **[reference/](file:///C:/SAKAY/client/reference)**: Contains static UI design layouts, user flow diagrams, mock screenshots, and branding reference imagery.
*   **[server/](file:///C:/SAKAY/client/server)**: Monorepo folder allocated for the Node.js Express server to handle business logic API requests. (Currently scaffolded).
*   **[supabase/](file:///C:/SAKAY/client/supabase)**: Root directory for the Supabase Local CLI configuration, database setup, and database migrations.
*   **[supabase/migrations/](file:///C:/SAKAY/client/supabase/migrations)**: Directory containing SQL schema definition files processed locally and applied in chronological order to the PostgreSQL database.

---

## 3. Individual File Roles

### Root Files
*   **[.gitignore](file:///C:/SAKAY/client/.gitignore)**: Directs Git to ignore environment-specific logs, build targets, lock files, and the local `node_modules` folders.
*   **[AGENTS.md](file:///C:/SAKAY/client/AGENTS.md)**: AI agent companion instructions documenting styling rules, file structures, coding patterns, and guidelines to ensure code quality during development.
*   **[ARCHITECTURE.md](file:///C:/SAKAY/client/ARCHITECTURE.md)**: Describes the overall monorepo structure, lists client module mappings to Capstone specifications, and documents local environment setups.
*   **[package-lock.json](file:///C:/SAKAY/client/package-lock.json)**: Locks package versions to ensure consistent local installations of dependencies across developer environments.
*   **[package.json](file:///C:/SAKAY/client/package.json)**: Root manifest defining npm workspaces (`apps/*`, `packages/*`, `server`) and globally exposed workspace orchestration scripts.
*   **[README.md](file:///C:/SAKAY/client/README.md)**: Standard project documentation describing Vite and TypeScript setups and ESLint configurations.
*   **[supabase_schema.sql](file:///C:/SAKAY/client/supabase_schema.sql)**: An standalone SQL script initialized to model the entire PostgreSQL schema matching Capstone specifications (Duplicate of initial migration).

### apps/admin-portal/
*   **[package.json](file:///C:/SAKAY/client/apps/admin-portal/package.json)**: Manifest declaring dependencies, configuration scripts, and target workspace metadata for the LGU and TODA Admin app.

### apps/driver-pwa/
*   **[package.json](file:///C:/SAKAY/client/apps/driver-pwa/package.json)**: Manifest declaring dependencies, configuration scripts, and target workspace metadata for the Driver PWA app.

### apps/passenger-pwa/
*   **[.env.example](file:///C:/SAKAY/client/apps/passenger-pwa/.env.example)**: Reference environmental settings file defining target variables needed for Supabase database access.
*   **[eslint.config.js](file:///C:/SAKAY/client/apps/passenger-pwa/eslint.config.js)**: Configures global style syntax checking and lint rules for TypeScript files and React components inside the passenger workspace.
*   **[index.html](file:///C:/SAKAY/client/apps/passenger-pwa/index.html)**: The container webpage mounting the compiled SPA bundle and declaring metadata tags.
*   **[package.json](file:///C:/SAKAY/client/apps/passenger-pwa/package.json)**: Defines React 19, MUI, React Router v7, and plugin dependencies, along with development, testing, and production compilation commands.
*   **[tsconfig.app.json](file:///C:/SAKAY/client/apps/passenger-pwa/tsconfig.app.json)**: Application TypeScript configurations setting up target browser modules and compiler properties.
*   **[tsconfig.json](file:///C:/SAKAY/client/apps/passenger-pwa/tsconfig.json)**: Primary reference TypeScript config importing both application and node compilation profiles.
*   **[tsconfig.node.json](file:///C:/SAKAY/client/apps/passenger-pwa/tsconfig.node.json)**: Configures Node compiler options specifically for build configurations like Vite setup scripts.
*   **[vite.config.ts](file:///C:/SAKAY/client/apps/passenger-pwa/vite.config.ts)**: Configures Vite's server, bundle optimizations, React plugins, and VitePWA PWA settings (caching assets, service workers, and application manifests).

#### apps/passenger-pwa/public/
*   **[favicon.svg](file:///C:/SAKAY/client/apps/passenger-pwa/public/favicon.svg)**: Vector format browser tab illustration representing the SAKAY icon.
*   **[icons.svg](file:///C:/SAKAY/client/apps/passenger-pwa/public/icons.svg)**: A centralized sprite sheet wrapping various inline SVG symbols referenced within application buttons and tabs.
*   **[manifest.webmanifest](file:///C:/SAKAY/client/apps/passenger-pwa/public/manifest.webmanifest)**: JSON file configuring OS integrations, splash screen colors, standalone browser layouts, and icons for PWA installation.
*   **[icons/icon-192.png](file:///C:/SAKAY/client/apps/passenger-pwa/public/icons/icon-192.png)**: Standard 192x192 PNG icon used by mobile operating systems as the home launcher icon.
*   **[icons/icon-512-maskable.png](file:///C:/SAKAY/client/apps/passenger-pwa/public/icons/icon-512-maskable.png)**: 512x512 adaptable PNG icon supporting custom shape outlines (circles, rounded rects) on Android launchers.
*   **[icons/icon-512.png](file:///C:/SAKAY/client/apps/passenger-pwa/public/icons/icon-512.png)**: Large 512x512 PNG application launcher icon.

#### apps/passenger-pwa/src/
*   **[App.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/App.tsx)**: Root React component importing styles, wrapping themes/translations context, and rendering the path router mapping URL hashes to feature components.
*   **[index.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/index.css)**: Entry style loader aggregating specific styles (variables, globals, layouts, responsive mock, custom utilities) in order.
*   **[main.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/main.tsx)**: Core React runtime bootstrapper linking `<App />` to the DOM `root` element and starting PWA auto-update service workers.
*   **[vite-env.d.ts](file:///C:/SAKAY/client/apps/passenger-pwa/src/vite-env.d.ts)**: Declares custom TypeScript types for Vite assets (e.g. assets importing, custom environments VITE_*).
*   **[common/components/LanguageSelector.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/common/components/LanguageSelector.tsx)**: Stylized rounded glassmorphic switch component to change the application language between Tagalog and English.
*   **[common/components/Logo.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/common/components/Logo.tsx)**: Utility image component displaying the corporate SAKAY/PASADA logo with color parameters (white, orange, black).
*   **[common/components/PrimaryButton.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/common/components/PrimaryButton.tsx)**: Stylized custom button wrapping MUI's contained buttons with custom orange gradients, hover dropshadows, and loading spin states.
*   **[common/components/SuccessModal.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/common/components/SuccessModal.tsx)**: UI popup component showing action successes with check animations (reused for login/registration alerts).
*   **[features/account-management/components/AccountSelection/AccountSelection.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/AccountSelection/AccountSelection.tsx)**: Card selection interface prompting guest users to declare if they are registering as a Passenger or Driver.
*   **[features/account-management/components/ForgotPassword/ForgotPassword.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/ForgotPassword/ForgotPassword.tsx)**: Text field layout component that takes an email/phone number to trigger password resets.
*   **[features/account-management/components/Login/Login.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/Login/Login.tsx)**: Login page layout capturing credentials (email/number + password) and running standard database authentication.
*   **[features/account-management/components/ProfileEditor/ProfileEditor.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/ProfileEditor/ProfileEditor.tsx)**: Forms screen component enabling active passenger users to modify names, birthdays, addresses, and save updates.
*   **[features/account-management/components/Register/Register.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/Register/Register.tsx)**: Multi-field form component capturing details to create passenger/driver accounts.
*   **[features/account-management/components/RegistrationSuccess/RegistrationSuccess.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/RegistrationSuccess/RegistrationSuccess.tsx)**: Dynamic page shown after account registration finishes, redirecting users to the application homepage.
*   **[features/account-management/components/ResetPassword/ResetPassword.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/ResetPassword/ResetPassword.tsx)**: Input screen prompting user password overwrites during account recovery flows.
*   **[features/account-management/components/Splash/Splash.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/Splash/Splash.tsx)**: Boot screen triggering logo fade reveals and sliding tricycle animations before pushing users to account selectors.
*   **[features/account-management/components/VerifyOtp/VerifyOtp.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/account-management/components/VerifyOtp/VerifyOtp.tsx)**: Verification box UI to capture mobile OTP tokens (sends requests to verify registration authenticity).
*   **[features/ride-booking/components/Dashboard/Dashboard.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/features/ride-booking/components/Dashboard/Dashboard.tsx)**: Core passenger homepage showing address mock inputs and immediate tricycle booking controls.
*   **[services/supabaseClient.ts](file:///C:/SAKAY/client/apps/passenger-pwa/src/services/supabaseClient.ts)**: Configures the client connecting to local or remote Supabase PostgreSQL databases and authentication servers.
*   **[styles/animations.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/animations.css)**: Centralized keyframe sets defining slide, fade, scale, float, and splash reveal transitions.
*   **[styles/globals.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/globals.css)**: Implements base layout resets and imports standard Poppins font styling.
*   **[styles/responsive.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/responsive.css)**: Implements the 412x892 Android mobile device simulator layout (centered screen with device border, camera punch-hole, and bottom gesture bar) on desktop browsers.
*   **[styles/theme.ts](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/theme.ts)**: Exports custom Material UI themes defining design tokens for borders, typography, inputs, and button variations.
*   **[styles/utilities.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/utilities.css)**: CSS class declarations defining display properties like layout widths and scrollbar suppression.
*   **[styles/variables.css](file:///C:/SAKAY/client/apps/passenger-pwa/src/styles/variables.css)**: Root custom style dictionary mapping sizes, radii, and brand colors to CSS variables.
*   **[utils/LanguageContext.tsx](file:///C:/SAKAY/client/apps/passenger-pwa/src/utils/LanguageContext.tsx)**: Context framework containing Tagalog & English translation lookups and state selectors used across screens.
*   **[utils/phone.ts](file:///C:/SAKAY/client/apps/passenger-pwa/src/utils/phone.ts)**: Formatter formatting standard mobile input numbers to match clean E.164 patterns (`+63...`).

### packages/shared/
*   **[package.json](file:///C:/SAKAY/client/packages/shared/package.json)**: Identifies the package metadata and dependencies for `@sakay/shared`.
*   **[tsconfig.json](file:///C:/SAKAY/client/packages/shared/tsconfig.json)**: Defines TypeScript compilation parameters configured for shared packages.

#### packages/shared/src/
*   **[index.ts](file:///C:/SAKAY/client/packages/shared/src/index.ts)**: Main exports registry resolving shared assets, illustrations, and database type models.
*   **[assets/icons/app-icon.png](file:///C:/SAKAY/client/packages/shared/src/assets/icons/app-icon.png)**: Main round application logo brand icon.
*   **[assets/images/logo-text-black.png](file:///C:/SAKAY/client/packages/shared/src/assets/images/logo-text-black.png)**: Brand name text logo in black styling.
*   **[assets/images/logo-text-orange.png](file:///C:/SAKAY/client/packages/shared/src/assets/images/logo-text-orange.png)**: Brand name text logo in orange styling.
*   **[assets/images/logo-text-white.png](file:///C:/SAKAY/client/packages/shared/src/assets/images/logo-text-white.png)**: Brand name text logo in white styling.
*   **[assets/images/splash-bg.png](file:///C:/SAKAY/client/packages/shared/src/assets/images/splash-bg.png)**: Stylized background graphic used during client splash launch animations.
*   **[components/OnboardingIllustrations.tsx](file:///C:/SAKAY/client/packages/shared/src/components/OnboardingIllustrations.tsx)**: React definitions exporting SVG graphics representing Booking, Fare, and Safety features.
*   **[types/database.ts](file:///C:/SAKAY/client/packages/shared/src/types/database.ts)**: Shared interfaces detailing the structure of database tables (`Toda`, `Passenger`, `Driver`, `Booking`).

### reference/
*   **Design PNG screenshots**: Images detailing Figma layout guides for logins, maps, safety shields, match states, onboarding screens, and pricing.

### server/
*   **[package.json](file:///C:/SAKAY/client/server/package.json)**: Scaffolding configuration defining Express, TypeScript, and server dependencies.
*   **[tsconfig.json](file:///C:/SAKAY/client/server/tsconfig.json)**: TypeScript compilation properties set up for backend Node environments.

### supabase/
*   **[.gitignore](file:///C:/SAKAY/client/supabase/.gitignore)**: Local ignore configurations preventing temporary Docker/CLI configs from being tracked in source code.
*   **[config.toml](file:///C:/SAKAY/client/supabase/config.toml)**: System settings configuration mapping Auth rules, Ports, APIs, and CLI options.
*   **[migrations/20260717123236_init_schema.sql](file:///C:/SAKAY/client/supabase/migrations/20260717123236_init_schema.sql)**: Primary database setup script containing initialization scripts (tables, indexes, RLS, functions).

---

## 5. Inconsistencies and Structural Concerns

The following structural items are flagged for review and cleanup before major development proceeds:

1.  **Duplicate Schema Files**: 
    *   `supabase_schema.sql` at the root of the project is a duplicate of the initial Supabase migration script located at `supabase/migrations/20260717123236_init_schema.sql`. Keeping both can lead to outdated documentation or schema mismatches.
    *   *Recommendation*: Keep the migration script inside the `supabase/` folder and remove the root SQL file.

2.  **Scaffolded/Empty Monorepo Workspaces**:
    *   `apps/admin-portal/` and `apps/driver-pwa/` contain only basic `package.json` configurations. There are no project files, source codes, or build configurations.
    *   `server/` contains only `package.json` and `tsconfig.json` without any backend API source code (`src/` folder or scripts).
    *   *Recommendation*: Since these are in the bootstrapping phase, they can remain as-is, but developer templates should eventually be initialized here (e.g. using Vite templates matching the passenger PWA).

3.  **Empty Feature Folders in Passenger PWA**:
    *   The features folder contains six empty directories: `feedback`, `incident-reporting`, `ride-sharing`, `scheduled-booking`, `trip-history`, and `trip-monitoring`. They contain no files.
    *   *Recommendation*: Keep these directories as they match the Capstone specifications mapped in `ARCHITECTURE.md`. As development reaches these milestones, place placeholder components (like dummy view shells) to keep routing intact.

4.  **Naming & Branding Discrepancy (SAKAY vs. PASADA)**:
    *   The project, monorepo configuration, packages, folder structures, and developer documentation consistently refer to the application as **SAKAY**.
    *   However, the UI translations (`LanguageContext.tsx`) and components (`Logo.tsx`, `LanguageSelector.tsx`) reference the name **PASADA** (e.g., *"Paano mo gustong gamitin ang PASADA?"*, *"PASADA Logo"*).
    *   *Recommendation*: Clarify whether the application brand is SAKAY or PASADA and make sure the naming is applied consistently in both code files and user-facing text.

5.  **Asset File Naming Inconsistencies**:
    *   The screenshots inside `reference/` are mixed-case and contain spaces (e.g. `PASSENGER AUTH SIGNUP (1).png`, `SET PLACE-1.png`).
    *   *Recommendation*: Standardize asset filenames to lowercase kebab-case (e.g., `passenger-auth-signup-1.png`).

6.  **Color Design Token Duplication**:
    *   Color variables (like `#FF6B00`, `#1F1F1F`) are declared in global CSS properties in `variables.css` (`--primary-color`, etc.) and duplicated in the TypeScript config for the MUI theme in `theme.ts` (`primary.main: '#FF6B00'`).
    *   *Recommendation*: Import the CSS variables directly in JavaScript/TypeScript using standard CSS variable access (`var(--primary-color)`) or let MUI themes dynamically inject custom properties into CSS to enforce a single source of truth.
