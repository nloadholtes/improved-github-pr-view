(function () {
  'use strict';

  const KEY_PREFIX = 'gh_pr_scroll:';
  function scrollKey() { return KEY_PREFIX + location.pathname; }

  function saveScroll() {
    if (window.scrollY > 0) sessionStorage.setItem(scrollKey(), window.scrollY);
  }

  function restoreScroll() {
    const saved = sessionStorage.getItem(scrollKey());
    if (!saved) return;
    const y = parseInt(saved, 10);
    setTimeout(() => window.scrollTo(0, y), 80);
    let userScrolled = false;
    const guard = () => { userScrolled = true; };
    window.addEventListener('scroll', guard, { passive: true, once: true });
    setTimeout(() => {
      window.removeEventListener('scroll', guard);
      if (!userScrolled && Math.abs(window.scrollY - y) > 150) window.scrollTo(0, y);
    }, 700);
  }

  function findPRTabNav() {
    const byAria = document.querySelector('nav[aria-label="Pull request tabs"]');
    if (byAria) return byAria;
    const byClass = document.querySelector('nav.tabnav-tabs');
    if (byClass) return byClass;
    const prBase = location.pathname.replace(/\/(files|commits|checks|changes)\/?$/, '');
    const prBaseSlash = prBase + '/';
    for (const nav of document.querySelectorAll('nav')) {
      for (const a of nav.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (href === prBase || href.startsWith(prBaseSlash)) return nav;
      }
    }
    return null;
  }

  let activeCleanup = null;

  function teardownSticky() {
    if (activeCleanup) { activeCleanup(); activeCleanup = null; }
  }

  // Find the bottom edge of GitHub's sticky PR header.
  // elementsFromPoint cannot be used — GitHub sets pointer-events:none on the sticky
  // header container so it's invisible to hit-testing; querySelectorAll finds it regardless.
  //
  // Two-pass strategy (order matters):
  //  1. section/header — picks the inner PullRequestFilesToolbar section on Files Changed
  //     (bot≈60) rather than its outer prc-PageHeader container (bot≈130).
  //     Strict r.top≤10 because these are flush with the viewport top when sticky.
  //  2. [class*="stickyHeader"] — for the Conversation tab whose header is a <div>.
  //     Relaxed threshold because this element may still be transitioning into place.
  function liveHeaderBottom(excludeEl) {
    let maxBottom = 0;
    const vw = window.innerWidth;

    for (const el of document.querySelectorAll('section, header, [role="banner"]')) {
      if (el === excludeEl) continue;
      const r = el.getBoundingClientRect();
      if (r.top >= 0 && r.top <= 10 && r.bottom - r.top >= 10 && r.bottom > maxBottom && r.width > vw * 0.3)
        maxBottom = r.bottom;
    }

    if (maxBottom === 0) {
      const topCap = window.innerHeight * 0.2;
      for (const el of document.querySelectorAll('[class*="stickyHeader"]')) {
        if (el === excludeEl) continue;
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.top <= topCap && r.bottom - r.top >= 10 && r.bottom > maxBottom && r.width > vw * 0.3)
          maxBottom = r.bottom;
      }
    }

    return maxBottom;
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
      nav.style.cssText = `position:fixed; top:${topPx}px; left:0; right:0; width:auto; z-index:200; background-color:var(--color-canvas-default,#ffffff); box-shadow:0 1px 0 var(--color-border-default,#d0d7de);`;
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
        unstick();
      } else if (stuck) {
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
      resizeTimer = setTimeout(() => { teardownSticky(); setupStickyTabs(); }, 200);
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
    if (nav) {
      if (!nav.dataset.prStickySetup) requestAnimationFrame(setupStickyTabs);
      return;
    }
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

  function registerSPAFramework(leaveEvent, arriveEvent) {
    document.addEventListener(leaveEvent, saveScroll);
    document.addEventListener(arriveEvent, () => { watchForNav(); restoreScroll(); });
  }

  window.addEventListener('beforeunload', saveScroll);
  registerSPAFramework('turbo:before-visit', 'turbo:load');
  registerSPAFramework('pjax:send', 'pjax:end');

  watchForNav();
  restoreScroll();
})();
