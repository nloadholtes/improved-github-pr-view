(function () {
  'use strict';

  // ── Scroll position memory ──────────────────────────────────────────────────

  const KEY_PREFIX = 'gh_pr_scroll:';

  function scrollKey() {
    return KEY_PREFIX + location.pathname;
  }

  function saveScroll() {
    if (window.scrollY > 0) {
      sessionStorage.setItem(scrollKey(), window.scrollY);
    }
  }

  function restoreScroll() {
    const saved = sessionStorage.getItem(scrollKey());
    if (!saved) return;
    const y = parseInt(saved, 10);
    if (y <= 0) return;

    setTimeout(() => window.scrollTo(0, y), 80);

    let userScrolled = false;
    const guard = () => { userScrolled = true; };
    window.addEventListener('scroll', guard, { passive: true, once: true });
    setTimeout(() => {
      window.removeEventListener('scroll', guard);
      if (!userScrolled && Math.abs(window.scrollY - y) > 150) {
        window.scrollTo(0, y);
      }
    }, 700);
  }

  // ── Nav detection ───────────────────────────────────────────────────────────

  function findPRTabNav() {
    // Primary selector (unauthenticated/SSR GitHub HTML)
    const byAria = document.querySelector('nav[aria-label="Pull request tabs"]');
    if (byAria) return byAria;

    // Fallback 1: the CSS class GitHub uses for the PR tab row
    const byClass = document.querySelector('nav.tabnav-tabs');
    if (byClass) return byClass;

    // Fallback 2: find any nav containing a link that matches our PR URL base
    const prBase = location.pathname.replace(/\/(files|commits|checks|changes)\/?$/, '');
    for (const nav of document.querySelectorAll('nav')) {
      const hasMatchingLink = [...nav.querySelectorAll('a[href]')]
        .some(a => a.getAttribute('href') === prBase ||
                   a.getAttribute('href').startsWith(prBase + '/'));
      if (hasMatchingLink) return nav;
    }

    return null;
  }

  // ── Sticky tab bar ─────────────────────────────────────────────────────────

  let activeCleanup = null;

  function teardownSticky() {
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
  }

  // Find the bottom edge of GitHub's sticky PR header.
  // elementsFromPoint cannot be used — GitHub sets pointer-events:none on the
  // sticky header container so it's invisible to hit-testing.  querySelectorAll
  // finds it regardless.
  //
  // Two-pass strategy:
  //  1. <section> / <header> — fast; picks the inner PullRequestFilesToolbar
  //     <section> on Files Changed (bot≈60) rather than its outer prc-PageHeader
  //     <div> container (bot≈130).  Strict r.top≤10 because these are always
  //     flush with the viewport top when sticky.
  //  2. [class*="stickyHeader"] fallback — for the Conversation tab whose header
  //     is a <div>.  Uses a relaxed r.top threshold because this element may still
  //     be sliding toward the top when our nav first becomes fixed.
  function liveHeaderBottom(excludeEl) {
    let maxBottom = 0;
    const vw = window.innerWidth;

    for (const el of document.querySelectorAll('section, header, [role="banner"]')) {
      if (el === excludeEl) continue;
      const r = el.getBoundingClientRect();
      if (r.top >= 0 && r.top <= 10
          && r.bottom - r.top >= 10
          && r.bottom > maxBottom
          && r.width > vw * 0.3) {
        maxBottom = r.bottom;
      }
    }

    if (maxBottom === 0) {
      const topCap = window.innerHeight * 0.2;
      for (const el of document.querySelectorAll('[class*="stickyHeader"]')) {
        if (el === excludeEl) continue;
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.top <= topCap
            && r.bottom - r.top >= 10
            && r.bottom > maxBottom
            && r.width > vw * 0.3) {
          maxBottom = r.bottom;
        }
      }
    }

    return maxBottom;
  }

  function getPageBackground() {
    // Read GitHub's actual canvas color so dark mode works correctly.
    // CSS vars in style.cssText don't always resolve, so we use getComputedStyle.
    const css = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-canvas-default').trim();
    if (css) return css;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)') ? bodyBg : '#ffffff';
  }

  function setupStickyTabs() {
    const nav = findPRTabNav();
    if (!nav || nav.dataset.prStickySetup) return;

    const rect = nav.getBoundingClientRect();
    if (rect.width === 0) { requestAnimationFrame(setupStickyTabs); return; }

    nav.dataset.prStickySetup = 'true';

    const navNaturalTop = rect.top + window.scrollY;
    const navHeight     = rect.height;

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `height: ${navHeight}px; display: none;`;
    nav.parentNode.insertBefore(placeholder, nav);

    let stuck = false;
    let lastSync = 0;

    function stick(topPx) {
      stuck = true;
      placeholder.style.display = 'block';
      const bg = getPageBackground();
      nav.style.cssText = [
        'position: fixed',
        `top: ${topPx}px`,
        'left: 0',
        'right: 0',
        'width: auto',
        'z-index: 200',
        `background-color: ${bg}`,
        'box-shadow: 0 1px 0 var(--color-border-default, #d0d7de)',
      ].join('; ') + ';';
    }

    function unstick() {
      stuck = false;
      lastSync = 0;
      placeholder.style.display = 'none';
      nav.style.cssText = '';
    }

    function onScroll() {
      const sy = window.scrollY;
      if (sy >= navNaturalTop && !stuck) {
        stick(liveHeaderBottom(nav));
      } else if (sy < navNaturalTop - 10 && stuck) {
        // 10px hysteresis prevents micro-oscillation when the placeholder
        // changes page height by a small amount
        unstick();
      } else if (stuck) {
        // Throttled re-check: the sticky header may not be at its final position
        // when we first stick (still transitioning), so we keep correcting until
        // the measured value stabilises.  100ms cap avoids per-frame work.
        const now = Date.now();
        if (now - lastSync >= 100) {
          lastSync = now;
          const h = liveHeaderBottom(nav);
          if (h > 0) {
            const cur = parseFloat(nav.style.top) || 0;
            if (Math.abs(h - cur) > 1) nav.style.top = h + 'px';
          }
        }
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    let resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        unstick();
        placeholder.remove();
        delete nav.dataset.prStickySetup;
        setupStickyTabs();
      }, 200);
    }
    window.addEventListener('resize', onResize);

    activeCleanup = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      unstick();
      if (placeholder.parentNode) placeholder.remove();
      delete nav.dataset.prStickySetup;
    };

    onScroll();
  }

  function watchForNav() {
    teardownSticky();

    const nav = findPRTabNav();
    if (nav && !nav.dataset.prStickySetup) { requestAnimationFrame(setupStickyTabs); return; }
    if (nav) return;

    const observer = new MutationObserver(() => {
      const found = findPRTabNav();
      if (found && !found.dataset.prStickySetup) {
        observer.disconnect();
        requestAnimationFrame(setupStickyTabs);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 8000);
  }

  // ── Save scroll before navigating ──────────────────────────────────────────

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link && e.target.closest('nav')) saveScroll();
  }, true);

  window.addEventListener('beforeunload', saveScroll);

  document.addEventListener('turbo:before-visit', saveScroll);
  document.addEventListener('turbo:load', () => { watchForNav(); restoreScroll(); });

  document.addEventListener('pjax:send', saveScroll);
  document.addEventListener('pjax:end', () => { watchForNav(); restoreScroll(); });

  // ── Initial page load ──────────────────────────────────────────────────────
  watchForNav();
  restoreScroll();

})();
