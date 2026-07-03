/* ============================================================
   Header hub menu
   ------------------------------------------------------------
   Collapses the old Info / Login / Menü buttons into a single
   top-right button with a dropdown. The original buttons are
   kept in the DOM (hidden) so every existing handler, the
   owner/login state and the `.admin-only` visibility logic in
   app.js keep working untouched — the menu items just forward
   their click to the matching original button.
   ============================================================ */
(function () {
  function init() {
    const hubBtn  = document.getElementById('hubBtn');
    const hubMenu = document.getElementById('hubMenu');
    if (!hubBtn || !hubMenu) return;

    const close = () => { hubMenu.classList.remove('show'); hubBtn.setAttribute('aria-expanded', 'false'); };
    const open  = () => { window.MB?.closeOtherPopups?.('hub'); hubMenu.classList.add('show'); hubBtn.setAttribute('aria-expanded', 'true'); };

    window.MB = window.MB || {};
    window.MB.closeHubMenu = close;

    hubBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hubMenu.classList.contains('show') ? close() : open();
    });

    // Route each item to its original (hidden) control.
    const TARGET = { info: 'infoBtn', login: 'loginBtn', menu: 'menuBtn', access: 'accessBtn' };
    hubMenu.querySelectorAll('.hub-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();              // keep app.js's outside-click closers from firing
        close();
        const btn = document.getElementById(TARGET[item.dataset.hub]);
        if (btn) btn.click();             // preserves all existing behaviour
      });
    });

    // Close on outside click / Escape.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#hubMenu') && !e.target.closest('#hubBtn')) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
