import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { driver } from 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/+esm';

// ── Config ───────────────────────────────────────────────
const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const SEEN_KEY = 'mb_walkthrough_seen';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} };

// ── Tour-Schritte ────────────────────────────────────────
// Texte sind Platzhalter — bitte selbst beschriften.
const steps = [
  // 1) Intro: Zweck der App + Datenschutz-Hinweis (zentriert, ohne Element)
  {
    popover: {
      title: 'Willkommen bei Marvin’s Place',
      description: 'Das hier ist mein Moodboard – einfach Bilder, die grad meinen Vibe treffen. Kein Login, kein Tracking, keine Daten von dir. Du klickst dich einfach durch. Wenn du magst, zeig ich dir kurz, was die Buttons unten machen.',
      showButtons: ['next'],          // nur "Tour starten" (+ manueller Skip-Button)
      nextBtnText: 'Tour starten',
      align: 'center',
    },
  },
  {
    element: '#spotifyBtn',
    popover: { title: 'Musik dazu', description: 'Tipp drauf und meine Playlist läuft – passt perfekt zum Durchscrollen.' },
  },
  {
    element: '#shuffleBtn',
    popover: { title: 'Neu mischen', description: 'Würfelt die Bilder neu durch – jedes Mal ’ne andere Anordnung.' },
  },
  {
    element: '#filterBtn',
    popover: { title: 'Kachelgröße', description: 'Macht die Kacheln größer oder kleiner – ganz wie du’s magst.' },
  },
  {
    element: '#moodsMgmtBtn',
    popover: { title: 'Moods filtern', description: 'Hier sortier ich die Bilder nach Stimmung. Such dir ’nen Mood aus und du siehst nur das, was dazu passt.' },
  },
];

function run() {
  let d;
  d = driver({
    showProgress: true,
    popoverClass: 'mb-driver',
    nextBtnText: 'Weiter',
    prevBtnText: 'Zurück',
    doneBtnText: 'Fertig',
    onDestroyed: markSeen,            // Abschluss ODER Skip ODER X = gesehen
    onPopoverRender: (popover, { state }) => {
      // Im Intro-Schritt einen expliziten "Ich kenn mich aus"-Button ergänzen
      if (state.activeIndex !== 0) return;
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = 'Ich kenn mich aus';
      skip.className = 'mb-driver-skip';
      skip.addEventListener('click', () => d.destroy());
      popover.footerButtons.prepend(skip);
    },
    steps,
  });
  d.drive();
}

// ── Auto-Start: nur einmalig, nur für normale Besucher ───
(async () => {
  if (localStorage.getItem(SEEN_KEY)) return;            // schon gesehen
  try {
    const { data: { session } } = await sb.auth.getSession();
    const isOwner = !!(session && session.user.app_metadata?.role === 'owner');
    if (isOwner) return;                                 // Owner überspringen
  } catch (e) { /* ohne Session: normaler Besucher → Tour zeigen */ }
  run();
})();
