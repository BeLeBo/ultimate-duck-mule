/* Level: Kachelgitter, Bauteil-Eigenschaften und die beweglichen Gefahren. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;

  /* Physikalische Eigenschaften der Bauteile. Namen/Beschreibungen kommen
   * vom Server (lib/Cards.php), gezeichnet wird in render.js. */
  UDM.BLOCKS = {
    stone: { solid: true },
    beam: { solid: true, w: 3, h: 1 },
    wall: { solid: true, w: 1, h: 3 },
    slab: { solid: true, w: 2, h: 2 },
    ice: { solid: true, friction: 0.07, accel: 0.35 },
    bounce: { solid: true, bounce: true },
    crumble: { solid: true, crumble: 0.45 },
    conveyor: { solid: true, conveyor: true, rotatable: true },
    honey: { solid: true, sticky: true },
    oil: { slick: true },
    fan: { solid: true, fan: true, rotatable: true, range: 5 },
    spike: { deadly: 'stachel', face: true, rotatable: true },
    saw: { deadly: 'saege', saw: true, rotatable: true },
    wrecker: { deadly: 'pendel', wrecker: true },
    arrow: { solid: true, shooter: true, rotatable: true }
  };

  /* rot: 0 = hoch, 1 = rechts, 2 = runter, 3 = links */
  var DIRS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }
  ];
  UDM.DIRS = DIRS;

  var TERRAIN = {
    ground: { solid: true, terrain: true },
    rock: { solid: true, terrain: true },
    oneway: { oneWay: true, terrain: true }
  };

  function Level(def) {
    this.def = def;
    this.cols = UDM.COLS;
    this.rows = UDM.ROWS;
    this.cells = new Array(this.cols * this.rows);
    this.blocks = [];
    this.saws = [];
    this.wreckers = [];
    this.shooters = [];
    this.streams = [];
    this.hazards = [];
    this.projectiles = [];
    this.particles = [];
    // Frisch entfernte Bauteile: derselbe Typ darf dort gerade nicht hin.
    this.graves = [];
    this.rebuild([]);
  }

  Level.prototype.index = function (tx, ty) { return ty * this.cols + tx; };

  /** Fortlaufende Kennung - Saegen und Pendel leiten ihre Phase daraus ab. */
  Level.prototype.nextId = function () {
    this.idCounter = (this.idCounter || 0) + 1;
    return this.idCounter;
  };

  Level.prototype.inBounds = function (tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  };

  Level.prototype.cell = function (tx, ty) {
    if (!this.inBounds(tx, ty)) { return null; }
    return this.cells[this.index(tx, ty)] || null;
  };

  /**
   * Ist die Kachel gerade ein Hindernis? Bruchbloecke zaehlen nur ungebrochen.
   *
   * Links und rechts begrenzen unsichtbare Banden das Spielfeld, damit niemand
   * aus dem Bild laufen kann. Oben bleibt offen (Sprünge), unten geht es in
   * den Abgrund.
   */
  Level.prototype.isSolid = function (tx, ty) {
    if (tx < 0 || tx >= this.cols) { return true; }
    var cell = this.cell(tx, ty);
    if (!cell || !cell.spec.solid) { return false; }
    if (cell.broken) { return false; }
    return true;
  };

  Level.prototype.isOneWay = function (tx, ty) {
    var cell = this.cell(tx, ty);
    return !!(cell && cell.spec.oneWay && !cell.broken);
  };

  /** Baut das Gitter aus Gelaende + gesetzten Bauteilen neu auf. */
  Level.prototype.rebuild = function (blocks) {
    var i;
    for (i = 0; i < this.cells.length; i++) { this.cells[i] = null; }

    var rects = this.def.rects || [];
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      for (var x = r.x; x < r.x + r.w; x++) {
        for (var y = r.y; y < r.y + r.h; y++) {
          if (!this.inBounds(x, y)) { continue; }
          this.cells[this.index(x, y)] = {
            kind: 'terrain',
            type: r.t,
            spec: TERRAIN[r.t] || TERRAIN.ground,
            tx: x,
            ty: y,
            rot: 0,
            ownerSlot: -1,
            broken: false,
            touch: -1
          };
        }
      }
    }

    this.blocks = [];
    this.idCounter = 0;
    for (i = 0; i < blocks.length; i++) {
      this.addBlock(blocks[i], true);
      this.idCounter = Math.max(this.idCounter, blocks[i].id || 0);
    }
    this.refreshDynamics();
  };

  /**
   * Fuegt ein Bauteil hinzu. Mehrkachelige Teile (Balken, Mauer, Klotz)
   * belegen mehrere Gitterzellen, die alle auf dasselbe Objekt zeigen.
   * skipRefresh spart beim Massen-Aufbau Arbeit.
   */
  Level.prototype.addBlock = function (block, skipRefresh) {
    var spec = UDM.BLOCKS[block.type];
    if (!spec || !this.inBounds(block.x, block.y)) { return null; }

    var cell = {
      kind: 'block',
      id: block.id,
      type: block.type,
      spec: spec,
      tx: block.x,
      ty: block.y,
      w: spec.w || 1,
      h: spec.h || 1,
      rot: spec.rotatable ? ((block.rot % 4) + 4) % 4 : 0,
      ownerSlot: typeof block.ownerSlot === 'number' ? block.ownerSlot : -1,
      broken: false,
      touch: -1,
      shake: 0
    };

    for (var dx = 0; dx < cell.w; dx++) {
      for (var dy = 0; dy < cell.h; dy++) {
        if (this.inBounds(block.x + dx, block.y + dy)) {
          this.cells[this.index(block.x + dx, block.y + dy)] = cell;
        }
      }
    }
    this.blocks.push(cell);
    if (!skipRefresh) { this.refreshDynamics(); }
    return cell;
  };

  /** Entfernt ein gesetztes Bauteil wieder. Gelaende bleibt unangetastet. */
  Level.prototype.removeBlockAt = function (tx, ty) {
    var cell = this.cell(tx, ty);
    if (!cell || cell.kind !== 'block') { return false; }
    return this.removeBlock(cell);
  };

  /** Entfernt ein Bauteil samt aller belegten Kacheln. */
  Level.prototype.removeBlock = function (cell) {
    if (!cell || cell.kind !== 'block') { return false; }

    for (var dx = 0; dx < (cell.w || 1); dx++) {
      for (var dy = 0; dy < (cell.h || 1); dy++) {
        var tx = cell.tx + dx;
        var ty = cell.ty + dy;
        if (this.inBounds(tx, ty) && this.cells[this.index(tx, ty)] === cell) {
          this.cells[this.index(tx, ty)] = null;
        }
      }
    }

    var index = this.blocks.indexOf(cell);
    if (index >= 0) { this.blocks.splice(index, 1); }
    this.refreshDynamics();
    return true;
  };

  /** Entfernt alle Bauteile mit diesen Kennungen (z.B. nach einem Kill). */
  Level.prototype.removeBlocksById = function (ids) {
    var removed = 0;
    for (var i = this.blocks.length - 1; i >= 0; i--) {
      if (ids.indexOf(this.blocks[i].id) >= 0) {
        this.removeBlock(this.blocks[i]);
        removed++;
      }
    }
    return removed;
  };

  Level.prototype.hasBlockAt = function (tx, ty) {
    var cell = this.cell(tx, ty);
    return !!cell;
  };

  /**
   * Darf hier gebaut werden? Prueft die komplette Grundflaeche des Bauteils.
   * Muss zu Game::canPlaceAt() und Levels::blockedTiles() in PHP passen.
   */
  Level.prototype.canPlaceAt = function (tx, ty, type) {
    var spec = type ? UDM.BLOCKS[type] : null;
    var w = (spec && spec.w) || 1;
    var h = (spec && spec.h) || 1;
    if (type && this.blockedByGrave(tx, ty, type)) { return false; }

    for (var dx = 0; dx < w; dx++) {
      for (var dy = 0; dy < h; dy++) {
        if (!this.tileFree(tx + dx, ty + dy)) { return false; }
      }
    }
    return true;
  };

  /**
   * Liegt hier ein frischer Grabstein desselben Typs? Muss zu
   * Game::blockedByGrave() in PHP passen.
   */
  Level.prototype.blockedByGrave = function (tx, ty, type) {
    var spec = UDM.BLOCKS[type] || {};
    var w = spec.w || 1;
    var h = spec.h || 1;
    for (var i = 0; i < this.graves.length; i++) {
      var g = this.graves[i];
      if (g.type !== type) { continue; }
      if (tx < g.x + w && g.x < tx + w && ty < g.y + h && g.y < ty + h) { return true; }
    }
    return false;
  };

  Level.prototype.tileFree = function (tx, ty) {
    if (!this.inBounds(tx, ty)) { return false; }
    if (this.cell(tx, ty)) { return false; }
    if (this.isSafeTile(tx, ty)) { return false; }
    var goal = this.def.goal;
    if (tx >= goal.x - 1 && tx <= goal.x + 1 && ty >= goal.y - 2 && ty <= goal.y + 1) { return false; }
    return true;
  };

  /**
   * Startzone: 4 Kacheln breit, 3 hoch. Muss zu Levels::safeZone() in PHP
   * passen. Hier wird nicht gebaut, und wer darin steht, ist unverwundbar.
   */
  Level.prototype.isSafeTile = function (tx, ty) {
    var spawn = this.def.spawn;
    return tx >= spawn.x - 1 && tx <= spawn.x + 2 && ty >= spawn.y - 2 && ty <= spawn.y;
  };

  Level.prototype.safeRect = function () {
    var spawn = this.def.spawn;
    return { x: (spawn.x - 1) * TILE, y: (spawn.y - 2) * TILE, w: 4 * TILE, h: 3 * TILE };
  };

  /** Liegt der Punkt (in Pixeln) in der Startzone? */
  Level.prototype.inSafeZone = function (px, py) {
    var r = this.safeRect();
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  };

  /** Hindernis fuer Saegenschienen und Luftstroeme: fest oder Startzone. */
  Level.prototype.blocksHazard = function (tx, ty) {
    return !this.inBounds(tx, ty) || this.isSolid(tx, ty) || this.isSafeTile(tx, ty);
  };

  /** Leitet Saegen, Luftstroeme, Schuetzen und toedliche Flaechen neu ab. */
  Level.prototype.refreshDynamics = function () {
    this.saws = [];
    this.wreckers = [];
    this.shooters = [];
    this.streams = [];
    this.hazards = [];

    for (var i = 0; i < this.blocks.length; i++) {
      var cell = this.blocks[i];
      var spec = cell.spec;

      if (spec.saw) {
        this.saws.push(this.makeSaw(cell));
      } else if (spec.wrecker) {
        this.wreckers.push(this.makeWrecker(cell));
      } else if (spec.shooter) {
        this.shooters.push({
          cell: cell,
          dir: DIRS[cell.rot],
          period: 1.7,
          phase: ((cell.id || i) * 0.37) % 1.7,
          fired: -1,
          ownerSlot: cell.ownerSlot,
          blockId: cell.id
        });
      } else if (spec.fan) {
        this.buildStream(cell);
      } else if (spec.deadly && spec.face) {
        this.hazards.push({
          rect: this.faceRect(cell, 12),
          cause: spec.deadly,
          ownerSlot: cell.ownerSlot,
          blockId: cell.id,
          cell: cell
        });
      }
    }
  };

  /** Die toedliche Flaeche einer Stachelkachel: liegt an der Rueckseite an. */
  Level.prototype.faceRect = function (cell, depth) {
    var x = cell.tx * TILE;
    var y = cell.ty * TILE;
    switch (cell.rot) {
      case 1: return { x: x + TILE - depth, y: y + 3, w: depth, h: TILE - 6 };
      case 2: return { x: x + 3, y: y, w: TILE - 6, h: depth };
      case 3: return { x: x, y: y + 3, w: depth, h: TILE - 6 };
      default: return { x: x + 3, y: y + TILE - depth, w: TILE - 6, h: depth };
    }
  };

  Level.prototype.makeSaw = function (cell) {
    var vertical = cell.rot === 0 || cell.rot === 2;
    var reach = 3;
    var back = 0;
    var forward = 0;
    var step;
    for (step = 1; step <= reach; step++) {
      var bx = cell.tx + (vertical ? 0 : -step);
      var by = cell.ty + (vertical ? -step : 0);
      if (this.blocksHazard(bx, by)) { break; }
      back = step;
    }
    for (step = 1; step <= reach; step++) {
      var fx = cell.tx + (vertical ? 0 : step);
      var fy = cell.ty + (vertical ? step : 0);
      if (this.blocksHazard(fx, fy)) { break; }
      forward = step;
    }

    var centerA = (vertical ? cell.ty - back : cell.tx - back) * TILE + TILE / 2;
    var centerB = (vertical ? cell.ty + forward : cell.tx + forward) * TILE + TILE / 2;
    var mid = (centerA + centerB) / 2;
    var amp = (centerB - centerA) / 2;

    return {
      cell: cell,
      vertical: vertical,
      fixed: (vertical ? cell.tx : cell.ty) * TILE + TILE / 2,
      mid: mid,
      amp: amp,
      radius: 13,
      period: Math.max(1.4, (amp * 2) / 55),
      phase: ((cell.id || 1) * 0.61) % 1,
      ownerSlot: cell.ownerSlot,
      blockId: cell.id,
      x: vertical ? (cell.tx * TILE + TILE / 2) : mid,
      y: vertical ? mid : (cell.ty * TILE + TILE / 2),
      spin: 0
    };
  };

  /**
   * Pendel: Kugel an einer Kette unter dem Ankerblock. Die Kette ist so lang,
   * wie darunter Platz ist (hoechstens 4 Kacheln).
   */
  Level.prototype.makeWrecker = function (cell) {
    var reach = 0;
    for (var step = 1; step <= 4; step++) {
      var ty = cell.ty + step;
      if (!this.inBounds(cell.tx, ty) || this.isSolid(cell.tx, ty)) { break; }
      reach = step;
    }
    var length = Math.max(1, reach) * TILE;

    return {
      cell: cell,
      ax: cell.tx * TILE + TILE / 2,
      ay: cell.ty * TILE + TILE / 2,
      length: length,
      radius: 12,
      maxAngle: 1.15,
      // Echte Pendelformel, damit lange Ketten traeger schwingen.
      period: 2 * Math.PI * Math.sqrt(length / 1900),
      phase: ((cell.id || 1) * 0.53) % 1,
      ownerSlot: cell.ownerSlot,
      blockId: cell.id,
      angle: 0,
      x: cell.tx * TILE + TILE / 2,
      y: cell.ty * TILE + TILE / 2 + length
    };
  };

  Level.prototype.updateWrecker = function (wrecker, time) {
    var t = (time / wrecker.period + wrecker.phase) * Math.PI * 2;
    wrecker.angle = wrecker.maxAngle * Math.sin(t);
    wrecker.x = wrecker.ax + Math.sin(wrecker.angle) * wrecker.length;
    wrecker.y = wrecker.ay + Math.cos(wrecker.angle) * wrecker.length;
  };

  /** Luftstrom eines Ventilators: Kachel fuer Kachel bis zum naechsten Hindernis. */
  Level.prototype.buildStream = function (cell) {
    var dir = DIRS[cell.rot];
    var range = cell.spec.range || 5;
    for (var step = 1; step <= range; step++) {
      var tx = cell.tx + dir.dx * step;
      var ty = cell.ty + dir.dy * step;
      if (this.blocksHazard(tx, ty)) { break; }
      this.streams.push({
        x: tx * TILE,
        y: ty * TILE,
        w: TILE,
        h: TILE,
        dx: dir.dx,
        dy: dir.dy,
        power: 1 - (step - 1) / (range + 1),
        cell: cell,
        ownerSlot: cell.ownerSlot,
        blockId: cell.id,
        step: step
      });
    }
  };

  /** Rundenreset: Bruchbloecke zurueck, Geschosse und Partikel weg. */
  Level.prototype.resetRound = function () {
    for (var i = 0; i < this.blocks.length; i++) {
      this.blocks[i].broken = false;
      this.blocks[i].touch = -1;
      this.blocks[i].shake = 0;
    }
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.refreshDynamics();
    for (var s = 0; s < this.saws.length; s++) { this.updateSaw(this.saws[s], 0); }
    for (var w = 0; w < this.wreckers.length; w++) { this.updateWrecker(this.wreckers[w], 0); }
  };

  Level.prototype.updateSaw = function (saw, time) {
    var t = (time / saw.period + saw.phase) * Math.PI * 2;
    var offset = saw.amp * Math.sin(t);
    if (saw.vertical) {
      saw.x = saw.fixed;
      saw.y = saw.mid + offset;
    } else {
      saw.x = saw.mid + offset;
      saw.y = saw.fixed;
    }
    saw.spin = time * 14;
  };

  /** Bewegt alle Gefahren weiter. time = Sekunden seit Rundenstart. */
  Level.prototype.update = function (dt, time) {
    var i;

    for (i = 0; i < this.saws.length; i++) {
      this.updateSaw(this.saws[i], time);
    }

    for (i = 0; i < this.wreckers.length; i++) {
      this.updateWrecker(this.wreckers[i], time);
    }

    for (i = 0; i < this.shooters.length; i++) {
      var shooter = this.shooters[i];
      var slot = Math.floor((time + shooter.phase) / shooter.period);
      if (slot > shooter.fired && time > 0.4) {
        shooter.fired = slot;
        this.spawnArrow(shooter);
      }
    }

    for (i = this.projectiles.length - 1; i >= 0; i--) {
      var p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      var tx = Math.floor((p.x + p.w / 2) / TILE);
      var ty = Math.floor((p.y + p.h / 2) / TILE);
      if (p.life <= 0 || !this.inBounds(tx, ty) || this.isSolid(tx, ty) || this.isSafeTile(tx, ty)) {
        this.burst(p.x + p.w / 2, p.y + p.h / 2, '#d9c8a0', 6);
        this.projectiles.splice(i, 1);
      }
    }

    for (i = 0; i < this.blocks.length; i++) {
      var cell = this.blocks[i];
      if (cell.spec.crumble && cell.touch >= 0 && !cell.broken) {
        cell.touch += dt;
        cell.shake = cell.touch / cell.spec.crumble;
        if (cell.touch >= cell.spec.crumble) {
          cell.broken = true;
          cell.shake = 0;
          this.burst(cell.tx * TILE + TILE / 2, cell.ty * TILE + TILE / 2, '#b98a54', 14);
          UDM.Audio.crumble();
          this.refreshDynamics();
        }
      }
    }

    for (i = this.particles.length - 1; i >= 0; i--) {
      var q = this.particles[i];
      q.vy += 900 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0) { this.particles.splice(i, 1); }
    }
  };

  Level.prototype.spawnArrow = function (shooter) {
    var cell = shooter.cell;
    var dir = shooter.dir;
    var cx = cell.tx * TILE + TILE / 2 + dir.dx * (TILE / 2 + 8);
    var cy = cell.ty * TILE + TILE / 2 + dir.dy * (TILE / 2 + 8);
    var horizontal = dir.dx !== 0;
    this.projectiles.push({
      x: cx - (horizontal ? 9 : 3),
      y: cy - (horizontal ? 3 : 9),
      w: horizontal ? 18 : 6,
      h: horizontal ? 6 : 18,
      vx: dir.dx * 340,
      vy: dir.dy * 340,
      life: 4,
      ownerSlot: shooter.ownerSlot,
      blockId: shooter.blockId
    });
    UDM.Audio.shoot();
  };

  Level.prototype.burst = function (x, y, color, count) {
    for (var i = 0; i < count; i++) {
      this.particles.push({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.7) * 260,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        color: color,
        size: 2 + Math.random() * 3
      });
    }
  };

  Level.prototype.goalRect = function () {
    return {
      x: this.def.goal.x * TILE + 6,
      y: (this.def.goal.y - 1) * TILE + 2,
      w: TILE - 12,
      h: TILE * 2 - 4
    };
  };

  /** Startposition der Figur mit Index i (leicht versetzt, damit alle sichtbar sind). */
  Level.prototype.spawnPoint = function (i) {
    var s = this.def.spawn;
    return {
      // Vier Figuren nebeneinander, alle innerhalb der Startzone.
      x: s.x * TILE + 3 + i * 20,
      y: (s.y + 1) * TILE - UDM.PHYS.playerH
    };
  };

  UDM.Level = Level;
}(window));
