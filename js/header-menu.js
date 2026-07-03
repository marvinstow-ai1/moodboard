/* ============================================================
   Header hub menu
   ------------------------------------------------------------
   Collapses the old Info / Login / Menü buttons into a single
   top-right button with a dropdown. The original buttons are
   kept in the DOM (hidden) so every existing handler, the
   owner/login state and the `.admin-only` visibility logic in
   app.js keep working untouched — the menu items just forward
   their click to the matching original button.

   The header is mirrored 1:1 into the Info- and Gästebuch-Page
   (see index.html). This module therefore wires ALL hub menus
   on the page (class-based, not a single id) and lets the
   in-page "Marvin's Place" title act as a home button that
   closes the surrounding page.
   ============================================================ */
(function () {
  function closeAllMenus() {
    document.querySelectorAll('.hub-menu.show').forEach((m) => m.classList.remove('show'));
    document.querySelectorAll('.hubbtn[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  // Close the Info-/Gästebuch-Page that contains `el` (if any), so board-level
  // popups routed from an in-page menu (Login, Verwalten …) render on top of the
  // board instead of behind the still-open full-screen page.
  function closeHostPage(el) {
    const pg = el.closest('.info-page, .gb-page');
    if (!pg || !pg.classList.contains('show')) return false;
    pg.classList.add('is-animating');
    setTimeout(() => pg.classList.remove('is-animating'), 320);
    pg.classList.remove('show');
    pg.setAttribute('aria-hidden', 'true');
    window.MB?.updateBodyLock?.();
    return true;
  }

  function init() {
    window.MB = window.MB || {};
    window.MB.closeHubMenu = closeAllMenus;

    const TARGET = { info: 'infoBtn', login: 'loginBtn', menu: 'menuBtn', access: 'accessBtn' };

    document.querySelectorAll('.hubbtn').forEach((hubBtn) => {
      const hubMenu = hubBtn.parentElement?.querySelector('.hub-menu');
      if (!hubMenu) return;
      const inPage = !!hubBtn.closest('.info-page, .gb-page');

      const open = () => {
        window.MB?.closeOtherPopups?.('hub');
        closeAllMenus();
        hubMenu.classList.add('show');
        hubBtn.setAttribute('aria-expanded', 'true');
      };

      hubBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hubMenu.classList.contains('show') ? closeAllMenus() : open();
      });

      hubMenu.querySelectorAll('.hub-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();          // keep app.js's outside-click closers from firing
          closeAllMenus();
          // From an in-page header, leave the page first so the routed popup
          // (login modal, manage sheet …) isn't hidden behind it.
          if (inPage) closeHostPage(item);
          const btn = document.getElementById(TARGET[item.dataset.hub]);
          if (btn) btn.click();         // preserves all existing behaviour
        });
      });
    });

    // In-page title → back to the board (mirrors the main title's spot without
    // shuffling the hidden grid).
    document.querySelectorAll('.board-title.page-home').forEach((title) => {
      const go = () => closeHostPage(title);
      title.addEventListener('click', go);
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });

    // Close on outside click / Escape.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.hub-menu') && !e.target.closest('.hubbtn')) closeAllMenus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
