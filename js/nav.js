/* ============================================================================
   Navigation — Vorschau-Karten als Pop-up
   ----------------------------------------------------------------------------
   Der Kompass-Button in der Pill öffnet ein kleines Pop-up über der Bottom-Bar
   – im selben Look/Verhalten wie das Chat-Panel. Darin lassen sich die
   Vorschau-Karten der Seiten (Startseite, Info, Gästebuch) horizontal swipen;
   ein Tipp öffnet die jeweilige Unterseite dynamisch und schließt das Pop-up.

   Reine Ansteuerung; die eigentliche Navigation läuft über die schon
   vorhandenen Helfer in window.MB (goHome / openInfoPage / openGuestbook), die
   app.js bzw. guestbook.js bereitstellen. Styles in css/nav.css.
   ============================================================================ */
(function () {
  const $ = (id) => document.getElementById(id);

  // Pixel-Icons (js/pixel-icons.js) für die Held-Badges der Vorschau-Karten.
  const icon = (key) => (window.PIXEL_ICONS && window.PIXEL_ICONS[key]) || '';

  // ── Mini-Vorschauen der einzelnen Seiten ──────────────────────────────────
  // Startseite: dasselbe Grid-Design wie die echte Ansicht, mit einer festen
  // Auswahl an Bildern. Bewusst nur <img> (Thumbnails) – nie <video>, damit in
  // der Vorschau nichts autoplayt.
  function buildHome() {
    const grid = document.createElement('div');
    grid.className = 'nav-mini-grid';
    const thumbs = window.MB?.getPreviewThumbs?.(12) || [];
    for (let i = 0; i < 12; i++) {
      const cell = document.createElement('div');
      cell.className = 'nav-cell';
      const src = thumbs[i];
      if (src) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        // Lädt ein Thumbnail nicht, bleibt die dezente Platzhalter-Kachel stehen.
        img.onerror = () => img.remove();
        img.src = src;
        cell.appendChild(img);
      }
      grid.appendChild(cell);
    }
    return grid;
  }

  // Info: Held-Badge + Titelzeile + Skelett-Karten (spiegelt die echte Seite).
  function buildInfo() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-mini-page';
    wrap.innerHTML =
      '<div class="nav-mini-badge">' + icon('info') + '</div>' +
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
      '<div class="nav-mini-badge">' + icon('guestbook') + '</div>' +
      '<div class="nav-mini-heroline"></div>' +
      '<div class="nav-mini-subline"></div>' +
      '<div class="nav-mini-feed">' + feed + '</div>';
    return wrap;
  }

  // Inventory: Held-Badge + 3er-Raster als Skelett (spiegelt das Inventar-Grid).
  function buildModels() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-mini-page';
    let cells = '';
    for (let i = 0; i < 6; i++) cells += '<div class="nav-cell"></div>';
    wrap.innerHTML =
      '<div class="nav-mini-badge">' + icon('inventory') + '</div>' +
      '<div class="nav-mini-heroline"></div>' +
      '<div class="nav-mini-subline"></div>' +
      '<div class="nav-mini-grid three">' + cells + '</div>';
    return wrap;
  }

  // Tamagotchi: Held-Badge + echter Mini-Screen. js/tamagotchi.js zeichnet die
  // aktuelle Szene (Zimmer + Figur) in den kleinen Canvas – Fallback: Skelett.
  function buildTama() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-mini-page';
    wrap.innerHTML =
      '<div class="nav-mini-badge">' + icon('tama') + '</div>' +
      '<div class="nav-mini-heroline"></div>' +
      '<div class="nav-mini-subline"></div>';
    const scr = document.createElement('div');
    scr.className = 'nav-mini-tama';
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 144;
    scr.appendChild(cv);
    if (!window.MB?.drawTamaPreview?.(cv)) scr.classList.add('is-skeleton');
    wrap.appendChild(scr);
    return wrap;
  }

  const PAGES = [
    { key: 'home',      label: 'Startseite', build: buildHome,      go: () => window.MB?.goHome?.() },
    { key: 'info',      label: 'Info',       build: buildInfo,      go: () => window.MB?.openInfoPage?.() },
    { key: 'guestbook', label: 'Gästebuch',  build: buildGuestbook, go: () => window.MB?.openGuestbook?.() },
    { key: 'models',    label: 'Inventory',  build: buildModels,    go: () => window.MB?.openModels?.() },
    { key: 'tama',      label: 'Tamagotchi', build: buildTama,      go: () => window.MB?.openTama?.() },
  ];

  function init() {
    const btn = $('navBtn');
    const panel = $('navPanel');
    const swiper = $('navSwiper');
    const dotsEl = $('navDots');
    const closeBtn = $('navClose');
    if (!btn || !panel || !swiper) return;

    // Karten einmalig aufbauen (die Startseiten-Auswahl wird bei jedem Öffnen
    // frisch nachgezogen, sobald Items geladen sind – s. refreshHome()).
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
      if ($('tamaPage')?.classList.contains('show')) return 'tama';
      if ($('m3dPage')?.classList.contains('show')) return 'models';
      if ($('gbPage')?.classList.contains('show')) return 'guestbook';
      if ($('infoPage')?.classList.contains('show')) return 'info';
      return 'home';
    }

    function refreshHome() {
      // Startseiten-Vorschau mit der aktuellen Bild-Auswahl neu füllen.
      const homeCard = cards.find((c) => c.dataset.key === 'home');
      const frame = homeCard?.querySelector('.nav-card-frame');
      if (frame) { frame.innerHTML = ''; frame.appendChild(buildHome()); }
    }

    function refreshTama() {
      // Tamagotchi-Vorschau mit der aktuellen Szene neu zeichnen.
      const cv = cards.find((c) => c.dataset.key === 'tama')?.querySelector('.nav-mini-tama canvas');
      if (cv && window.MB?.drawTamaPreview?.(cv))
        cv.parentElement.classList.remove('is-skeleton');
    }

    function open() {
      // Andere Bottom-Bar-Popups (Spotify, Kachelgröße, Chat) sanft schließen.
      window.MB?.closeOtherPopups?.('nav');
      refreshHome();
      refreshTama();
      panel.classList.add('show');
      panel.setAttribute('aria-hidden', 'false');
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
      panel.classList.remove('show');
      panel.setAttribute('aria-hidden', 'true');
      btn.classList.remove('active');
    }
    function toggle() { panel.classList.contains('show') ? close() : open(); }

    function navigateTo(p) {
      close();
      // Kurz warten, damit das Pop-up ausblendet, bevor die Zielseite auffährt.
      setTimeout(() => p.go?.(), 120);
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    closeBtn?.addEventListener('click', close);
    // Klick außerhalb des Pop-ups (und nicht auf den Nav-Button) schließt es.
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('show')) return;
      if (e.target.closest('#navPanel') || e.target.closest('#navBtn')) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('show')) close();
    });

    window.MB = window.MB || {};
    window.MB.closeNav = close;
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
