# SAKAY Client - Development Guide (AGENTS.md)

This document outlines the project architecture, tech stack, coding standards, and guidelines for the SAKAY client application. All development teams and future AI assistants must read and adhere to these guidelines to ensure consistency, quality, and maintainability across the codebase.

---

## Project Overview
- **Purpose of the Project**: SAKAY is a ride-hailing and logistics application tailored for localized transport, specifically focusing on tricycles. The client-side application provides a seamless, mobile-first experience for passengers to book rides, view tricycle details, choose accounts, login, and register.
- **Current Development Status**: The project is in the initial bootstrapping phase. Folder structures are defined, basic assets (logos, tricycle images, background screens) are loaded, and the entry point is configured with a basic, unstyled Splash page. Key components and route handlers are stubbed out and ready for clean UI implementation.
- **Main Features**:
  - Language selection (Tagalog/English)
  - Splash screen with stylized animations
  - Account selection (e.g., Driver, Passenger)
  - User registration and authentication (Login)
  - Interactive maps and ride-booking interfaces (future scopes)

---

## Directory Structure
The project follows a scalable, feature-based architecture. Files and directories must follow this progressive organization structure:

- **`.git/`**: Git repository metadata.
- **`dist/`**: Production build output (generated after running `npm run build`).
- **`public/`**: Static assets that are served directly as-is (e.g., `favicon.ico`, static icons).
- **`src/`**: Core source code directory.
  - **`assets/`**: Uncompiled assets such as fonts, icons, and images.
    - **`fonts/`**: Project-specific custom font files.
    - **`images/`**: Core UI images (e.g., logo, tricycle, backgrounds).
    - **`icons/`**: Standard SVG/image icons.
  - **`components/`**: Reusable presentation components grouped by domain:
    - **`common/`**: Universal components (e.g., `PrimaryButton.tsx`, `Logo.tsx`, `LanguageSelector.tsx`).
    - **`forms/`**: Input components and field groups.
    - **`navigation/`**: Menu bars, tab navigations, headers.
    - **`cards/`**: Flexible presentation containers.
    - **`feedback/`**: Snackbars, dialogs, progress bars.
  - **`features/`**: Feature-specific modules containing pages, hooks, state, or sub-components:
    - **`auth/`**: Registration, Login, AccountSelection flows.
    - **`passenger/`**: Passenger-specific portals.
    - **`driver/`**: Driver-specific ride handling portals.
    - **`toda/`**: TODA administration screens.
    - **`lgu/`**: Local Government Unit tracking portals.
    - **`admin/`**: High-level platform administration.
  - **`layouts/`**: Shared route layouts (e.g., authenticated panels).
  - **`routes/`**: Route definition files and route configurations.
  - **`services/`**: API wrappers and client-side database/auth service adapters (e.g., Firebase).
  - **`hooks/`**: Shared custom stateful hooks.
  - **`styles/`**: Centralized style files:
    - **`variables.css`**: Defines design tokens and CSS theme variables.
    - **`globals.css`**: Standard baseline reset rules and HTML element defaults.
    - **`animations.css`**: Global transitions and `@keyframes` animations.
    - **`responsive.css`**: Defines the simulator frame size rules and mobile viewport overrides.
    - **`utilities.css`**: Helper utility classes (e.g., scrollbar-hiding).
  - **`types/`**: Common TypeScript type declarations and interface definitions.
  - **`utils/`**: Utility helper functions (e.g., formatters, validators).
  - **`App.tsx`**: Main component that mounts the application and routes.
  - **`main.tsx`**: Entry file that bootstraps React, imports CSS reset, and renders the DOM root.
  - **`index.css`**: Single entry stylesheet importing the centralized CSS files.

---

## Tech Stack
The project is built on the following technologies:

- **React (v19)**: Component-based UI library.
- **TypeScript**: Typed superset of JavaScript for compiler-enforced safety.
- **Vite**: Ultra-fast build tool and development server.
- **Material UI (MUI v9) & Emotion**: Components and styling library for highly accessible, consistent UI components.
- **React Router (v7)**: Client-side routing solution.
- **CSS**: Centralized custom sheets for global layouts, simulator overlays, and keyframes.
- **Git**: Version control system.
- **Fonts**: `@fontsource/poppins` for typography.

---

## Styling Architecture & Conventions
- **Prefer Material UI**: Use Material UI layout (`Box`, `Container`, `Stack`) and display components (`Typography`, `Chip`, `Button`, `IconButton`) styled using the inline `sx` property.
- **Avoid Per-Component CSS**: Do not create one CSS file per component or page. All component styling should be implemented using the MUI system or reference global classes.
- **Centralized CSS Only**: Custom CSS is restricted to the centralized files in `src/styles/` (`variables.css`, `globals.css`, `animations.css`, `responsive.css`, `utilities.css`).
- **CSS Responsibilities**:
  - Global styles
  - Theme variables
  - Responsive rules
  - Animations
  - Background images
  - Utility helper classes (e.g., `.hide-scrollbar`)

---

## Coding Standards

### Naming Conventions
- **Files & Folders**: 
  - Folders containing components must use **PascalCase** (e.g., `LanguageSelector`) or feature-folders in **camelCase** (e.g., `auth`).
  - React component files must match their folder name using **PascalCase** and `.tsx` extension (e.g., `LanguageSelector.tsx`).
  - Utility and service files must use **camelCase** (e.g., `authService.ts`).
- **Variables & Functions**:
  - React components: **PascalCase** function declarations.
  - Variables, hooks, and helper functions: **camelCase** (e.g., `const [isActive, setIsActive] = useState(false)`).
  - Constants: **UPPER_SNAKE_CASE** (e.g., `const API_BASE_URL = '...'`).

### Component Structure
- Use standard functional components with hooks.
- Use explicit TypeScript typing for props and state.
- Component order:
  1. Imports (React/External libraries first, internal components second, assets/styles last).
  2. Interface/Type definitions for props.
  3. Component function definition.
  4. Internal states/Hooks.
  5. Helper sub-functions (if applicable).
  6. Return JSX block.
  7. Export statement.

### Import Ordering
To keep files readable, structure your imports as follows:
1. React and third-party libraries (e.g., `react`, `@mui/material`).
2. Reusable UI components (e.g., `import PrimaryButton from '../../components/common/PrimaryButton'`).
3. Services and Utils (e.g., `import { fetchUser } from '../../services/api'`).
4. Assets and Images (e.g., `import logo from '../../assets/images/logo.png'`).
5. Styles (e.g., `import './Splash.css'`).

### TypeScript Conventions
- Explicitly type props using `interface` or `type`.
- Avoid the use of `any`. If a type is unknown or dynamic, use `unknown` or specify generic parameters.
- Enable and respect strict mode compiler rules.
- Type-only imports must be formatted using `import type { ... }` when verbatim module syntax is active.

---

## Component Architecture

### Reusable Components
- Reusable UI elements go into `src/components/` and are grouped into sub-folders like `common/`, `forms/`, `navigation/`, etc.
- These components should be stateless where possible or capture only their internal visual state, receiving callbacks and values via props.

### Page Components
- Views representing full screens go into `src/pages/` (or `src/features/*/pages/`).
- Pages compose reusable components and manage page-level state, fetching API data and triggering routes.

---

## Build & Development Commands
- **`npm install`**: Installs project dependencies.
- **`npm run dev`**: Starts the Vite local development server with hot-reloading.
- **`npm run build`**: Compiles TypeScript and packages application assets into `dist/` using Vite.
- **`npm run preview`**: Runs a local server to preview the built application in `dist/`.
- **Git workflow**:
  - Always create feature branches from `main` or the active dev branch.
  - Commit messages should be structured and descriptive (e.g., `feat: implement language selector using MUI icons`).
  - Push changes and open PRs for code reviews.

---

## Common Development Workflow

### Creating a New Page
1. Create a subfolder inside `src/pages/` or under the respective feature block (e.g., `src/features/auth/pages/`).
2. Add the React component file (e.g., `ForgotPassword.tsx`). Do not add a CSS file unless it requires complex, unique custom styles.
3. Style the page layout using MUI components (`Box`, `Typography`, etc.) and standard `sx` properties.
4. Export the component.
5. Register the new route in the app routing framework (e.g., `App.tsx` or `src/routes`).

### Creating a Reusable Component
1. Create or choose a subfolder under `src/components/` (e.g., `src/components/common/`).
2. Add the `.tsx` component file.
3. Design the component to be flexible by passing configuration parameters and styling attributes through props, styling it using MUI properties.
4. Export the component.

### Importing Assets
- Import images and icons relative to the file:
  `import tricycleImg from '../../assets/images/tricycle.png';`
- Use the imported variable inside elements:
  `<Box component="img" src={tricycleImg} alt="Tricycle" />`

---

## UI/UX Guidelines
- **Mobile-First Design**: The interface is optimized specifically for mobile screens. The primary layout targets a **430×932 viewport** (standard mobile simulator size).
- **Responsive Layout**: Layouts should stretch elegantly for smaller or slightly larger screens while centering the mobile shell on desktop configurations to preserve the layout's proportions.
- **Match Figma Closely**: Follow visual design dimensions, font sizes, colors, margins, and alignments precisely.
- **Consistent Styles**: Maintain Poppins font typography, color palettes, and component sizing (e.g., button heights, card border radii).
- **Material UI Usage**: Use `@mui/material` components (like `Box`, `Typography`, `CircularProgress`, `IconButton`) where appropriate to ensure accessibility and consistent interactions.
- **Custom CSS Rules**: Use custom CSS files only for global rules, animations, variables, or the simulator overlay wrapper.
- **DRY Principle**: Avoid copy-pasting layouts. Wrap repeating items in modular UI components.

---

## Rules for Future AI Sessions
1. **Never rewrite the project architecture** without permission. Keep folder organization intact.
2. **Never replace existing components** unless requested or refactoring for matching specifications.
3. **Never delete folders or files** unless explicitly instructed.
4. **Preserve naming conventions**: Always use PascalCase for components and camelCase for logic/features.
5. **Reuse existing components** (like `PrimaryButton`, `Logo`, `LanguageSelector`) instead of recreating them inline.
6. **Keep components modular** and maintainable: split large JSX render structures into smaller functions or helper sub-components.
7. **Keep App.tsx minimal**: Do not load complex page-specific structures inside `App.tsx`. Delegate to routing and dedicated page files.
8. **Keep business logic separate from UI**: Use hooks or custom utility functions to separate authentication, fetching, or validations from UI view structures.
9. **Maintain a clean folder structure**: Do not add files randomly in the root of `src/`. Place them in the appropriate directory.
10. **Do not introduce unnecessary dependencies**: Stick to existing dependencies (`react-router-dom`, `@mui/material`, etc.) unless a specific feature requires a new library.

---

## Things That Must Never Be Changed Without Permission
- **Folder structure**: The layout of `src/components/`, `src/features/`, `src/routes/`, `src/services/`, `src/styles/`, `src/types/`, and `src/utils/`.
- **Routing architecture**: The route configuration system using React Router.
- **Tech stack**: React, Vite, TS, MUI, Emotion, React Router.
- **Build configuration**: `vite.config.ts`, `tsconfig.json`, `package.json` scripts.
- **Existing assets**: Core images (`sakay-logo.png`, `splash-bg.png`, `tricycle.png`) and files under `src/assets/`.
- **Naming conventions**: PascalCase components and style matching.
- **Git configuration**: `.gitignore`, project level workflows.
