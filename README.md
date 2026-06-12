# GitHub PR Enhanced Navigation

A Chrome/Brave browser extension that makes reviewing pull requests on GitHub less frustrating in two ways:

1. **Sticky tab bar** — the PR navigation tabs (Conversation · Commits · Checks · Files changed) stay pinned just below GitHub's own header as you scroll, so you can switch tabs without scrolling back to the top.
2. **Scroll position memory** — when you switch between tabs, your scroll position is saved and restored, so jumping from Files changed back to Conversation returns you to where you left off.

## Installation

This extension is not published to the Chrome Web Store. Load it manually as an unpacked extension:

1. Clone or download this repository.
2. Open Chrome or Brave and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this directory.

The extension activates automatically on any `github.com` pull request page.

## Files

```
manifest.json   — Extension manifest (Manifest V3)
content.js      — All extension logic, injected into GitHub PR pages
```

## How it works

### Sticky tab bar

GitHub's PR tab bar uses `position: relative`, so it scrolls away with the page. `position: sticky` can't fix this because the tab bar's parent element is too short — the actual PR content lives in a sibling element, not a child.

The extension uses `position: fixed` instead: a scroll event listener watches for the moment the tab bar would scroll off the top of the viewport, then switches it to `position: fixed` and inserts a same-height placeholder `<div>` in its place to prevent the page from jumping.

When fixed, the tab bar needs to sit just below GitHub's own sticky PR header (which varies in height between tabs). Finding that header is non-trivial:

- `document.elementsFromPoint` can't detect it because GitHub sets `pointer-events: none` on the sticky header container.
- `querySelectorAll` works regardless of pointer events.
- On the **Files changed** tab the sticky header is an inner `<section>` element (~60px tall); on the **Conversation** tab it's an outer `<div>` with a `stickyHeader` CSS-module class (~70px tall).
- The extension uses a two-pass query: `section/header` first (fast, returns the correct inner element on Files changed), falling back to `[class*="stickyHeader"]` (catches the Conversation tab's `<div>`, with a relaxed top-position threshold because this element may still be animating into place when the nav first becomes fixed).
- Rather than measuring once and locking in the result, the extension re-checks every 100ms while stuck and corrects the offset if it changes. This handles the case where the header hasn't finished transitioning when the first measurement fires.

A 10px hysteresis on the unstick threshold prevents micro-oscillation caused by the placeholder div changing the page height by a small amount.

Dark mode is handled by reading GitHub's `--color-canvas-default` CSS variable via `getComputedStyle` rather than setting it as an inline CSS variable (inline vars don't always resolve correctly).

### Scroll position memory

When you click a tab link in the PR nav, the current `window.scrollY` is saved to `sessionStorage` under a key based on the current `location.pathname`. The same save happens on `turbo:before-visit` (GitHub uses Turbo for SPA navigation) and on `beforeunload`.

When a new tab finishes loading (`turbo:load`), the saved position for that URL is read from `sessionStorage` and restored with a short delay to let the page render first. A guard prevents the restore from fighting with an intentional user scroll.

### Navigation compatibility

GitHub uses Turbo (formerly Turbolinks) for in-page navigation. The extension listens to both `turbo:*` events and legacy `pjax:*` events so it works regardless of which navigation mechanism GitHub uses on a given page. On each navigation the sticky setup is fully torn down and re-initialised, which also correctly handles the tab bar being re-rendered with new DOM nodes.

## License

MIT

## Limitations

- GitHub's HTML structure and CSS class names can change at any time. The extension uses a few class-name substrings (e.g. `stickyHeader`) that could break if GitHub renames their CSS modules.
- Scroll positions are stored in `sessionStorage`, so they are cleared when the browser tab is closed.
- The extension only runs on `github.com`. It will not work on GitHub Enterprise instances at custom domains without editing `manifest.json`.
