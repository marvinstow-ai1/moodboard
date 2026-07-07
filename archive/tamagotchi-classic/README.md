# Archiv: Klassisches Tamagotchi (Canvas-Version)

Das war bis Juli 2026 das Tamagotchi auf der Website: ein prozedural
gezeichneter Pixel-Charakter auf einem kleinen Canvas (160×144, Game-Boy-Look)
mit echter Spiel-Logik – Füttern, Snack, Spielen, Licht/Schlafen, Putzen,
Medizin. Vier Werte (Futter, Laune, Energie, Sauberkeit) fielen mit der Zeit,
auch offline, Zustand lag in `localStorage`.

Auf der Website wurde diese Version durch den **Pure-CSS-Tamagotchi** (aus dem
Gist von Marvin, ursprünglich ein Pen von [Manz.dev](https://manz.dev/)) ersetzt.
Diese Version wird aktuell nicht mehr geladen – sie liegt nur hier, falls sie
später nochmal gebraucht wird.

## Was liegt hier

| Datei | Was es ist |
|-------|------------|
| `tamagotchi.js`   | Komplette Spiel-Logik + Canvas-Rendering + Seiten-Mechanik (früher `js/tamagotchi.js`) |
| `tamagotchi.css`  | Alle Styles: Seite, Hero, Device, Screen, Werte-Balken, Buttons (früher `css/tamagotchi.css`) |
| `page-markup.html`| Das alte `.tama-inner`-Markup aus `index.html` (Hero mit Infotext, Device, Statuszeile, Balken, Aktions-Buttons) |

## Wiederherstellen

1. `tamagotchi.js` zurück nach `js/tamagotchi.js` kopieren.
2. `tamagotchi.css` zurück nach `css/tamagotchi.css` kopieren.
3. In `index.html` den Inhalt von `.tama-inner` (innerhalb von `#tamaPage` →
   `.tama-scroll`) wieder durch den Inhalt aus `page-markup.html` ersetzen.

Danach ist die alte Canvas-Version wieder aktiv. Die neue Pure-CSS-Version
liegt dann in denselben Dateien und würde überschrieben – bei Bedarf vorher
sichern.
