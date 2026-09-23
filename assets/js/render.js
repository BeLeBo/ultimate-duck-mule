/* Alles, was auf die Canvas kommt. Keine Bilddateien - alles gezeichnet. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;
  var DIRS = UDM.DIRS;

  /* Die Huegel sind bewusst dunstig und blaustichig gehalten: sie duerfen
   * nie mit dem begehbaren Gelaende verwechselt werden. */
  /* Gelaende-Paletten: Oberkante (hell/dunkel), Koerper, Fels, Einweg. */
  var GRASS = { top: '#7fd96a', topDark: '#5fbf52', body: '#8a5a35', rock: '#58607a', rockTop: '#6e7793', plank: '#a9743f' };

  var THEMES = {
    day: { sky: ['#6fbdec', '#c4e9fb'], hill: '#7ba9c9', hillDark: '#5f8fb4', star: null, sun: '#fff4bd', pit: 'rgba(12,18,40,0.5)', ground: GRASS },
    dusk: { sky: ['#f79d65', '#5b4382'], hill: '#6d4f80', hillDark: '#4e3865', star: 'rgba(255,255,255,0.5)', sun: '#ffd6a5', pit: 'rgba(12,8,30,0.55)', ground: GRASS },
    night: { sky: ['#0d1836', '#26325f'], hill: '#1b2748', hillDark: '#131c36', star: 'rgba(255,255,255,0.85)', sun: '#e8eeff', pit: 'rgba(2,4,14,0.6)', ground: GRASS },
    sunset: { sky: ['#ff8f6b', '#ffd9a0'], hill: '#b3697c', hillDark: '#8b4f66', star: null, sun: '#fff1c1', pit: 'rgba(30,10,30,0.5)', ground: GRASS },
    ice: {
      sky: ['#9fd4f5', '#eaf7ff'], hill: '#b7d3ea', hillDark: '#9bbcd8', star: null, sun: '#ffffff',
      pit: 'rgba(20,50,90,0.45)',
      ground: { top: '#ffffff', topDark: '#dcefff', body: '#8fb8d8', rock: '#6f8aa8', rockTop: '#9db4cc', plank: '#b8d6ee' }
    },
    desert: {
      sky: ['#ffbf6b', '#fff0cc'], hill: '#e3b77a', hillDark: '#cf9d5e', star: null, sun: '#fff6d8',
      pit: 'rgba(70,35,10,0.45)',
      ground: { top: '#f8e0a0', topDark: '#ecc778', body: '#d6a45a', rock: '#c28e52', rockTop: '#dcae70', plank: '#a8773f' }
    },
    lava: {
      sky: ['#1e0a0d', '#4d1612'], hill: '#3a1512', hillDark: '#2a0f0d', star: 'rgba(255,150,80,0.6)', sun: '#ff8a3d',
      pit: 'rgba(255,70,20,0.55)', lava: true,
      ground: { top: '#ff7a2f', topDark: '#4b3434', body: '#3a2a2a', rock: '#2f2525', rockTop: '#5a3a30', plank: '#6b4a3a' }
    },
    castle: {
      sky: ['#56688e', '#c2cde2'], hill: '#4d5a74', hillDark: '#3e4960', star: null, sun: '#f1f4ff',
      pit: 'rgba(10,14,30,0.5)', bricks: true,
      ground: { top: '#a7abb4', topDark: '#8d919b', body: '#6d717b', rock: '#5f6572', rockTop: '#7b8290', plank: '#7a5a3c' }
    }
  };

  UDM.THEMES = THEMES;

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  var Render = {
    shake: 0,
    shakeTime: 0,

    kick: function (amount) {
      this.shake = Math.min(14, this.shake + amount);
    },

    /** Zeichnet ein komplettes Bild. */
    draw: function (ctx, state) {
      var level = state.level;
      var time = state.time || 0;
      var w = UDM.worldWidth();
      var h = UDM.worldHeight();

      ctx.save();
      if (this.shake > 0.3) {
        this.shakeTime += 0.016;
        ctx.translate(
          Math.cos(this.shakeTime * 47) * this.shake,
          Math.sin(this.shakeTime * 39) * this.shake
        );
        this.shake *= 0.88;
      } else {
        this.shake = 0;
      }

      this.drawSky(ctx, level, w, h, time);
      this.drawTerrain(ctx, level);
      this.drawSafeZone(ctx, level, time);
      this.drawBounds(ctx, w, h);
      this.drawStreams(ctx, level, time);
      this.drawBlocks(ctx, level, time);
      this.drawGoal(ctx, level, time);
      this.drawSaws(ctx, level);
      this.drawWreckers(ctx, level);
      this.drawProjectiles(ctx, level);
      this.drawParticles(ctx, level);

      var players = state.players || [];
      for (var i = 0; i < players.length; i++) {
        this.drawPlayer(ctx, players[i], time, state.showNames);
      }

      if (state.build) { this.drawBuildOverlay(ctx, state); }
      ctx.restore();
    },

    /* ----------------------------------------------------------- Kulisse */

    drawSky: function (ctx, level, w, h, time) {
      var theme = THEMES[level.def.theme] || THEMES.day;
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, theme.sky[0]);
      grad.addColorStop(1, theme.sky[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      var rand = UDM.rng(level.def.id.length * 7919 + 13);

      if (theme.star) {
        ctx.fillStyle = theme.star;
        for (var s = 0; s < 70; s++) {
          var sx = rand() * w;
          var sy = rand() * h * 0.6;
          var twinkle = 0.5 + 0.5 * Math.sin(time * 2 + sx);
          ctx.globalAlpha = 0.3 + twinkle * 0.7;
          ctx.fillRect(sx, sy, 2, 2);
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = theme.sun;
      ctx.beginPath();
      ctx.arc(w * 0.82, h * 0.16, 42, 0, Math.PI * 2);
      ctx.fill();

      // Zwei Huegelreihen als Tiefe - halbtransparent, damit sie im Dunst
      // verschwimmen und nicht wie Boden wirken.
      ctx.globalAlpha = 0.5;
      this.drawHills(ctx, w, h, theme.hillDark, h * 0.68, 80, rand);
      ctx.globalAlpha = 0.6;
      this.drawHills(ctx, w, h, theme.hill, h * 0.78, 100, rand);
      ctx.globalAlpha = 1;

      // Der untere Bildrand wird abgedunkelt: so liest sich jede Luecke im
      // Gelaende sofort als Abgrund.
      var pit = ctx.createLinearGradient(0, h * 0.55, 0, h);
      pit.addColorStop(0, 'rgba(0,0,0,0)');
      pit.addColorStop(1, theme.pit);
      ctx.fillStyle = pit;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      if (theme.lava) { this.drawLava(ctx, w, h, time); }

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (var c = 0; c < 5; c++) {
        var cx = (rand() * w + time * (8 + c * 3)) % (w + 220) - 110;
        var cy = 50 + rand() * 180;
        this.drawCloud(ctx, cx, cy, 34 + rand() * 26);
      }
    },

    /** Die Startzone als sanft schimmernder Schutzraum. */
    drawSafeZone: function (ctx, level, time) {
      var r = level.safeRect();
      var pulse = 0.05 + 0.025 * Math.sin(time * 2.2);
      ctx.save();
      ctx.fillStyle = 'rgba(160,230,255,' + pulse + ')';
      roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10);
      ctx.fill();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(190,240,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 1;
    },

    /** Wabernde Lava am Boden des Vulkans - liegt hinter dem Gelaende. */
    drawLava: function (ctx, w, h, time) {
      var layers = [
        { color: '#b8260f', base: 30, amp: 5, speed: 1.3, len: 55 },
        { color: '#ff5a1f', base: 20, amp: 4, speed: 2.1, len: 38 },
        { color: 'rgba(255,190,70,0.55)', base: 11, amp: 3, speed: 2.9, len: 26 }
      ];
      layers.forEach(function (layer) {
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x <= w; x += 16) {
          ctx.lineTo(x, h - layer.base - Math.sin(x / layer.len + time * layer.speed) * layer.amp);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });
    },

    /**
     * Kleine Vorschau einer Welt fuer die Weltauswahl im Menue: Himmel,
     * Gelaende, Start und Ziel - alles aus denselben Funktionen wie im Spiel.
     */
    drawPreview: function (canvas, def) {
      var ctx = canvas.getContext('2d');
      var level = new UDM.Level(def);
      var w = UDM.worldWidth();
      var h = UDM.worldHeight();
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(canvas.width / w, canvas.height / h);
      this.drawSky(ctx, level, w, h, 0);
      this.drawTerrain(ctx, level);
      this.drawGoal(ctx, level, 0);

      // Startplatz als Farbpunkte der vier Spieler.
      for (var i = 0; i < 4; i++) {
        var sp = level.spawnPoint(i);
        ctx.fillStyle = UDM.slotColor(i);
        ctx.beginPath();
        ctx.arc(sp.x + 11, sp.y + 13, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    /**
     * Symbol eines Bauteils fuer Handkarten und Regelliste. Grosse Teile
     * werden so verkleinert, dass sie komplett ins Symbol passen.
     */
    drawCardIcon: function (canvas, type, rot, time) {
      var spec = UDM.BLOCKS[type];
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!spec) {
        this.drawPowerIcon(ctx, canvas, type);
        return;
      }
      var bw = spec.w || 1;
      var bh = spec.h || 1;
      var scale = Math.min(canvas.width - 8, canvas.height - 8) / (Math.max(bw, bh) * TILE);
      ctx.save();
      ctx.translate((canvas.width - bw * TILE * scale) / 2, (canvas.height - bh * TILE * scale) / 2);
      ctx.scale(scale, scale);
      this.drawBlock(ctx, {
        type: type, tx: 0, ty: 0, w: bw, h: bh,
        rot: spec.rotatable ? (rot || 0) : 0,
        spec: spec, broken: false, touch: -1, shake: 0, id: 1
      }, 0, 0, time || 0);
      ctx.restore();
    },

    /** Symbole der Power-up-Karten. */
    drawPowerIcon: function (ctx, canvas, type) {
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var u = Math.min(w, h) / 40;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (type === 'pu_djump') {
        // Zwei Pfeilspitzen nach oben ueber einem Woelkchen
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 14 * u, 10 * u, 3.5 * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7ef08a';
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.moveTo(cx - 10 * u, cy + 8 * u);
        ctx.lineTo(cx, cy - 1 * u);
        ctx.lineTo(cx + 10 * u, cy + 8 * u);
        ctx.moveTo(cx - 10 * u, cy - 4 * u);
        ctx.lineTo(cx, cy - 13 * u);
        ctx.lineTo(cx + 10 * u, cy - 4 * u);
        ctx.stroke();
      } else if (type === 'pu_shield') {
        // Wappenschild
        ctx.beginPath();
        ctx.moveTo(cx, cy - 15 * u);
        ctx.quadraticCurveTo(cx + 7 * u, cy - 10 * u, cx + 13 * u, cy - 11 * u);
        ctx.quadraticCurveTo(cx + 13 * u, cy + 6 * u, cx, cy + 15 * u);
        ctx.quadraticCurveTo(cx - 13 * u, cy + 6 * u, cx - 13 * u, cy - 11 * u);
        ctx.quadraticCurveTo(cx - 7 * u, cy - 10 * u, cx, cy - 15 * u);
        ctx.closePath();
        ctx.fillStyle = '#4aa8ff';
        ctx.fill();
        ctx.strokeStyle = '#d8f0ff';
        ctx.lineWidth = 2.5 * u;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(cx - 2 * u, cy - 10 * u, 4 * u, 20 * u);
      } else if (type === 'pu_speed') {
        // Blitz mit Tempostreifen
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.moveTo(cx - 17 * u, cy - 6 * u); ctx.lineTo(cx - 9 * u, cy - 6 * u);
        ctx.moveTo(cx - 19 * u, cy + 1 * u); ctx.lineTo(cx - 11 * u, cy + 1 * u);
        ctx.moveTo(cx - 17 * u, cy + 8 * u); ctx.lineTo(cx - 9 * u, cy + 8 * u);
        ctx.stroke();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(cx + 5 * u, cy - 16 * u);
        ctx.lineTo(cx - 7 * u, cy + 2 * u);
        ctx.lineTo(cx + 1 * u, cy + 2 * u);
        ctx.lineTo(cx - 2 * u, cy + 16 * u);
        ctx.lineTo(cx + 11 * u, cy - 3 * u);
        ctx.lineTo(cx + 3 * u, cy - 3 * u);
        ctx.closePath();
        ctx.fill();
      } else if (type === 'pu_glide') {
        // Schirm
        ctx.fillStyle = '#ff8fb0';
        ctx.beginPath();
        ctx.arc(cx, cy - 1 * u, 15 * u, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd1df';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 16 * u);
        ctx.lineTo(cx - 5 * u, cy - 1 * u);
        ctx.lineTo(cx + 5 * u, cy - 1 * u);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#e8e8f0';
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 1 * u);
        ctx.lineTo(cx, cy + 12 * u);
        ctx.quadraticCurveTo(cx, cy + 16 * u, cx - 4 * u, cy + 15 * u);
        ctx.stroke();
      } else if (type === 'pu_remove') {
        // Abrissbirne an der Kette
        ctx.strokeStyle = '#8b92a5';
        ctx.lineWidth = 2.5 * u;
        ctx.beginPath();
        ctx.moveTo(cx - 12 * u, cy - 15 * u);
        ctx.lineTo(cx + 2 * u, cy + 1 * u);
        ctx.stroke();
        ctx.fillStyle = '#4b5162';
        ctx.beginPath();
        ctx.arc(cx + 5 * u, cy + 5 * u, 9 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff6f7d';
        ctx.fillRect(cx + 1 * u, cy + 4 * u, 8 * u, 2.5 * u);
      }
      ctx.restore();
    },

    /** Unsichtbare Wand links und rechts - hier wird sie sichtbar gemacht. */
    drawBounds: function (ctx, w, h) {
      var width = 16;
      ctx.save();

      // Dunkler Verlauf nach innen - sichtbar auf hellem wie dunklem Himmel.
      ['left', 'right'].forEach(function (side) {
        var outer = side === 'left' ? 0 : w;
        var inner = side === 'left' ? width : w - width;
        var grad = ctx.createLinearGradient(outer, 0, inner, 0);
        grad.addColorStop(0, 'rgba(10,12,26,0.42)');
        grad.addColorStop(1, 'rgba(10,12,26,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(Math.min(outer, inner), 0, width, h);
      });

      // Schraffur in Warnfarbe, damit es nach Absperrung aussieht.
      ctx.beginPath();
      ctx.rect(0, 0, width, h);
      ctx.rect(w - width, 0, width, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,220,120,0.3)';
      ctx.lineWidth = 4;
      for (var y = -width * 2; y < h + width; y += 18) {
        ctx.beginPath();
        ctx.moveTo(-2, y); ctx.lineTo(width + 2, y + width + 4);
        ctx.moveTo(w - width - 2, y); ctx.lineTo(w + 2, y + width + 4);
        ctx.stroke();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(255,220,120,0.55)';
      ctx.fillRect(0, 0, 3, h);
      ctx.fillRect(w - 3, 0, 3, h);
      ctx.lineWidth = 1;
    },

    drawHills: function (ctx, w, h, color, baseY, amp, rand) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      var seedA = rand() * 10;
      var seedB = rand() * 10;
      for (var x = 0; x <= w; x += 16) {
        var y = baseY - Math.sin(x / 190 + seedA) * amp * 0.5 - Math.sin(x / 70 + seedB) * amp * 0.18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    },

    drawCloud: function (ctx, x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.arc(x + r * 0.6, y + r * 0.1, r * 0.45, 0, Math.PI * 2);
      ctx.arc(x - r * 0.6, y + r * 0.12, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    },

    /* ---------------------------------------------------------- Gelaende */

    drawTerrain: function (ctx, level) {
      var theme = THEMES[level.def.theme] || THEMES.day;
      var pal = theme.ground;
      for (var ty = 0; ty < level.rows; ty++) {
        for (var tx = 0; tx < level.cols; tx++) {
          var cell = level.cell(tx, ty);
          if (!cell || cell.kind !== 'terrain') { continue; }
          var x = tx * TILE;
          var y = ty * TILE;

          if (cell.type === 'oneway') {
            ctx.fillStyle = pal.plank;
            roundRect(ctx, x, y + 6, TILE, 10, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(x, y + 6, TILE, 3);
            continue;
          }

          var top = level.cell(tx, ty - 1);
          var isTop = !top || top.kind !== 'terrain';
          if (cell.type === 'rock') {
            ctx.fillStyle = pal.rock;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y, TILE, 4);
            if (theme.bricks) {
              // Burgstein: versetzte Mauerfugen statt Flecken.
              ctx.strokeStyle = 'rgba(0,0,0,0.22)';
              ctx.beginPath();
              ctx.moveTo(x, y + 16.5); ctx.lineTo(x + TILE, y + 16.5);
              var off = (ty % 2) * 16;
              ctx.moveTo(x + off + 0.5, y); ctx.lineTo(x + off + 0.5, y + 16);
              ctx.moveTo(x + ((off + 16) % 32) + 0.5, y + 16); ctx.lineTo(x + ((off + 16) % 32) + 0.5, y + TILE);
              ctx.stroke();
            } else {
              ctx.fillStyle = 'rgba(0,0,0,0.13)';
              ctx.fillRect(x + ((tx * 7 + ty * 13) % 18), y + ((tx * 5 + ty * 3) % 20), 7, 6);
            }
            if (isTop) {
              ctx.fillStyle = pal.rockTop;
              ctx.fillRect(x, y, TILE, 5);
              if (theme.lava) {
                ctx.fillStyle = 'rgba(255,120,40,0.75)';
                ctx.fillRect(x, y, TILE, 2);
              }
            }
          } else {
            ctx.fillStyle = pal.body;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(x + ((tx * 11 + ty * 5) % 20), y + 10 + ((tx * 3 + ty * 7) % 14), 6, 5);
            if (isTop) {
              ctx.fillStyle = pal.topDark;
              ctx.fillRect(x, y, TILE, 8);
              ctx.fillStyle = pal.top;
              ctx.fillRect(x, y, TILE, 4);
            }
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.08)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }
    },

    /* --------------------------------------------------------- Bauteile */

    drawBlocks: function (ctx, level, time) {
      for (var i = 0; i < level.blocks.length; i++) {
        var cell = level.blocks[i];
        var x = cell.tx * TILE;
        var y = cell.ty * TILE;
        var spanW = (cell.w || 1) * TILE;

        ctx.save();
        if (cell.spec.crumble && cell.touch >= 0 && !cell.broken) {
          ctx.translate(Math.sin(time * 60) * 1.6 * cell.shake, 0);
        }
        if (cell.broken) {
          ctx.globalAlpha = 0.16;
        }
        this.drawBlock(ctx, cell, x, y, time);
        ctx.restore();

        if (!cell.broken && cell.spec.rotatable) {
          this.drawDirectionBadge(ctx, x, y, cell.rot);
        }

        if (!cell.broken && cell.ownerSlot >= 0) {
          ctx.fillStyle = UDM.slotColor(cell.ownerSlot);
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x + spanW - 6, y + 1, 5, 5);
          ctx.globalAlpha = 1;
        }
      }
    },

    /** Kleiner Pfeil an der Kachelkante: in diese Richtung wirkt das Bauteil. */
    drawDirectionBadge: function (ctx, x, y, rot, strong) {
      var dir = DIRS[rot] || DIRS[0];
      var inset = strong ? 6 : 7;
      var cx = Math.round(x + TILE / 2 + dir.dx * (TILE / 2 - inset));
      var cy = Math.round(y + TILE / 2 + dir.dy * (TILE / 2 - inset));

      var size = strong ? 8 : 6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot * Math.PI / 2);

      // Heller Pfeil mit dunkler Kontur - so bleibt er auf jedem Bauteil
      // lesbar. Die Form ist um ihre eigene Mitte gezeichnet, damit sie nicht
      // gegenueber der Kachelkante verrutscht.
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.75);
      ctx.lineTo(size * 0.8, size * 0.45);
      ctx.lineTo(0, size * 0.1);
      ctx.lineTo(-size * 0.8, size * 0.45);
      ctx.closePath();
      ctx.fillStyle = strong ? '#ffe08a' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = 'rgba(15,17,28,0.8)';
      ctx.lineWidth = strong ? 2 : 1.4;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    },

    drawBlock: function (ctx, cell, x, y, time) {
      var fn = this.blockPainters[cell.type];
      if (fn) { fn.call(this, ctx, x, y, cell, time); }
    },

    /** Massiver Block beliebiger Groesse mit Fugenraster. */
    solidBlock: function (ctx, x, y, w, h, top, body, edge) {
      ctx.fillStyle = edge;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = body;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 6);
      ctx.fillStyle = top;
      ctx.fillRect(x + 2, y + 2, w - 4, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 2, y + h - 6, w - 4, 4);

      // Fugen entlang des Kachelrasters, damit die Groesse ablesbar bleibt.
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      for (var gx = TILE; gx < w; gx += TILE) {
        ctx.moveTo(x + gx + 0.5, y + 3); ctx.lineTo(x + gx + 0.5, y + h - 3);
      }
      for (var gy = TILE; gy < h; gy += TILE) {
        ctx.moveTo(x + 3, y + gy + 0.5); ctx.lineTo(x + w - 3, y + gy + 0.5);
      }
      ctx.stroke();

      ctx.strokeStyle = edge;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    },

    blockPainters: {
      stone: function (ctx, x, y) {
        this.solidBlock(ctx, x, y, TILE, TILE, '#c3cad6', '#b6bdc9', '#6f7787');
      },
      beam: function (ctx, x, y, cell) {
        this.solidBlock(ctx, x, y, (cell.w || 3) * TILE, (cell.h || 1) * TILE,
          '#d8b98a', '#c2a074', '#7c6243');
      },
      wall: function (ctx, x, y, cell) {
        this.solidBlock(ctx, x, y, (cell.w || 1) * TILE, (cell.h || 3) * TILE,
          '#b9c0cd', '#a4abba', '#646b7d');
      },
      slab: function (ctx, x, y, cell) {
        this.solidBlock(ctx, x, y, (cell.w || 2) * TILE, (cell.h || 2) * TILE,
          '#9ea6b4', '#8d94a3', '#5b6272');
      },
      ice: function (ctx, x, y) {
        ctx.fillStyle = 'rgba(150, 220, 255, 0.85)';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(x + 4, y + TILE - 5);
        ctx.lineTo(x + 14, y + 4);
        ctx.lineTo(x + 19, y + 4);
        ctx.lineTo(x + 9, y + TILE - 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      },
      bounce: function (ctx, x, y, cell, time) {
        var squish = 1 + Math.sin(time * 4 + cell.tx) * 0.04;
        ctx.fillStyle = '#2f9e5e';
        ctx.fillRect(x, y + TILE - 10, TILE, 10);
        ctx.fillStyle = '#54d98c';
        roundRect(ctx, x + 1, y + 4 * squish, TILE - 2, TILE - 12, 7);
        ctx.fill();
        ctx.strokeStyle = '#1f7a45';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i < 3; i++) {
          ctx.moveTo(x + 5 + i * 8, y + TILE - 10);
          ctx.lineTo(x + 9 + i * 8, y + TILE - 3);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      },
      crumble: function (ctx, x, y) {
        ctx.fillStyle = '#b07b45';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#cf9a5e';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 6);
        ctx.strokeStyle = 'rgba(70,40,15,0.65)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x + 6, y); ctx.lineTo(x + 12, y + 13); ctx.lineTo(x + 7, y + TILE);
        ctx.moveTo(x + 22, y + 2); ctx.lineTo(x + 17, y + 16); ctx.lineTo(x + 24, y + TILE);
        ctx.stroke();
        ctx.lineWidth = 1;
      },
      oil: function (ctx, x, y, cell, time) {
        // Liegt flach am Boden der Kachel, schimmert leicht.
        var base = y + TILE - 9;
        ctx.fillStyle = 'rgba(18,16,30,0.85)';
        ctx.beginPath();
        ctx.ellipse(x + TILE / 2, base + 5, TILE / 2 - 1, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,90,180,0.55)';
        ctx.beginPath();
        ctx.ellipse(x + 11 + Math.sin(time * 1.6 + cell.tx) * 2, base + 3.5, 5, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(90,190,200,0.4)';
        ctx.beginPath();
        ctx.ellipse(x + 21, base + 6, 4, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      },
      conveyor: function (ctx, x, y, cell, time) {
        var dir = cell.rot === 3 ? -1 : 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, TILE, TILE);
        ctx.clip();
        ctx.fillStyle = '#3b3f4a';
        ctx.fillRect(x, y + 4, TILE, TILE - 8);
        ctx.fillStyle = '#2a2d36';
        ctx.fillRect(x, y + 4, TILE, 4);
        ctx.fillStyle = '#ffb703';
        var offset = (time * 90 * dir) % 16;
        for (var i = -1; i < 3; i++) {
          var cx = x + i * 16 + (offset + 16) % 16;
          ctx.beginPath();
          if (dir > 0) {
            ctx.moveTo(cx, y + 11); ctx.lineTo(cx + 8, y + 16); ctx.lineTo(cx, y + 21);
          } else {
            ctx.moveTo(cx + 8, y + 11); ctx.lineTo(cx, y + 16); ctx.lineTo(cx + 8, y + 21);
          }
          ctx.fill();
        }
        ctx.fillStyle = '#5a6070';
        ctx.fillRect(x, y + TILE - 5, TILE, 5);
        ctx.restore();
      },
      honey: function (ctx, x, y, cell, time) {
        ctx.fillStyle = '#e0a53c';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#f7c76a';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#c98a24';
        for (var i = 0; i < 3; i++) {
          var dx = x + 6 + i * 10;
          var drip = 4 + Math.sin(time * 2 + i * 2) * 2;
          ctx.beginPath();
          ctx.arc(dx, y + TILE - 2 + drip * 0.4, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      wrecker: function (ctx, x, y) {
        // Nur der Anker - Kette und Kugel zeichnet drawWreckers().
        ctx.fillStyle = '#4a4f5e';
        roundRect(ctx, x + 5, y + 4, TILE - 10, TILE - 12, 4);
        ctx.fill();
        ctx.fillStyle = '#767d90';
        ctx.fillRect(x + 8, y + 7, TILE - 16, 4);
        ctx.fillStyle = '#2c303c';
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE - 8, 4, 0, Math.PI * 2);
        ctx.fill();
      },
      fan: function (ctx, x, y, cell, time) {
        ctx.save();
        ctx.translate(x + TILE / 2, y + TILE / 2);
        ctx.rotate(cell.rot * Math.PI / 2);
        ctx.fillStyle = '#4b5162';
        roundRect(ctx, -TILE / 2 + 1, -TILE / 2 + 1, TILE - 2, TILE - 2, 5);
        ctx.fill();
        ctx.fillStyle = '#2d3140';
        ctx.beginPath();
        ctx.arc(0, -2, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.rotate(time * 16);
        ctx.fillStyle = '#d7dce8';
        for (var b = 0; b < 3; b++) {
          ctx.save();
          ctx.rotate((b * Math.PI * 2) / 3);
          ctx.beginPath();
          ctx.ellipse(0, -6, 3, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        ctx.fillStyle = '#8f98ad';
        ctx.fillRect(-TILE / 2 + 3, TILE / 2 - 7, TILE - 6, 5);
        ctx.restore();
      },
      spike: function (ctx, x, y, cell) {
        ctx.save();
        ctx.translate(x + TILE / 2, y + TILE / 2);
        ctx.rotate(cell.rot * Math.PI / 2);
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(-TILE / 2, TILE / 2 - 6, TILE, 6);
        ctx.fillStyle = '#d9dee8';
        for (var i = 0; i < 4; i++) {
          var sx = -TILE / 2 + 2 + i * 7.5;
          ctx.beginPath();
          ctx.moveTo(sx, TILE / 2 - 6);
          ctx.lineTo(sx + 3.6, TILE / 2 - 19);
          ctx.lineTo(sx + 7.2, TILE / 2 - 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      },
      arrow: function (ctx, x, y, cell) {
        ctx.save();
        ctx.translate(x + TILE / 2, y + TILE / 2);
        ctx.rotate(cell.rot * Math.PI / 2);
        ctx.fillStyle = '#6a4b32';
        roundRect(ctx, -TILE / 2 + 1, -TILE / 2 + 1, TILE - 2, TILE - 2, 4);
        ctx.fill();
        ctx.fillStyle = '#4a3322';
        ctx.fillRect(-TILE / 2 + 3, -TILE / 2 + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = '#20160e';
        ctx.beginPath();
        ctx.arc(0, -TILE / 2 + 7, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(-9, 2, 18, 4);
        ctx.restore();
      },
      saw: function (ctx, x, y) {
        ctx.fillStyle = '#4a4f5e';
        roundRect(ctx, x + 8, y + 8, TILE - 16, TILE - 16, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.strokeRect(x + 8.5, y + 8.5, TILE - 17, TILE - 17);
      }
    },

    /* ----------------------------------------------------- Luft & Saegen */

    drawStreams: function (ctx, level, time) {
      ctx.save();
      for (var i = 0; i < level.streams.length; i++) {
        var s = level.streams[i];
        // Schmales Band statt volle Kachel: benachbarte Segmente wachsen so
        // zu einem durchgehenden Luftstrom zusammen.
        ctx.globalAlpha = 0.05 + s.power * 0.09;
        ctx.fillStyle = '#ffffff';
        if (s.dy !== 0) {
          ctx.fillRect(s.x + 8, s.y, s.w - 16, s.h);
        } else {
          ctx.fillRect(s.x, s.y + 8, s.w, s.h - 16);
        }
        ctx.globalAlpha = 0.3 * s.power;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        var flow = (time * 60) % TILE;
        ctx.beginPath();
        for (var k = 0; k < 2; k++) {
          var off = (flow + k * 16) % TILE;
          if (s.dy !== 0) {
            var yy = s.dy < 0 ? s.y + TILE - off : s.y + off;
            ctx.moveTo(s.x + 8, yy); ctx.lineTo(s.x + TILE - 8, yy);
          } else {
            var xx = s.dx < 0 ? s.x + TILE - off : s.x + off;
            ctx.moveTo(xx, s.y + 8); ctx.lineTo(xx, s.y + TILE - 8);
          }
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.restore();
    },

    drawSaws: function (ctx, level) {
      for (var i = 0; i < level.saws.length; i++) {
        var saw = level.saws[i];

        // Laufschiene, damit man den Pendelweg sieht.
        if (saw.amp > 1) {
          ctx.strokeStyle = 'rgba(30,30,40,0.25)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          if (saw.vertical) {
            ctx.moveTo(saw.fixed, saw.mid - saw.amp);
            ctx.lineTo(saw.fixed, saw.mid + saw.amp);
          } else {
            ctx.moveTo(saw.mid - saw.amp, saw.fixed);
            ctx.lineTo(saw.mid + saw.amp, saw.fixed);
          }
          ctx.stroke();
        }

        ctx.save();
        ctx.translate(saw.x, saw.y);
        ctx.rotate(saw.spin);
        ctx.fillStyle = '#c9ced9';
        ctx.beginPath();
        for (var t = 0; t < 12; t++) {
          var a0 = (t / 12) * Math.PI * 2;
          var a1 = ((t + 0.5) / 12) * Math.PI * 2;
          ctx.lineTo(Math.cos(a0) * saw.radius, Math.sin(a0) * saw.radius);
          ctx.lineTo(Math.cos(a1) * (saw.radius + 5), Math.sin(a1) * (saw.radius + 5));
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7a8090';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.lineWidth = 1;
    },

    drawWreckers: function (ctx, level) {
      for (var i = 0; i < level.wreckers.length; i++) {
        var w = level.wreckers[i];

        // Kette
        ctx.strokeStyle = '#8b92a5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w.ax, w.ay);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w.ax, w.ay);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();

        // Kugel mit Glanzpunkt
        var ball = ctx.createRadialGradient(w.x - 4, w.y - 5, 2, w.x, w.y, w.radius + 2);
        ball.addColorStop(0, '#aeb6c8');
        ball.addColorStop(1, '#4b5162');
        ctx.fillStyle = ball;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,22,32,0.5)';
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
        ctx.stroke();

        // Spitzen, damit sie klar als Gefahr lesbar ist
        ctx.fillStyle = '#d9dee8';
        for (var t = 0; t < 6; t++) {
          var a = (t / 6) * Math.PI * 2 + w.angle;
          ctx.beginPath();
          ctx.moveTo(w.x + Math.cos(a - 0.22) * w.radius, w.y + Math.sin(a - 0.22) * w.radius);
          ctx.lineTo(w.x + Math.cos(a) * (w.radius + 5), w.y + Math.sin(a) * (w.radius + 5));
          ctx.lineTo(w.x + Math.cos(a + 0.22) * w.radius, w.y + Math.sin(a + 0.22) * w.radius);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.lineWidth = 1;
    },

    drawProjectiles: function (ctx, level) {
      for (var i = 0; i < level.projectiles.length; i++) {
        var p = level.projectiles[i];
        ctx.fillStyle = '#5b4327';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#d8dde8';
        if (p.vx !== 0) {
          var tipX = p.vx > 0 ? p.x + p.w : p.x - 5;
          ctx.fillRect(tipX, p.y, 5, p.h);
        } else {
          var tipY = p.vy > 0 ? p.y + p.h : p.y - 5;
          ctx.fillRect(p.x, tipY, p.w, 5);
        }
      }
    },

    drawParticles: function (ctx, level) {
      for (var i = 0; i < level.particles.length; i++) {
        var q = level.particles[i];
        ctx.globalAlpha = UDM.clamp(q.life / q.maxLife, 0, 1);
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x, q.y, q.size, q.size);
      }
      ctx.globalAlpha = 1;
    },

    /* ------------------------------------------------------------- Ziel */

    drawGoal: function (ctx, level, time) {
      var goal = level.def.goal;
      var baseX = goal.x * TILE + TILE / 2;
      var baseY = (goal.y + 1) * TILE;
      var topY = (goal.y - 1) * TILE + 2;

      var glow = 0.4 + 0.15 * Math.sin(time * 3);
      var halo = ctx.createRadialGradient(baseX, baseY - TILE, 4, baseX, baseY - TILE, 42);
      halo.addColorStop(0, 'rgba(255, 240, 150,' + glow + ')');
      halo.addColorStop(1, 'rgba(255, 240, 150, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(baseX, baseY - TILE, 42, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#d8d4c8';
      ctx.fillRect(baseX - 2, topY, 4, baseY - topY);
      ctx.fillStyle = '#9b9384';
      ctx.fillRect(baseX - 9, baseY - 5, 18, 5);

      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(baseX + 2, topY + 2);
      for (var i = 0; i <= 8; i++) {
        var t = i / 8;
        ctx.lineTo(baseX + 2 + t * 26, topY + 2 + Math.sin(time * 6 + t * 5) * 3 + t * 1);
      }
      for (var j = 8; j >= 0; j--) {
        var u = j / 8;
        ctx.lineTo(baseX + 2 + u * 26, topY + 18 + Math.sin(time * 6 + u * 5) * 3 + u * 1);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(baseX + 2, topY + 8, 26, 2);
    },

    /* ----------------------------------------------------------- Figuren */

    drawPlayer: function (ctx, p, time, showNames) {
      var cx = p.x + p.w / 2;
      var bottom = p.y + p.h;
      var squash = p.squash || 1;
      var stretch = 1 / squash;

      if (p.alive && !p.finished) { this.drawBuffsBehind(ctx, p, time); }

      ctx.save();
      // Nach einem Schildtreffer kurz blinken.
      if (p.invuln > 0 && Math.floor(time * 14) % 2 === 0) { ctx.globalAlpha = 0.45; }

      if (!p.alive) {
        var t = UDM.clamp(p.deathTimer / 1.2, 0, 1);
        ctx.globalAlpha = 1 - t * 0.75;
        ctx.translate(cx, bottom - p.h / 2 + t * 10);
        ctx.rotate(t * 1.4);
        ctx.translate(-cx, -(bottom - p.h / 2));
      }

      // Schatten
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(cx, bottom + 2, p.w * 0.45, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      var bodyH = p.h * 0.66 * stretch;
      var bodyW = p.w * squash;
      var bodyY = bottom - bodyH;

      // Beine
      var legPhase = p.anim === 'run' ? Math.sin(p.animTime * 16) : 0;
      ctx.fillStyle = p.dark;
      ctx.fillRect(cx - 6, bottom - 5 + legPhase * 2, 4, 5);
      ctx.fillRect(cx + 2, bottom - 5 - legPhase * 2, 4, 5);

      // Koerper
      ctx.fillStyle = p.color;
      roundRect(ctx, cx - bodyW / 2, bodyY, bodyW, bodyH, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      roundRect(ctx, cx - bodyW / 2 + 2, bodyY + 2, bodyW - 4, bodyH * 0.45, 5);
      ctx.fill();

      var headR = p.w * 0.42;
      var headY = bodyY - headR * 0.55 + (p.anim === 'jump' ? -1 : 0);
      this.drawHead(ctx, p, cx, headY, headR, time);

      if (p.finished) {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        var cw = headR + 3;
        ctx.moveTo(cx - cw, headY - headR - 4);
        ctx.lineTo(cx - cw * 0.4, headY - headR - 11);
        ctx.lineTo(cx, headY - headR - 4);
        ctx.lineTo(cx + cw * 0.4, headY - headR - 11);
        ctx.lineTo(cx + cw, headY - headR - 4);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();

      if (p.alive && !p.finished) { this.drawBuffsFront(ctx, p, time); }

      if (showNames) {
        var labelY = p.y - 12 - (p.slot % 4) * 11;
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillText(p.name, cx + 1, labelY + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.name, cx, labelY);
        ctx.textAlign = 'left';
      }
    },

    /** Turbo-Streifen hinter der Figur. */
    drawBuffsBehind: function (ctx, p, time) {
      var turbo = (p.speedMul || 1) > 1 || (p.remote && p.buffs && p.buffs.indexOf('pu_speed') >= 0);
      if (!turbo || Math.abs(p.vx || 0) < 150) { return; }
      var dir = p.vx > 0 ? -1 : 1;
      var back = dir < 0 ? p.x : p.x + p.w;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,210,63,0.75)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var y = p.y + 6 + i * 7;
        var len = 8 + ((time * 40 + i * 5) % 8);
        ctx.beginPath();
        ctx.moveTo(back + dir * 3, y);
        ctx.lineTo(back + dir * (3 + len), y);
        ctx.stroke();
      }
      ctx.restore();
    },

    /** Schildblase und Gleitschirm vor der Figur. */
    drawBuffsFront: function (ctx, p, time) {
      var cx = p.x + p.w / 2;
      var cy = p.y + p.h / 2;

      if (p.anim === 'glide') {
        var top = p.y - 22;
        ctx.save();
        ctx.strokeStyle = 'rgba(235,235,245,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 15, top); ctx.lineTo(cx - 4, p.y + 4);
        ctx.moveTo(cx + 15, top); ctx.lineTo(cx + 4, p.y + 4);
        ctx.moveTo(cx, top - 2); ctx.lineTo(cx, p.y + 2);
        ctx.stroke();
        ctx.fillStyle = '#ff8fb0';
        ctx.beginPath();
        ctx.arc(cx, top + 2, 17, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(cx, top - 15);
        ctx.lineTo(cx - 5, top + 2);
        ctx.lineTo(cx + 5, top + 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (p.shield > 0) {
        var r = Math.max(p.w, p.h) * 0.78 + Math.sin(time * 5) * 1.2;
        ctx.save();
        ctx.fillStyle = 'rgba(120,195,255,0.13)';
        ctx.strokeStyle = 'rgba(150,215,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(cx, cy, r - 4, -2.4, -1.6);
        ctx.stroke();
        ctx.restore();
      }
    },

    drawHead: function (ctx, p, cx, cy, r, time) {
      var face = p.face || 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(face, 1);

      if (p.char === 'mule') {
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.ellipse(-r * 0.45, -r * 1.05, r * 0.24, r * 0.62, -0.25, 0, Math.PI * 2);
        ctx.ellipse(r * 0.1, -r * 1.15, r * 0.24, r * 0.62, 0.12, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.char === 'racoon') {
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.arc(-r * 0.62, -r * 0.62, r * 0.32, 0, Math.PI * 2);
        ctx.arc(r * 0.62, -r * 0.62, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.char === 'frog') {
        // Glubschaugen sitzen als Hoecker oben auf dem Kopf.
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(-r * 0.2, -r * 0.8, r * 0.42, 0, Math.PI * 2);
        ctx.arc(r * 0.45, -r * 0.8, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, -r * 0.95);
        ctx.quadraticCurveTo(r * 0.3, -r * 1.75, r * 0.75, -r * 1.15);
        ctx.quadraticCurveTo(r * 0.25, -r * 1.1, r * 0.1, -r * 0.85);
        ctx.fill();
      }

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      if (p.char === 'racoon') {
        ctx.fillStyle = 'rgba(40,40,55,0.8)';
        roundRect(ctx, -r * 0.95, -r * 0.3, r * 1.9, r * 0.6, 3);
        ctx.fill();
      }

      // Schnauze / Schnabel
      if (p.char === 'duck') {
        ctx.fillStyle = '#ff9f1c';
        roundRect(ctx, r * 0.45, -r * 0.1, r * 0.95, r * 0.42, 3);
        ctx.fill();
      } else if (p.char === 'mule') {
        ctx.fillStyle = '#f0e0c8';
        ctx.beginPath();
        ctx.ellipse(r * 0.7, r * 0.12, r * 0.5, r * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7a5a45';
        ctx.beginPath();
        ctx.arc(r * 0.82, r * 0.08, 1.6, 0, Math.PI * 2);
        ctx.arc(r * 0.6, r * 0.14, 1.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.char === 'frog') {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r * 0.2, r * 0.1, r * 0.62, 0.15 * Math.PI, 0.75 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = '#3a3a48';
        ctx.beginPath();
        ctx.arc(r * 0.78, r * 0.05, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Augen
      var blink = (Math.sin(time * 2.1 + p.slot * 3) > 0.985) ? 0.15 : 1;
      var eyeX = p.char === 'duck' ? r * 0.28 : (p.char === 'frog' ? r * 0.45 : r * 0.3);
      var eyeY = p.char === 'frog' ? -r * 0.82 : -r * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, r * 0.26, r * 0.3 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!p.alive) {
        ctx.strokeStyle = '#2b2b33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(eyeX - 4, eyeY - r * 0.25); ctx.lineTo(eyeX + 4, eyeY + r * 0.18);
        ctx.moveTo(eyeX + 4, eyeY - r * 0.25); ctx.lineTo(eyeX - 4, eyeY + r * 0.18);
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = '#20222b';
        ctx.beginPath();
        ctx.ellipse(eyeX + 2, eyeY, r * 0.13, r * 0.18 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },

    /* --------------------------------------------------------- Bauphase */

    /** Wie weit reicht etwas von dieser Kachel aus in Richtung dir? */
    reach: function (level, tx, ty, dir, max) {
      var count = 0;
      for (var i = 1; i <= max; i++) {
        var x = tx + dir.dx * i;
        var y = ty + dir.dy * i;
        if (!level.inBounds(x, y) || level.isSolid(x, y)) { break; }
        count = i;
      }
      return count;
    },

    /** Pfeilspitze, deren Mitte genau auf (x, y) liegt. */
    arrowHead: function (ctx, x, y, dir, size) {
      var angle = Math.atan2(dir.dy, dir.dx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      // Schwerpunkt nach hinten schieben, sonst sitzt die Spitze versetzt.
      ctx.beginPath();
      ctx.moveTo(size * 0.85, 0);
      ctx.lineTo(-size * 0.85, size * 0.75);
      ctx.lineTo(-size * 0.85, -size * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },

    /**
     * Zeigt vor dem Setzen, was das Bauteil anrichtet: Reichweite des
     * Luftstroms, Schussbahn, Pendelweg, Saegenschiene, Rutschrichtung.
     */
    effectHints: {
      fan: function (ctx, level, tx, ty, rot, time) {
        var dir = DIRS[rot];
        var count = this.reach(level, tx, ty, dir, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        for (var i = 1; i <= count; i++) {
          var x = (tx + dir.dx * i) * TILE;
          var y = (ty + dir.dy * i) * TILE;
          ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        }
        ctx.fillStyle = '#ffffff';
        for (var k = 1; k <= count; k++) {
          this.arrowHead(ctx,
            (tx + dir.dx * k) * TILE + TILE / 2,
            (ty + dir.dy * k) * TILE + TILE / 2, dir, 6);
        }
      },

      arrow: function (ctx, level, tx, ty, rot) {
        var dir = DIRS[rot];
        var count = this.reach(level, tx, ty, dir, 24);
        var fromX = tx * TILE + TILE / 2 + dir.dx * TILE / 2;
        var fromY = ty * TILE + TILE / 2 + dir.dy * TILE / 2;
        var toX = fromX + dir.dx * count * TILE;
        var toY = fromY + dir.dy * count * TILE;

        ctx.save();
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = 'rgba(255,90,90,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,90,90,0.95)';
        this.arrowHead(ctx, toX, toY, dir, 7);
      },

      saw: function (ctx, level, tx, ty, rot) {
        var vertical = rot === 0 || rot === 2;
        var back = this.reach(level, tx, ty, vertical ? DIRS[0] : DIRS[3], 3);
        var forward = this.reach(level, tx, ty, vertical ? DIRS[2] : DIRS[1], 3);
        var a = (vertical ? ty - back : tx - back) * TILE + TILE / 2;
        var b = (vertical ? ty + forward : tx + forward) * TILE + TILE / 2;
        var fixed = (vertical ? tx : ty) * TILE + TILE / 2;

        ctx.save();
        ctx.strokeStyle = 'rgba(255,90,90,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (vertical) { ctx.moveTo(fixed, a); ctx.lineTo(fixed, b); }
        else { ctx.moveTo(a, fixed); ctx.lineTo(b, fixed); }
        ctx.stroke();

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        [a, b].forEach(function (pos) {
          ctx.beginPath();
          ctx.arc(vertical ? fixed : pos, vertical ? pos : fixed, 13, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
      },

      wrecker: function (ctx, level, tx, ty) {
        var count = Math.max(1, this.reach(level, tx, ty, DIRS[2], 4));
        var length = count * TILE;
        var ax = tx * TILE + TILE / 2;
        var ay = ty * TILE + TILE / 2;
        var maxAngle = 1.15;

        ctx.save();
        ctx.strokeStyle = 'rgba(255,90,90,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(ax, ay, length, Math.PI / 2 - maxAngle, Math.PI / 2 + maxAngle);
        ctx.stroke();

        [-maxAngle, maxAngle].forEach(function (angle) {
          var bx = ax + Math.sin(angle) * length;
          var by = ay + Math.cos(angle) * length;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(bx, by, 12, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
      },

      spike: function (ctx, level, tx, ty, rot) {
        var rect = {
          0: { x: 3, y: TILE - 12, w: TILE - 6, h: 12 },
          1: { x: TILE - 12, y: 3, w: 12, h: TILE - 6 },
          2: { x: 3, y: 0, w: TILE - 6, h: 12 },
          3: { x: 0, y: 3, w: 12, h: TILE - 6 }
        }[rot];
        ctx.fillStyle = 'rgba(255,80,80,0.45)';
        ctx.fillRect(tx * TILE + rect.x, ty * TILE + rect.y, rect.w, rect.h);
      },

      conveyor: function (ctx, level, tx, ty, rot) {
        var dir = rot === 3 ? DIRS[3] : DIRS[1];
        ctx.fillStyle = '#ffb703';
        for (var i = 0; i < 2; i++) {
          this.arrowHead(ctx,
            tx * TILE + TILE / 2 + dir.dx * (10 + i * 12),
            ty * TILE + TILE / 2, dir, 7);
        }
      },

      bounce: function (ctx, level, tx, ty) {
        var cx = tx * TILE + TILE / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(120,230,160,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, ty * TILE);
        ctx.quadraticCurveTo(cx + 22, ty * TILE - 52, cx + 46, ty * TILE - 20);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(120,230,160,0.95)';
        this.arrowHead(ctx, cx + 46, ty * TILE - 20, { dx: 0.7, dy: 0.7 }, 7);
      },

      ice: function (ctx, level, tx, ty) {
        ctx.fillStyle = 'rgba(170,230,255,0.95)';
        this.arrowHead(ctx, tx * TILE + TILE - 4, ty * TILE - 7, DIRS[1], 6);
        this.arrowHead(ctx, tx * TILE + 4, ty * TILE - 7, DIRS[3], 6);
      },

      oil: function (ctx, level, tx, ty) {
        ctx.fillStyle = 'rgba(190,160,255,0.95)';
        this.arrowHead(ctx, tx * TILE + TILE - 4, ty * TILE + TILE - 16, DIRS[1], 6);
        this.arrowHead(ctx, tx * TILE + 4, ty * TILE + TILE - 16, DIRS[3], 6);
      },

      honey: function (ctx, level, tx, ty) {
        ctx.save();
        ctx.strokeStyle = 'rgba(240,200,110,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx * TILE + 8, ty * TILE - 8);
        ctx.lineTo(tx * TILE + TILE - 14, ty * TILE - 8);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(240,200,110,0.95)';
        this.arrowHead(ctx, tx * TILE + TILE - 9, ty * TILE - 8, DIRS[1], 5);
      },

      crumble: function (ctx, level, tx, ty, rot, time) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,200,120,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx * TILE + 2, (ty + 1) * TILE + 4, TILE - 4, 10);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,200,120,0.9)';
        for (var i = 0; i < 3; i++) {
          var drop = ((time * 40 + i * 9) % 18);
          ctx.fillRect(tx * TILE + 7 + i * 9, (ty + 1) * TILE + drop - 4, 3, 3);
        }
      }
    },

    drawEffectHint: function (ctx, level, type, tx, ty, rot, time) {
      var hint = this.effectHints[type];
      if (!hint) { return; }
      ctx.save();
      hint.call(this, ctx, level, tx, ty, rot, time);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
    },

    /**
     * Frisch entfernte Bauteile als blasser Umriss. Hat der Bauende genau
     * diesen Typ ausgewaehlt, leuchtet die Sperre rot auf.
     */
    drawGraves: function (ctx, level, selectedType, time) {
      for (var i = 0; i < level.graves.length; i++) {
        var g = level.graves[i];
        var spec = UDM.BLOCKS[g.type] || {};
        var gw = (spec.w || 1) * TILE;
        var gh = (spec.h || 1) * TILE;
        var gx = g.x * TILE;
        var gy = g.y * TILE;
        var hot = g.type === selectedType;

        ctx.save();
        ctx.globalAlpha = hot ? 0.45 : 0.22;
        this.drawBlock(ctx, {
          type: g.type, tx: g.x, ty: g.y, w: spec.w || 1, h: spec.h || 1,
          rot: 0, spec: spec, broken: false, touch: -1, shake: 0, id: 1
        }, gx, gy, time);
        ctx.globalAlpha = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = hot ? 2.5 : 1.5;
        ctx.strokeStyle = hot ? 'rgba(255,90,90,0.95)' : 'rgba(255,255,255,0.45)';
        ctx.strokeRect(gx + 2, gy + 2, gw - 4, gh - 4);
        if (hot) {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(gx + 7, gy + 7); ctx.lineTo(gx + gw - 7, gy + gh - 7);
          ctx.moveTo(gx + gw - 7, gy + 7); ctx.lineTo(gx + 7, gy + gh - 7);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineWidth = 1;
    },

    drawBuildOverlay: function (ctx, state) {
      var build = state.build;
      var level = state.level;
      var w = UDM.worldWidth();
      var h = UDM.worldHeight();

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      for (var gx = 0; gx <= level.cols; gx++) {
        ctx.beginPath(); ctx.moveTo(gx * TILE, 0); ctx.lineTo(gx * TILE, h); ctx.stroke();
      }
      for (var gy = 0; gy <= level.rows; gy++) {
        ctx.beginPath(); ctx.moveTo(0, gy * TILE); ctx.lineTo(w, gy * TILE); ctx.stroke();
      }

      this.drawGraves(ctx, level, build.deleting ? null : build.type, state.time);

      if (build.tx >= 0 && build.ty >= 0 && build.tx < level.cols && build.ty < level.rows) {
        var x = build.tx * TILE;
        var y = build.ty * TILE;
        var ok = build.valid;
        var ghostSpec = build.type ? UDM.BLOCKS[build.type] : null;
        var spanW = ((ghostSpec && ghostSpec.w) || 1) * TILE;
        var spanH = ((ghostSpec && ghostSpec.h) || 1) * TILE;

        if (build.deleting) {
          // Abrissbirne: zwei Felder (waagerecht oder senkrecht). Jedes
          // getroffene Bauteil wird komplett rot durchgestrichen.
          var vertical = (build.rot || 0) % 2 === 1;
          var tiles = vertical ? [[build.tx, build.ty], [build.tx, build.ty + 1]]
            : [[build.tx, build.ty], [build.tx + 1, build.ty]];
          var hits = [];
          tiles.forEach(function (tile) {
            var cell = level.cell(tile[0], tile[1]);
            if (cell && cell.kind === 'block' && hits.indexOf(cell) < 0) { hits.push(cell); }
          });
          hits.forEach(function (cell) {
            var rx = cell.tx * TILE;
            var ry = cell.ty * TILE;
            var rw = (cell.w || 1) * TILE;
            var rh = (cell.h || 1) * TILE;
            ctx.fillStyle = 'rgba(255,80,80,0.35)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = 'rgba(255,90,90,0.95)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(rx + 8, ry + 8); ctx.lineTo(rx + rw - 8, ry + rh - 8);
            ctx.moveTo(rx + rw - 8, ry + 8); ctx.lineTo(rx + 8, ry + rh - 8);
            ctx.stroke();
          });
          var fw = vertical ? TILE : TILE * 2;
          var fh = vertical ? TILE * 2 : TILE;
          ctx.fillStyle = ok ? 'rgba(255,80,80,0.12)' : 'rgba(255,255,255,0.07)';
          ctx.fillRect(x, y, fw, fh);
          ctx.setLineDash([6, 4]);
          ctx.lineWidth = 3;
          ctx.strokeStyle = ok ? 'rgba(255,120,120,0.95)' : 'rgba(255,255,255,0.35)';
          ctx.strokeRect(x + 1.5, y + 1.5, fw - 3, fh - 3);
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
        } else {
          if (ok && build.type) {
            this.drawEffectHint(ctx, level, build.type, build.tx, build.ty, build.rot, state.time);
            ctx.globalAlpha = 0.7;
            this.drawBlock(ctx, {
              type: build.type,
              tx: build.tx,
              ty: build.ty,
              w: (ghostSpec && ghostSpec.w) || 1,
              h: (ghostSpec && ghostSpec.h) || 1,
              rot: build.rot,
              spec: ghostSpec,
              broken: false,
              touch: -1,
              shake: 0,
              id: 1
            }, x, y, state.time);
            ctx.globalAlpha = 1;
            if (UDM.BLOCKS[build.type] && UDM.BLOCKS[build.type].rotatable) {
              this.drawDirectionBadge(ctx, x, y, build.rot, true);
            }
          }

          ctx.lineWidth = 3;
          ctx.strokeStyle = ok ? build.color : 'rgba(255,80,80,0.95)';
          ctx.strokeRect(x + 1.5, y + 1.5, spanW - 3, spanH - 3);
          if (!ok) {
            ctx.beginPath();
            ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + spanW - 6, y + spanH - 6);
            ctx.moveTo(x + spanW - 6, y + 6); ctx.lineTo(x + 6, y + spanH - 6);
            ctx.stroke();
          }
          ctx.lineWidth = 1;
        }
      }

      if (build.label && build.tx >= 0 && build.ty >= 0) {
        // Zuschauer sehen, wessen Mauszeiger das ist.
        var lx = build.tx * TILE + TILE / 2;
        var ly = build.ty * TILE - 10;
        ctx.font = 'bold 12px system-ui, sans-serif';
        var tw = ctx.measureText(build.label).width + 12;
        ctx.fillStyle = 'rgba(10,12,28,0.8)';
        roundRect(ctx, lx - tw / 2, ly - 13, tw, 18, 6);
        ctx.fill();
        ctx.fillStyle = build.color;
        ctx.textAlign = 'center';
        ctx.fillText(build.label, lx, ly);
        ctx.textAlign = 'left';
      }

      ctx.restore();
    }
  };

  UDM.Render = Render;
}(window));
