/* ============================================================================
   Tamagotchi — Marvin's Place
   ----------------------------------------------------------------------------
   Vollflächige Seite (gleiche Glas-Mechanik wie Info/Gästebuch/3D-Inventar).
   Darauf leben nur noch die Überschrift und ein Pure-CSS-Tamagotchi aus
   Marvins Gist (ursprünglich ein Pen von Manz.dev). Kein Canvas, keine
   Spiel-Logik mehr – nur Anzeigen + Farbwechsel-Buttons.

   Die frühere Canvas-Version (Füttern/Spielen/Werte …) liegt vollständig
   unter archive/tamagotchi-classic/, falls sie später nochmal gebraucht wird.

   Styles/Markup: css/tamagotchi.css bzw. #tamaPage in index.html.
   ============================================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);

const page = $('tamaPage');
if (!page) return;

/* ── Farbwechsel-Buttons (aus dem Gist) ──────────────────────────────────────
   Streng auf das Gadget gescopt, damit querySelectorAll nicht die Buttons der
   restlichen Seite erwischt. Jeder Button setzt Gehäuse- und Knopffarbe. */
const COLORS_BUTTON = [
  { text: 'Rojo',     color: '#890000', buttonsColor: 'gold' },
  { text: 'Turquesa', color: '#19B1AC', buttonsColor: '#ccc' },
  { text: 'Negro',    color: '#111',    buttonsColor: '#bbb' },
  { text: 'Azul',     color: '#001F91', buttonsColor: '#ddd' },
  { text: 'Amarillo', color: '#d68111', buttonsColor: '#1836a3' },
];

const gadget      = page.querySelector('.tama-gadget');
const changeColor = gadget?.querySelector('.change-color');
const tamagotchi  = gadget?.querySelector('.tamagotchi');

if (changeColor && tamagotchi) {
  changeColor.innerHTML = COLORS_BUTTON.map((c) =>
    `<button type="button" style="--color: ${c.color}; --text-color: ${c.buttonsColor}">
      <span>${c.text}</span>
    </button>`
  ).join('');

  changeColor.querySelectorAll('button').forEach((button, index) => {
    button.addEventListener('click', () => {
      tamagotchi.style.setProperty('--body-color', COLORS_BUTTON[index].color);
      tamagotchi.style.setProperty('--buttons-color', COLORS_BUTTON[index].buttonsColor);
    });
  });
}

/* ── Seite öffnen / schließen ────────────────────────────────────────────── */
let _animTimer = null;
function markAnimating() {
  page.classList.add('is-animating');
  clearTimeout(_animTimer);
  _animTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
}

function openPage() {
  window.MB?.closeOtherPopups?.();
  window.MB?.closeInfoPage?.();
  window.MB?.closeGuestbook?.();
  window.MB?.closeModels?.();
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  window.MB?.kickAutoplay?.();
}

function closePage() {
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  window.MB?.updateBodyLock?.();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && page.classList.contains('show')) closePage();
});

window.MB = Object.assign(window.MB || {}, {
  openTama: openPage,
  closeTama: closePage,
});
})();
