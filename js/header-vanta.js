/* Header-Hintergrund-Animationen (Vanta.js).
   Liegt als eigene Ebene IM Header-Band (.topbar), hinter Titel + Buttons –
   die Header-Höhe bleibt unverändert. Es laufen abwechselnd drei Effekte
   (Fog → Clouds → Cells), die alle paar Sekunden sanft durchgewechselt
   ("durchgechangt") werden. Pro Effekt wird ein Farb-Theme an <body> gehängt,
   damit Titel, Buttons und die Bottom-Pill sich an die Stimmung anpassen.

   Three.js + Vanta werden per CDN geladen (siehe index.html). Sind sie nicht
   verfügbar, bleibt der Header einfach wie zuvor (solides Schwarz) – kein Fehler. */
(function () {
  var el = document.getElementById('headerVanta');
  if (!el) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Erst Theme setzen (funktioniert auch ohne WebGL als statischer Verlauf),
  // damit Titel/Buttons/Pill von Anfang an stimmig sind.
  function applyTheme(cls) {
    document.body.classList.remove('hv-fog', 'hv-clouds', 'hv-cells');
    document.body.classList.add(cls);
  }

  // Wenn Vanta/THREE fehlen oder reduzierte Bewegung gewünscht ist:
  // statischen, themenpassenden Verlauf zeigen und nicht animieren.
  if (typeof window.VANTA === 'undefined' || typeof window.THREE === 'undefined' || reduce) {
    el.classList.add('is-static');
    applyTheme('hv-fog');
    requestAnimationFrame(function () { el.classList.add('is-ready'); });
    return;
  }

  // Noise-Textur für CLOUDS2 als Data-URL erzeugen -> keine externe Datei,
  // keine CORS-Probleme, kein 404 auf ./gallery/noise.png.
  function makeNoiseURL() {
    var size = 256;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    try { return c.toDataURL('image/png'); } catch (e) { return undefined; }
  }
  var noiseURL = makeNoiseURL();

  var common = {
    el: el,
    mouseControls: false,
    touchControls: false,
    gyroControls: false,
    minHeight: 60.0,
    minWidth: 60.0
  };
  function opts(extra) {
    var o = {}; var k;
    for (k in common) o[k] = common[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }

  // Effekte im Original-Look von vantajs.com (keine Farb-Overrides). Die
  // Hintergründe sind dadurch hell -> Schrift/Buttons werden pro Theme im CSS
  // passend dunkel bzw. hell gesetzt.
  var THEMES = [
    {
      cls: 'hv-fog',
      make: function () {
        return window.VANTA.FOG(opts({ speed: 1.1 }));
      }
    },
    {
      cls: 'hv-clouds',
      make: function () {
        return window.VANTA.CLOUDS2(opts({
          scale: 1.0,
          speed: 0.9,
          texturePath: noiseURL
        }));
      }
    },
    {
      cls: 'hv-cells',
      make: function () {
        return window.VANTA.CELLS(opts({ speed: 1.0 }));
      }
    }
  ];

  var idx = 0;
  var effect = null;
  var timer = null;
  var CHANGE_MS = 18000; // alle ~18s durchchangen
  var FADE_MS = 1200;    // muss zur CSS-Transition von .header-vanta passen

  function build(i) {
    var t = THEMES[i];
    applyTheme(t.cls);
    try { effect = t.make(); } catch (e) { effect = null; }
    requestAnimationFrame(function () { el.classList.add('is-ready'); });
  }

  function destroy() {
    if (effect && typeof effect.destroy === 'function') {
      try { effect.destroy(); } catch (e) {}
    }
    effect = null;
  }

  function cycle() {
    el.classList.remove('is-ready'); // sanftes Ausblenden
    setTimeout(function () {
      destroy();
      idx = (idx + 1) % THEMES.length;
      build(idx);
    }, FADE_MS);
  }

  function start() { if (!timer) timer = setInterval(cycle, CHANGE_MS); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  build(0);
  start();

  // Im Hintergrund-Tab anhalten (Akku/Performance schonen).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });
})();
