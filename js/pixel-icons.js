/* ============================================================================
   Pixel-Icons — 16-Bit-Retro-Symbole für die Unterseiten
   ----------------------------------------------------------------------------
   Ersetzt die früheren Emoji-Badges (Info, Gästebuch, Inventory, Tamagotchi)
   durch handgezeichnete, farbige Pixel-Grafiken im Stil alter Nintendo-Spiele.

   Jedes Icon ist ein 16×16-Raster (ein Buchstabe = ein Pixel). `make()` baut
   daraus ein kompaktes Inline-SVG (mit crispEdges, damit die Pixel scharf
   bleiben). Die Icons liegen unter window.PIXEL_ICONS und werden beim Laden in
   alle Elemente mit [data-pixel-icon] einsetzt. js/nav.js greift zusätzlich
   direkt darauf zu, um dieselben Symbole in der Navigations-Vorschau zu zeigen.
   Styles (Größe innerhalb der Badges) stehen in css/info.css bzw. css/nav.css.
   ============================================================================ */
(function () {
  // Raster → Inline-SVG. Gleiche, direkt benachbarte Farben werden pro Zeile zu
  // einem Rechteck zusammengefasst (schlankeres DOM, identische Optik).
  function make(rows, pal) {
    let cells = '';
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        const color = pal[ch];
        if (!color) { x++; continue; }
        let w = 1;
        while (x + w < row.length && row[x + w] === ch) w++;
        cells += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="1" fill="' + color + '"/>';
        x += w;
      }
    });
    return '<svg viewBox="0 0 16 16" width="100%" height="100%" shape-rendering="crispEdges" ' +
           'xmlns="http://www.w3.org/2000/svg" style="display:block" aria-hidden="true" focusable="false">' +
           cells + '</svg>';
  }

  // ── Info: Mario-„?“-Block ─────────────────────────────────────────────────
  // Der ikonische Fragezeichen-Block – passt zur Info-/Startseite.
  const INFO = make([
    'KKKKKKKKKKKKKKKK',
    'KHHHHHHHHHHHHHHK',
    'KHDYYYYYYYYYYDSK',
    'KHYYYYWWWWYYYYSK',
    'KHYYYWWWWWWYYYSK',
    'KHYYYWWYYWWYYYSK',
    'KHYYYYYYWWWYYYSK',
    'KHYYYYYWWWYYYYSK',
    'KHYYYYYWWYYYYYSK',
    'KHYYYYYWWYYYYYSK',
    'KHYYYYYYYYYYYYSK',
    'KHYYYYYWWYYYYYSK',
    'KHYYYYYYYYYYYYSK',
    'KHDYYYYYYYYYYDSK',
    'KSSSSSSSSSSSSSSK',
    'KKKKKKKKKKKKKKKK',
  ], {
    K: '#26200a', H: '#ffe27a', Y: '#fbc02d', S: '#e08a10', D: '#8a5a00', W: '#ffffff',
  });

  // ── Gästebuch: Brief mit rotem Siegel ─────────────────────────────────────
  // „Verewige dich“ = hinterlasse eine Nachricht.
  const GUESTBOOK = make([
    '................',
    '................',
    '................',
    '.KKKKKKKKKKKKKK.',
    '.KFPPPPPPPPPPFK.',
    '.KPFPPPPPPPPFPK.',
    '.KPPFPPPPPPFPPK.',
    '.KPPPFPPPPFPPPK.',
    '.KPPPPFPPFPPPPK.',
    '.KPPPPPFFPPPPPK.',
    '.KPPPPPHHPPPPPK.',
    '.KPPPPPHHPPPPPK.',
    '.KPPPPPPPPPPPPK.',
    '.KKKKKKKKKKKKKK.',
    '................',
    '................',
  ], {
    K: '#33405c', P: '#fbf3e0', F: '#cbb78a', H: '#e5484d',
  });

  // ── Inventory: Schatztruhe ────────────────────────────────────────────────
  // Die klassische Retro-Spiel-Truhe – das Inventar der 3D-Modelle.
  const INVENTORY = make([
    '................',
    '................',
    '.KKKKKKKKKKKKKK.',
    '.KGWWWWWWWWWWGK.',
    '.KWWWWWWWWWWWWK.',
    '.KWWWWWGGWWWWWK.',
    '.KKKKKKGGKKKKKK.',
    '.KWWWWGGGGWWWWK.',
    '.KWWWWGLLGWWWWK.',
    '.KWWWWGGGGWWWWK.',
    '.KWWWWWWWWWWWWK.',
    '.KWWWWWWWWWWWWK.',
    '.KGWWWWWWWWWWGK.',
    '.KKKKKKKKKKKKKK.',
    '................',
    '................',
  ], {
    K: '#241405', W: '#b06a2c', G: '#f6c020', L: '#3a2408',
  });

  // ── Tamagotchi: geflecktes Dino-Ei ────────────────────────────────────────
  // Passt zum kleinen Pixel-Mitbewohner, der aus einem Ei schlüpft.
  const TAMA = make([
    '................',
    '......KWWK......',
    '.....KWWWWK.....',
    '....KWWWWWWK....',
    '...KWWWWWWWWK...',
    '...KWWWWWWWWK...',
    '..KWWWWWWWWWWK..',
    '..KWGGWWWWWWWK..',
    '..KWGGWWWWWWWK..',
    '..KWWWWWWGGGWK..',
    '..KWWWWWWGGGWK..',
    '..KWWGGWWWWWWK..',
    '...KWGGWWWWWK...',
    '....KWWWWWWK....',
    '.....KWWWWK.....',
    '......KWWK......',
  ], {
    K: '#2f4a22', W: '#f4f7ee', G: '#57b24a',
  });

  const ICONS = { info: INFO, guestbook: GUESTBOOK, inventory: INVENTORY, tama: TAMA };
  window.PIXEL_ICONS = ICONS;

  // Statische Badges (Hero-Bereiche der Unterseiten) befüllen.
  function fill() {
    document.querySelectorAll('[data-pixel-icon]').forEach((el) => {
      if (el.dataset.pxDone) return;
      const svg = ICONS[el.getAttribute('data-pixel-icon')];
      if (svg) { el.innerHTML = svg; el.dataset.pxDone = '1'; }
    });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', fill);
  else
    fill();
})();
