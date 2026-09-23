/* Ultimate Duck Mule - Grundlagen: Konstanten, Mathe-Helfer, Sound.
 * Alles haengt unter window.UDM, damit die Dateien ohne Build-Schritt
 * einfach nacheinander eingebunden werden koennen. */
(function (global) {
  'use strict';

  var UDM = global.UDM || (global.UDM = {});

  /* ---------------------------------------------------------------- Welt */

  UDM.TILE = 32;
  UDM.COLS = 40;
  UDM.ROWS = 23;

  UDM.worldWidth = function () { return UDM.COLS * UDM.TILE; };
  UDM.worldHeight = function () { return UDM.ROWS * UDM.TILE; };

  /* ------------------------------------------------------------- Physik */

  UDM.PHYS = {
    gravity: 1900,
    moveSpeed: 245,
    accelGround: 2600,
    accelAir: 1500,
    frictionGround: 2800,
    frictionAir: 420,
    jumpVel: -645,
    jumpCut: 0.42,
    maxFall: 1150,
    coyote: 0.09,
    jumpBuffer: 0.11,
    wallSlideMax: 150,
    wallJumpX: 310,
    wallJumpY: -600,
    wallLock: 0.13,
    conveyorSpeed: 190,
    stickyFactor: 0.45,
    bounceMin: 680,
    playerW: 22,
    playerH: 26,
    // Power-ups
    airJumpFactor: 0.9,  // Doppelsprung: etwas schwaecher als der Bodensprung
    airJumpDelay: 0.05,  // Doppelsprung: fruehestens so lange nach Coyote-Ende
    turboFactor: 1.3,    // Turbo: Laufgeschwindigkeit und Beschleunigung
    glideFall: 95,       // Gleitschirm: hoechste Fallgeschwindigkeit
    shieldKnock: -470,   // Schild: Hochwurf nach dem abgefangenen Treffer
    shieldGrace: 1.3     // Schild: so lange danach unverwundbar (Sek.)
  };

  /** Kurzzeichen der Power-ups fuer die Spielerleiste. */
  UDM.BUFF_BADGES = {
    pu_djump: '⇈',
    pu_shield: '◈',
    pu_speed: '»',
    pu_glide: '☂'
  };

  /* ------------------------------------------------------------ Spieler */

  /** Standardfarben der vier Plaetze (wie Game::COLORS in PHP). */
  UDM.SLOT_COLORS = ['#ffcb3d', '#3fc7f0', '#ff6f91', '#7ed957'];

  /**
   * In der Lobby gewaehlte Farben je Platz. Der Spielcontroller fuellt das
   * aus dem Serverzustand; alles, was per slotColor() faerbt (Spielerleiste,
   * Besitzerpunkte an Bauteilen, Tabellen), folgt damit automatisch.
   */
  UDM.playerColors = {};

  /** Farbe eines Spielerplatzes - robust auch bei unerwarteten Werten. */
  UDM.slotColor = function (slot) {
    if (UDM.playerColors[slot]) { return UDM.playerColors[slot]; }
    var n = UDM.SLOT_COLORS.length;
    return UDM.SLOT_COLORS[((slot % n) + n) % n];
  };

  /** Dunklere Variante einer Hex-Farbe (Beine, Umrisse). */
  UDM.darken = function (hex, factor) {
    var f = factor === undefined ? 0.62 : factor;
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) { return '#555555'; }
    var n = parseInt(m[1], 16);
    var r = Math.round(((n >> 16) & 255) * f);
    var g = Math.round(((n >> 8) & 255) * f);
    var b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  UDM.CHARACTERS = {
    duck: { label: 'Ente' },
    mule: { label: 'Maultier' },
    racoon: { label: 'Waschbär' },
    frog: { label: 'Frosch' }
  };

  UDM.DEATH_LABELS = {
    sturz: 'abgestürzt',
    stachel: 'aufgespießt',
    saege: 'zersägt',
    pendel: 'von der Kugel erwischt',
    pfeil: 'durchbohrt',
    quetsch: 'zerquetscht',
    zeit: 'Zeit abgelaufen',
    aufgabe: 'aufgegeben',
    verbindung: 'Verbindung weg',
    ziel: 'im Ziel'
  };

  /* -------------------------------------------------------------- Mathe */

  UDM.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  UDM.lerp = function (a, b, t) { return a + (b - a) * t; };

  UDM.approach = function (value, target, delta) {
    if (value < target) { return Math.min(value + delta, target); }
    return Math.max(value - delta, target);
  };

  UDM.overlaps = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };

  /** Kleiner, deterministischer Zufallsgenerator (mulberry32). */
  UDM.rng = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  UDM.pick = function (list, rand) {
    return list[Math.floor((rand || Math.random)() * list.length) % list.length];
  };

  UDM.escapeHtml = function (text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };

  /* -------------------------------------------------------------- Sound */

  /** Kurze, komplett synthetische Effekte - es sind ja keine Assets erlaubt. */
  UDM.Audio = {
    ctx: null,
    enabled: true,
    master: null,
    // Geraeusche des Levels (Pfeilfallen, Bruchbloecke). Der Spielcontroller
    // schaltet sie ausserhalb von Bau- und Partyphase ab - nach dem Match
    // soll nichts mehr weiterpiepen.
    ambient: true,

    init: function () {
      if (this.ctx) { return; }
      var Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) { this.enabled = false; return; }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
    },

    resume: function () {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') { this.ctx.resume(); }
    },

    setEnabled: function (on) {
      this.enabled = !!on;
      if (this.master) { this.master.gain.value = on ? 0.28 : 0; }
    },

    /** Ein Ton mit Huellkurve. */
    tone: function (opts) {
      if (!this.enabled) { return; }
      this.init();
      if (!this.ctx) { return; }
      var ctx = this.ctx;
      var now = ctx.currentTime;
      var dur = opts.dur || 0.12;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = opts.type || 'square';
      osc.frequency.setValueAtTime(opts.from || 440, now);
      if (opts.to) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), now + dur);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(opts.vol || 0.3, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    },

    noise: function (dur, vol) {
      if (!this.enabled) { return; }
      this.init();
      if (!this.ctx) { return; }
      var ctx = this.ctx;
      var len = Math.floor(ctx.sampleRate * (dur || 0.2));
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      gain.gain.value = vol || 0.22;
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(this.master);
      src.start();
    },

    jump: function () { this.tone({ type: 'square', from: 330, to: 620, dur: 0.11, vol: 0.18 }); },
    bounce: function () { this.tone({ type: 'sine', from: 240, to: 880, dur: 0.18, vol: 0.26 }); },
    die: function () { this.tone({ type: 'sawtooth', from: 420, to: 60, dur: 0.35, vol: 0.25 }); this.noise(0.25, 0.18); },
    goal: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { self.tone({ type: 'triangle', from: f, dur: 0.16, vol: 0.26 }); }, i * 85);
      });
    },
    place: function () { this.tone({ type: 'triangle', from: 180, to: 120, dur: 0.1, vol: 0.25 }); },
    select: function () { this.tone({ type: 'square', from: 700, dur: 0.05, vol: 0.12 }); },
    deny: function () { this.tone({ type: 'square', from: 180, to: 90, dur: 0.14, vol: 0.2 }); },
    tick: function () { this.tone({ type: 'sine', from: 880, dur: 0.07, vol: 0.16 }); },
    start: function () { this.tone({ type: 'sine', from: 1320, dur: 0.22, vol: 0.22 }); },
    shoot: function () {
      if (this.ambient) { this.tone({ type: 'sawtooth', from: 900, to: 400, dur: 0.07, vol: 0.1 }); }
    },
    crumble: function () {
      if (this.ambient) { this.noise(0.18, 0.14); }
    },
    /** Spielautomat: Walze rattert, Walze rastet ein, alles steht. */
    spin: function () { this.tone({ type: 'square', from: 520 + Math.random() * 180, dur: 0.025, vol: 0.05 }); },
    reel: function (i) { this.tone({ type: 'triangle', from: 440 + i * 110, to: 330 + i * 110, dur: 0.09, vol: 0.22 }); },
    jackpot: function () {
      var self = this;
      [784, 1047].forEach(function (f, i) {
        setTimeout(function () { self.tone({ type: 'triangle', from: f, dur: 0.12, vol: 0.2 }); }, i * 70);
      });
    },
    win: function () {
      var self = this;
      [523, 659, 784, 1047, 1319].forEach(function (f, i) {
        setTimeout(function () { self.tone({ type: 'triangle', from: f, dur: 0.3, vol: 0.28 }); }, i * 130);
      });
    }
  };
}(window));
