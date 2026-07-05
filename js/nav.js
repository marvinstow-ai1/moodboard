/* ============================================================================
   Navigation — Vorschau-Karten der Seiten
   ----------------------------------------------------------------------------
   Der Kompass-Button in der Pill öffnet ein Vollbild-Overlay mit einem
   horizontalen Swiper aus Vorschau-Karten (Startseite, Info, Gästebuch). Jede
   Karte zeigt eine Miniatur der jeweiligen Seite – bewusst ohne Header und
   Pill, damit sie clean wirkt. Ein Tipp auf eine Karte navigiert direkt dorthin
   und schließt das Overlay.

   Reine Ansteuerung; die eigentliche Navigation läuft über die schon
   vorhandenen Helfer in window.MB (goHome / openInfoPage / openGuestbook), die
   app.js bzw. guestbook.js bereitstellen. Styles in css/nav.css.
   ============================================================================ */
(function () {
  const $ = (id) => document.getElementById(id);

  // ── Mini-Vorschauen der einzelnen Seiten ──────────────────────────────────
  // Startseite: kleines Kachel-Mosaik aus echten Thumbnails (falls schon
  // geladen), sonst dezente Platzhalter – wie ein Mini-Screenshot des Grids.
  function buildHome() {
    const grid = document.createElement('div');
    grid.className = 'nav-mini-grid';
    const thumbs = window.MB?.getPreviewThumbs?.(9) || [];
    for (let i = 0; i < 9; i++) {
      const tile = document.createElement('div');
      tile.className = 'nav-tile';
      const src = thumbs[i];
      if (src) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        // Lädt ein Thumbnail nicht, bleibt die dezente Platzhalter-Kachel stehen.
        img.onerror = () => img.remove();
        img.src = src;
        tile.appendChild(img);
      }
      grid.appendChild(tile);
    }
    return grid;
  }

  // Info: Held-Badge + Titelzeile + Skelett-Karten (spiegelt die echte Seite).
  function buildInfo() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-mini-page';
    wrap.innerHTML =
      '<div class="nav-mini-badge">✦</div>' +
      '<div class="nav-mini-heroline"></div>' +
      '<div class="nav-mini-subline"></div>' +
      '<div class="nav-mini-cards">' +
        '<div class="nav-skel-card"><span class="nav-skel w90"></span><span class="nav-skel w70"></span></div>' +
        '<div class="nav-skel-card"><span class="nav-skel w90"></span><span class="nav-skel w50"></span></div>' +
        '<div class="nav-skel-card"><span class="nav-skel w70"></span></div>' +
      '</div>';
    return wrap;
  }

  // Gästebuch: Held-Badge + 2-spaltiges Feed-Mosaik als Skelett.
  function buildGuestbook() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-mini-page';
    let feed = '';
    for (let i = 0; i < 4; i++) feed += '<div class="nav-feed-tile"></div>';
    wrap.innerHTML =
      '<div class="nav-mini-badge">✍️</div>' +
      '<div class="nav-mini-heroline"></div>' +
      '<div class="nav-mini-subline"></div>' +
      '<div class="nav-mini-feed">' + feed + '</div>';
    return wrap;
  }

  const PAGES = [
    { key: 'home',      label: 'Startseite', build: buildHome,      go: () => window.MB?.goHome?.() },
    { key: 'info',      label: 'Info',       build: buildInfo,      go: () => window.MB?.openInfoPage?.() },
    { key: 'guestbook', label: 'Gästebuch',  build: buildGuestbook, go: () => window.MB?.openGuestbook?.() },
  ];

  function init() {
    const btn = $('navBtn');
    const page = $('navPage');
    const swiper = $('navSwiper');
    const dotsEl = $('navDots');
    const closeBtn = $('navClose');
    if (!btn || !page || !swiper) return;

    // Karten einmalig aufbauen (Thumbnails der Startseite werden bei jedem
    // Öffnen frisch nachgezogen, s. refreshHome()).
    const cards = PAGES.map((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'nav-card';
      card.dataset.key = p.key;

      const frame = document.createElement('div');
      frame.className = 'nav-card-frame';
      frame.appendChild(p.build());

      const label = document.createElement('div');
      label.className = 'nav-card-label';
      label.textContent = p.label;

      card.append(frame, label);
      card.addEventListener('click', () => navigateTo(p));
      swiper.appendChild(card);

      const dot = document.createElement('span');
      dot.className = 'nav-dot';
      dotsEl?.appendChild(dot);
      return card;
    });

    const dots = dotsEl ? Array.from(dotsEl.children) : [];

    function setActive(idx) {
      cards.forEach((c, i) => c.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    }

    // Aktive Karte anhand der Scroll-Position (nächste zur Swiper-Mitte).
    function syncActive() {
      const mid = swiper.scrollLeft + swiper.clientWidth / 2;
      let best = 0, bestDist = Infinity;
      cards.forEach((c, i) => {
        const center = c.offsetLeft + c.offsetWidth / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      setActive(best);
    }
    let _raf = 0;
    swiper.addEventListener('scroll', () => {
      cancelAnimationFrame(_raf);
      _raf = requestAnimationFrame(syncActive);
    });

    function currentKey() {
      if ($('gbPage')?.classList.contains('show')) return 'guestbook';
      if ($('infoPage')?.classList.contains('show')) return 'info';
      return 'home';
    }

    function refreshHome() {
      // Startseiten-Mosaik mit den aktuell geladenen Thumbnails neu füllen.
      const homeCard = cards.find((c) => c.dataset.key === 'home');
      const frame = homeCard?.querySelector('.nav-card-frame');
      if (frame) { frame.innerHTML = ''; frame.appendChild(buildHome()); }
    }

    function open() {
      window.MB?.closeOtherPopups?.();
      refreshHome();
      page.classList.add('show');
      page.setAttribute('aria-hidden', 'false');
      btn.classList.add('active');
      // Auf die Karte der aktuell offenen Seite zentrieren.
      const idx = Math.max(0, PAGES.findIndex((p) => p.key === currentKey()));
      requestAnimationFrame(() => {
        const c = cards[idx];
        if (c) swiper.scrollLeft = c.offsetLeft - (swiper.clientWidth - c.offsetWidth) / 2;
        setActive(idx);
      });
    }
    function close() {
      page.classList.remove('show');
      page.setAttribute('aria-hidden', 'true');
      btn.classList.remove('active');
    }
    function toggle() { page.classList.contains('show') ? close() : open(); }

    function navigateTo(p) {
      close();
      // Kurz warten, damit das Overlay ausblendet, bevor die Zielseite auffährt.
      setTimeout(() => p.go?.(), 120);
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    closeBtn?.addEventListener('click', close);
    // Klick auf die leere Fläche (nicht auf eine Karte) schließt das Overlay.
    page.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-card') && !e.target.closest('.nav-close')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && page.classList.contains('show')) close();
    });

    window.MB = window.MB || {};
    window.MB.closeNav = close;
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
