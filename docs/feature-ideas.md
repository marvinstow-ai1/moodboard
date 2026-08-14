# Feature-Ideen — Marvin's Place (persönliches Archiv für Freunde)

Sammlung besprochener Ideen & Design-Entscheidungen. **Noch nichts davon gebaut** —
reine Konzept-Notizen. Baut auf dem bestehenden Muster auf: Owner kuratiert Inhalte,
freigegebene Freunde (`gate_ok()`) dürfen an gemeinsamen Dingen mitmachen,
Supabase Realtime als etabliertes Sync-Muster.

---

## 1. Live-Präsenz — „wer ist gerade da"

- Zeigt live, welche Freunde **jetzt** online/in der App sind (kleine Avatar-Reihe).
- Technik: **Supabase Realtime Presence** (flüchtig, kein DB-Schreiben, verschwindet
  beim Tab-Schließen). Nichts Neues zu installieren.
- Optional: anzeigen *wo* jemand ist ("im 3D-Inventar", "füttert Tamagotchi").
- Avatare aus Freundebuch/Gästebuch (Name + evtl. Insta), Fallback = Initiale +
  Tagesfarbe (Muster vom Tamagotchi schon da).
- **Aufwand: klein. Effekt: groß.** → als Erstes umsetzen.

---

## 2. Sticker-Album (Panini-Style)

Sammel-Album im Panini-Gefühl. Freunde sammeln Sticker.

### Design-Entscheidung: der Sticker-Rahmen ⭐ (festgehalten 2026-08-14)

- Jeder Sticker ist ein **Rahmen wie bei Panini-Stickern**, in den ein **Bild**
  eingesetzt wird.
- **Unten im Rahmen** steht eine Beschriftung, z. B.:
  `Marvin's Place — Sticker 0001`
- Also: durchnummerierte Sammelkarten mit einheitlichem Rahmen-Look, fortlaufende
  ID (`0001`, `0002`, …), Bild in der Mitte, Label unten.

### FINALE Rahmen-Auswahl ✅ (festgelegt 2026-08-14)

Nach mehreren Skizzen (Artifacts) stehen die Rahmen fest:

- **Holo-Foil-Rahmen** aus dem 1. Vorschlag — der Regenbogen-Conic-Rand mit dunklem
  Fenster. **OHNE** den rotierenden/„spinning" Innen-Effekt (statischer Schimmer).
  Referenz-Wunsch: ruhiger, radialer YGO-Foil statt vieler zappelnder Sprinkles.
- **5 dezente 8-Bit-Paletten** (gedämpft, KEIN lautes Neon-Grün):
  1. Slate · Bernstein  (`#2a2d38` / Akzent `#c99a54`)
  2. Dusk · Mauve       (`#2c2632` / Akzent `#c095b0`)
  3. Steel · Ice        (`#242c34` / Akzent `#87a9c6`)
  4. Charcoal · Sand    (`#282521` / Akzent `#cbb488`)
  5. Ink · Coral        (`#262330` / Akzent `#cf9a8b`)
  Pixel-Rahmen = chunky gestufter Rand (box-shadow-Ringe) + Monospace-Label.

### FINALE Pack-Öffnung ✅ (festgelegt 2026-08-14)

- **Aufreißen-Animation** (Effekt #1): obere Zacken-Naht reißt weg.
- **Genau 1 Sticker pro Pack** (nicht 5).
- Pack hat **Yu-Gi-Oh-Zacken oben & unten** (CSS `mask`, Zickzack-Kante).
- Pack-Design selbst bleibt vorerst **clean/Platzhalter** — wird noch ausgedacht.

### Woher kommen die Sticker (Herkunft)

- **Start-Empfehlung:** fester, selbst gestalteter Sticker-Satz (z. B. 30–50 Stück,
  im Look von `js/pixel-icons.js`). Bei fremden Assets auf freie Lizenz achten
  (CC0 / OpenMoji CC BY-SA).
- **Elegant:** Sticker aus eigenem Grid-Content generieren — jedes Moodboard-Bild
  kann ein Sammelkarten-Sticker werden (Seltenheit z. B. aus `ai_tags`/Farbprofil).
- **Später/optional:** KI-generierte Sticker (OpenRouter/Gemini schon angebunden,
  aber teurer + lizenzrechtlich heikler).

### Sammel-Mechanik (wie ein Freund einen Sticker bekommt)

- Freischalten durch Aktionen (Tamagotchi gefüttert, 5. Besuch, Gästebuch signiert …)
- **„Sticker des Tages"** — gleiches Muster wie das schon existierende
  „ein zufälliges 3D-Modell pro Tag".
- Owner vergibt seltene Sticker manuell.
- Später: Doppelte tauschen (echtes Panini-Feeling, größerer Aufwand).

### Datenmodell (grob)

- `stickers` — Katalog (owner-kuratiert): id/Nummer, Bild-URL, Rahmen-/Label-Text,
  Seltenheit.
- `sticker_collection` — wer besitzt welchen: `user_id` + sticker-id.
- RLS wie gewohnt: Mitglieder lesen, eigener Besitz pro `user_id` schreibbar.

---

## 3. Begehbarer 3D-Raum

Ausbau des 3D-Inventars vom Podest-Grid zu einem Raum.

- **Wichtig:** aktuelles `<model-viewer>` ist ein Objekt-Betrachter, **kein** Raum —
  echtes „Laufen" braucht eine echte Engine (**Three.js** / R3F).
- **Stufe 1 — Diorama (empfohlener Start):** drehbarer/zoombarer Raum mit Modellen
  auf Regalen. Nah am jetzigen Stand, geringer Sprung, ~80 % des „mein Zimmer"-
  Gefühls.
- **Stufe 2 — echtes First-Person-Laufen:** WASD+Maus (Desktop), Joystick (Mobile).
  Deutlich größter Brocken der ganzen Liste, bricht mit „Vanilla JS, klein & simpel".
- **Performance-Sorgen:** Mobile ist Flaschenhals; `.glb` komprimieren
  (Draco/Meshopt + KTX2-Texturen); nicht Dutzende Modelle roh gleichzeitig;
  ggf. LOD/Impostors. Multiplayer-im-Raum (Freunde als Figuren live) = Vision-Tier.
- **Fazit:** mit Stufe 1 (Diorama) starten, echtes Laufen als späteres Ziel.

---

## Weitere Ideen (aus dem Brainstorming, niedrigere Priorität)

- Echtes Freundebuch-Steckbrief pro Freund (Lieblingsfarbe, Motto …) — Gästebuch ist
  aktuell nur Signatur + Insta.
- Stempel/Reaktionen auf Grid-Bilder.
- Besucher-Log („Fußspuren", MySpace-Style).
- „An diesem Tag" / Rückblick (nutzt `created_at`).
- Zeitstrahl-Ansicht des Archivs.
- Geteiltes Mixtape / Musikraum.
- Zeitkapsel (Inhalt wird an zukünftigem Datum sichtbar).

---

## Empfohlene Reihenfolge

1. **Live-Präsenz** — klein, sofort, großer Effekt.
2. **Sticker-Album** — Start: fester Sticker-Satz + „Sticker des Tages", Panini-Rahmen.
3. **3D-Raum** — als drehbares Diorama beginnen.
