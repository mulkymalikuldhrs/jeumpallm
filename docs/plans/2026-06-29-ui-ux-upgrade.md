# UI/UX Upgrade — Responsive + PWA + Assistant-Ready

**Architecture:** Progressive enhancement of existing vanilla JS SPA. Zero new dependencies. CSS overhaul with fluid typography, responsive sidebar, safe area insets. PWA via manifest.json + minimal service worker. Voice input via Web Speech API. Full ARIA throughout.

**Tech Stack:** Vanilla JS, CSS custom properties, Web Speech API, Service Worker API

## Files

### CSS Refactor (style.css)
- Fluid typography via `clamp()` on all sizes
- Responsive sidebar: auto-collapse at 768px, persistent at 1024px+
- Safe area insets for notched devices (`env(safe-area-inset-*)`)
- Touch targets 44px minimum
- Toast notification system styles
- Voice button styles
- Focus-visible ring global
- `prefers-reduced-motion` support
- Theme toggle CSS vars (dark/light via `[data-theme]`)

### HTML (index.html)
- Add theme-color meta, apple-mobile-web-app-capable
- Add manifest.json link
- Add service worker registration script
- Add voice input button alongside send
- Add toast container
- ARIA roles throughout: `role="region"`, `aria-live="polite"`, `aria-label`

### JS (app.js)
- Service worker registration with update handling
- Voice input via SpeechRecognition API
- Toast notification system
- Keyboard shortcut: Cmd+Shift+V for voice
- Focus management on modal open/close
- `aria-live` region for streaming status announcements
- offline/online event handling

### New Files
- `static/manifest.json` — PWA manifest with icons, scope, display
- `static/sw.js` — Service worker: network-first API, cache-first static, offline fallback
- `static/icons/icon-192.svg` — SVG icon for PWA
