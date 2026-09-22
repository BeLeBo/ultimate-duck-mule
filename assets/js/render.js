/* Alles, was auf die Canvas kommt. Keine Bilddateien - alles gezeichnet. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;

  /* Die Huegel sind bewusst dunstig und blaustichig gehalten: sie duerfen
   * nie mit dem begehbaren Gelaende verwechselt werden. */
  var THEMES = {
    day: { sky: ['#6fbdec', '#c4e9fb'], hill: '#7ba9c9', hillDark: '#5f8fb4', star: null, sun: '#fff4bd', pit: 'rgba(12,18,40,0.5)' },
    dusk: { sky: ['#f79d65', '#5b4382'], hill: '#6d4f80', hillDark: '#4e3865', star: 'rgba(255,255,255,0.5)', sun: '#ffd6a5', pit: 'rgba(12,8,30,0.55)' },
    night: { sky: ['#0d1836', '#26325f'], hill: '#1b2748', hillDark: '#131c36', star: 'rgba(255,255,255,0.85)', sun: '#e8eeff', pit: 'rgba(2,4,14,0.6)' },
    sunset: { sky: ['#ff8f6b', '#ffd9a0'], hill: '#b3697c', hillDark: '#8b4f66', star: null, sun: '#fff1c1', pit: 'rgba(30,10,30,0.5)' }
  };

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
      this.drawStreams(ctx, level, time);
      this.drawBlocks(ctx, level, time);
      this.drawGoal(ctx, level, time);
      this.drawSaws(ctx, level);
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

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (var c = 0; c < 5; c++) {
        var cx = (rand() * w + time * (8 + c * 3)) % (w + 220) - 110;
        var cy = 50 + rand() * 180;
        this.drawCloud(ctx, cx, cy, 34 + rand() * 26);
      }
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
      for (var ty = 0; ty < level.rows; ty++) {
        for (var tx = 0; tx < level.cols; tx++) {
          var cell = level.cell(tx, ty);
          if (!cell || cell.kind !== 'terrain') { continue; }
          var x = tx * TILE;
          var y = ty * TILE;

          if (cell.type === 'oneway') {
            ctx.fillStyle = '#a9743f';
            roundRect(ctx, x, y + 6, TILE, 10, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(x, y + 6, TILE, 3);
            continue;
          }

          var top = level.cell(tx, ty - 1);
          var isTop = !top || top.kind !== 'terrain';
          if (cell.type === 'rock') {
            ctx.fillStyle = '#58607a';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y, TILE, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.13)';
            ctx.fillRect(x + ((tx * 7 + ty * 13) % 18), y + ((tx * 5 + ty * 3) % 20), 7, 6);
            if (isTop) {
              ctx.fillStyle = '#6e7793';
              ctx.fillRect(x, y, TILE, 5);
            }
          } else {
            ctx.fillStyle = '#8a5a35';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(x + ((tx * 11 + ty * 5) % 20), y + 10 + ((tx * 3 + ty * 7) % 14), 6, 5);
            if (isTop) {
              ctx.fillStyle = '#5fbf52';
              ctx.fillRect(x, y, TILE, 8);
              ctx.fillStyle = '#7fd96a';
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

        ctx.save();
        if (cell.spec.crumble && cell.touch >= 0 && !cell.broken) {
          ctx.translate(Math.sin(time * 60) * 1.6 * cell.shake, 0);
        }
        if (cell.broken) {
          ctx.globalAlpha = 0.16;
        }
        this.drawBlock(ctx, cell, x, y, time);
        ctx.restore();

        if (!cell.broken && cell.ownerSlot >= 0) {
          ctx.fillStyle = UDM.SLOT_COLORS[cell.ownerSlot % 3];
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x + TILE - 6, y + 1, 5, 5);
          ctx.globalAlpha = 1;
        }
      }
    },

    drawBlock: function (ctx, cell, x, y, time) {
      var fn = this.blockPainters[cell.type];
      if (fn) { fn.call(this, ctx, x, y, cell, time); }
    },

    blockPainters: {
      stone: function (ctx, x, y) {
        ctx.fillStyle = '#9aa2b1';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#b6bdc9';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 2, y + TILE - 6, TILE - 4, 4);
        ctx.strokeStyle = '#6f7787';
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
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
      cloud: function (ctx, x, y, cell, time) {
        var lift = Math.sin(time * 2 + cell.tx * 0.7) * 1.5;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(x + 9, y + 12 + lift, 9, 0, Math.PI * 2);
        ctx.arc(x + 20, y + 11 + lift, 10, 0, Math.PI * 2);
        ctx.arc(x + 15, y + 17 + lift, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,215,240,0.9)';
        ctx.fillRect(x + 3, y + 17 + lift, TILE - 6, 4);
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
      ladder: function (ctx, x, y) {
        ctx.fillStyle = '#c08d4f';
        ctx.fillRect(x + 4, y, 4, TILE);
        ctx.fillRect(x + TILE - 8, y, 4, TILE);
        ctx.fillStyle = '#e0ae6c';
        for (var i = 0; i < 3; i++) {
          ctx.fillRect(x + 4, y + 4 + i * 11, TILE - 8, 3);
        }
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

      ctx.save();

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

      if (showNames) {
        var labelY = p.y - 12 - (p.slot % 3) * 12;
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillText(p.name, cx + 1, labelY + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.name, cx, labelY);
        ctx.textAlign = 'left';
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
      } else {
        ctx.fillStyle = '#3a3a48';
        ctx.beginPath();
        ctx.arc(r * 0.78, r * 0.05, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Augen
      var blink = (Math.sin(time * 2.1 + p.slot * 3) > 0.985) ? 0.15 : 1;
      var eyeX = p.char === 'duck' ? r * 0.28 : r * 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(eyeX, -r * 0.2, r * 0.26, r * 0.3 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!p.alive) {
        ctx.strokeStyle = '#2b2b33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(eyeX - 4, -r * 0.45); ctx.lineTo(eyeX + 4, -r * 0.02);
        ctx.moveTo(eyeX + 4, -r * 0.45); ctx.lineTo(eyeX - 4, -r * 0.02);
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = '#20222b';
        ctx.beginPath();
        ctx.ellipse(eyeX + 2, -r * 0.2, r * 0.13, r * 0.18 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },

    /* --------------------------------------------------------- Bauphase */

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

      if (build.tx >= 0 && build.ty >= 0 && build.tx < level.cols && build.ty < level.rows) {
        var x = build.tx * TILE;
        var y = build.ty * TILE;
        var ok = build.valid;

        if (ok && build.type) {
          ctx.globalAlpha = 0.65;
          this.drawBlock(ctx, {
            type: build.type,
            tx: build.tx,
            ty: build.ty,
            rot: build.rot,
            spec: UDM.BLOCKS[build.type],
            broken: false,
            touch: -1,
            shake: 0
          }, x, y, state.time);
          ctx.globalAlpha = 1;
        }

        ctx.lineWidth = 3;
        ctx.strokeStyle = ok ? build.color : 'rgba(255,80,80,0.95)';
        ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
        if (!ok) {
          ctx.beginPath();
          ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + TILE - 6, y + TILE - 6);
          ctx.moveTo(x + TILE - 6, y + 6); ctx.lineTo(x + 6, y + TILE - 6);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // Start- und Zielbereich markieren.
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      var sp = level.def.spawn;
      ctx.strokeRect((sp.x - 1) * TILE, (sp.y - 2) * TILE, TILE * 4, TILE * 3);
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  UDM.Render = Render;
}(window));
