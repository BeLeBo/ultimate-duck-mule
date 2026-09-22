/* Die Spielfigur: Steuerung, Plattformer-Physik, Tod und Ziel. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;
  var P = UDM.PHYS;

  function Player(slot, info) {
    this.slot = slot;
    this.name = (info && info.name) || ('Spieler ' + (slot + 1));
    this.char = (info && info.char) || 'duck';
    this.color = UDM.SLOT_COLORS[slot % UDM.SLOT_COLORS.length];
    this.dark = UDM.SLOT_DARK[slot % UDM.SLOT_DARK.length];
    this.w = P.playerW;
    this.h = P.playerH;
    this.remote = false;
    this.score = 0;
    this.hand = [];
    this.reset(0, 0, 0);
  }

  Player.prototype.reset = function (x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.face = 1;
    this.onGround = false;
    this.wallDir = 0;
    this.onLadder = false;
    this.clinging = false;
    this.coyote = 0;
    this.buffer = 0;
    this.wallLock = 0;
    this.dropThrough = 0;
    this.alive = true;
    this.finished = false;
    this.time = 0;
    this.cause = '';
    this.killerSlot = null;
    this.anim = 'idle';
    this.animTime = 0;
    this.squash = 1;
    this.deathTimer = 0;
    this.confetti = 0;
    this.jumping = false;
    this.target = null;
  };

  Player.prototype.box = function () {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  };

  Player.prototype.centerX = function () { return this.x + this.w / 2; };
  Player.prototype.centerY = function () { return this.y + this.h / 2; };

  /* ------------------------------------------------------------ Umgebung */

  /** Sammelt alles, was die Kacheln rund um die Figur gerade bewirken. */
  Player.prototype.sampleEnv = function (level) {
    var env = {
      friction: 1,
      accel: 1,
      sticky: false,
      climb: false,
      climbWall: false,
      conveyor: 0,
      groundCell: null
    };

    var x0 = Math.floor(this.x / TILE);
    var x1 = Math.floor((this.x + this.w - 1) / TILE);
    var y0 = Math.floor(this.y / TILE);
    var y1 = Math.floor((this.y + this.h - 1) / TILE);

    for (var tx = x0; tx <= x1; tx++) {
      for (var ty = y0; ty <= y1; ty++) {
        var cell = level.cell(tx, ty);
        if (!cell || cell.broken) { continue; }
        if (cell.spec.climb) { env.climb = true; }
        if (cell.spec.sticky) { env.sticky = true; }
      }
    }

    // Seitlich anliegender Klebeblock -> festhalten moeglich.
    var midY = Math.floor(this.centerY() / TILE);
    var leftCell = level.cell(Math.floor((this.x - 2) / TILE), midY);
    var rightCell = level.cell(Math.floor((this.x + this.w + 2) / TILE), midY);
    if ((leftCell && leftCell.spec.climbWall && !leftCell.broken) ||
        (rightCell && rightCell.spec.climbWall && !rightCell.broken)) {
      env.climbWall = true;
    }

    // Boden unter den Fuessen.
    if (this.onGround) {
      var footY = Math.floor((this.y + this.h + 1) / TILE);
      for (var fx = x0; fx <= x1; fx++) {
        var ground = level.cell(fx, footY);
        if (ground && !ground.broken && (ground.spec.solid || ground.spec.oneWay)) {
          env.groundCell = ground;
          if (ground.spec.friction !== undefined) { env.friction = ground.spec.friction; }
          if (ground.spec.accel !== undefined) { env.accel = ground.spec.accel; }
          if (ground.spec.sticky) { env.sticky = true; }
          if (ground.spec.conveyor) {
            env.conveyor = (ground.rot === 3 ? -1 : 1) * P.conveyorSpeed;
          }
          if (ground.spec.crumble && ground.touch < 0) { ground.touch = 0; }
          break;
        }
      }
    }

    return env;
  };

  /* -------------------------------------------------------------- Update */

  Player.prototype.update = function (dt, input, level) {
    if (!this.alive) {
      this.deathTimer += dt;
      this.animTime += dt;
      return;
    }
    if (this.finished) {
      this.animTime += dt;
      this.confetti = Math.max(0, this.confetti - dt);
      this.vx = UDM.approach(this.vx, 0, 900 * dt);
      this.applyGravity(dt, { friction: 1, accel: 1, sticky: false, climb: false, climbWall: false, conveyor: 0 });
      this.moveY(this.vy * dt, level);
      this.moveX(this.vx * dt, level);
      return;
    }

    this.time += dt;
    this.animTime += dt;
    var env = this.sampleEnv(level);
    this.onLadder = env.climb;

    var dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    // Sprungpuffer und Coyote-Time.
    if (input.jumpPressed) { this.buffer = P.jumpBuffer; }
    this.buffer -= dt;
    this.coyote = this.onGround ? P.coyote : this.coyote - dt;
    this.wallLock -= dt;
    this.dropThrough -= dt;

    // Waagerechte Steuerung (nach einem Wandsprung kurz gesperrt).
    var maxSpeed = P.moveSpeed * (env.sticky ? P.stickyFactor : 1);
    if (this.wallLock <= 0) {
      if (dir !== 0) {
        var accel = (this.onGround ? P.accelGround : P.accelAir) * env.accel;
        this.vx = UDM.approach(this.vx, dir * maxSpeed, accel * dt);
        this.face = dir;
      } else {
        var friction = (this.onGround ? P.frictionGround : P.frictionAir) * env.friction;
        this.vx = UDM.approach(this.vx, 0, friction * dt);
      }
    }

    // An der Wand haengen.
    this.clinging = false;
    if (!this.onGround && this.wallDir !== 0 && dir === this.wallDir) {
      if (env.climbWall) {
        this.clinging = true;
      } else if (this.vy > 0) {
        this.vy = Math.min(this.vy, P.wallSlideMax);
      }
    }

    this.handleJump(input, env, level);
    this.applyJumpCut(input);
    this.applyGravity(dt, env);
    this.applyClimb(dt, input, env);
    this.applyStreams(dt, level);

    if (input.down && this.onGround && this.isOnOneWay(level)) {
      this.dropThrough = 0.2;
      this.y += 2;
      this.onGround = false;
    }

    this.moveY(this.vy * dt, level);
    this.moveX(this.vx * dt + env.conveyor * dt, level);
    this.updateWallContact(level);
    this.updateAnim(dir);
    this.squash = UDM.approach(this.squash, 1, 3 * dt);
  };

  Player.prototype.handleJump = function (input, env, level) {
    if (this.buffer <= 0) { return; }

    if (env.climb) {
      return; // Auf der Leiter klettert die Sprungtaste statt zu springen.
    }
    if (this.coyote > 0) {
      this.vy = P.jumpVel;
      this.onGround = false;
      this.coyote = 0;
      this.buffer = 0;
      this.jumping = true;
      this.squash = 0.72;
      UDM.Audio.jump();
      level.burst(this.centerX(), this.y + this.h, 'rgba(255,255,255,0.7)', 4);
    } else if (this.wallDir !== 0) {
      this.vy = P.wallJumpY;
      this.vx = -this.wallDir * P.wallJumpX;
      this.face = -this.wallDir;
      this.wallLock = P.wallLock;
      this.buffer = 0;
      this.jumping = true;
      this.squash = 0.78;
      UDM.Audio.jump();
      level.burst(this.centerX() + this.wallDir * 10, this.centerY(), 'rgba(255,255,255,0.6)', 4);
    }
  };

  /** Sprungtaste frueh loslassen bremst den Aufstieg ab. */
  Player.prototype.applyJumpCut = function (input) {
    if (!this.jumping) { return; }
    if (this.vy >= 0) {
      this.jumping = false;
      return;
    }
    if (!input.jump) {
      this.vy *= P.jumpCut;
      this.jumping = false;
    }
  };

  Player.prototype.applyGravity = function (dt, env) {
    if (env.climb) {
      this.vy = 0;
      return;
    }
    if (this.clinging) {
      this.vy = Math.min(this.vy, 28);
      return;
    }
    this.vy = Math.min(this.vy + P.gravity * dt, P.maxFall);
  };

  /** Leitern und Klebewaende: hoch mit Sprungtaste, runter mit Abwaertstaste. */
  Player.prototype.applyClimb = function (dt, input, env) {
    if (env.climb) {
      if (input.jump) { this.vy = P.climbUp; } else if (input.down) { this.vy = P.climbDown; } else { this.vy = 0; }
    } else if (this.clinging && input.jump) {
      this.vy = P.climbUp * 0.6;
    }
  };

  Player.prototype.applyStreams = function (dt, level) {
    var box = this.box();
    for (var i = 0; i < level.streams.length; i++) {
      var s = level.streams[i];
      if (!UDM.overlaps(box, s)) { continue; }
      if (s.dy < 0) {
        this.vy -= 3400 * s.power * dt;
        this.vy = Math.max(this.vy, -460 * s.power - 80);
      } else if (s.dy > 0) {
        this.vy += 2200 * s.power * dt;
      } else {
        this.vx += s.dx * 2400 * s.power * dt;
        this.vx = UDM.clamp(this.vx, -520, 520);
      }
    }
  };

  Player.prototype.isOnOneWay = function (level) {
    var footY = Math.floor((this.y + this.h + 1) / TILE);
    var x0 = Math.floor(this.x / TILE);
    var x1 = Math.floor((this.x + this.w - 1) / TILE);
    for (var tx = x0; tx <= x1; tx++) {
      if (level.isOneWay(tx, footY)) { return true; }
    }
    return false;
  };

  /* ----------------------------------------------------------- Kollision */

  Player.prototype.moveX = function (dx, level) {
    if (dx === 0) { return; }
    this.x += dx;
    var y0 = Math.floor(this.y / TILE);
    var y1 = Math.floor((this.y + this.h - 1) / TILE);
    var edge = dx > 0 ? Math.floor((this.x + this.w - 1) / TILE) : Math.floor(this.x / TILE);

    for (var ty = y0; ty <= y1; ty++) {
      if (!level.isSolid(edge, ty)) { continue; }
      var cell = level.cell(edge, ty);
      if (dx > 0) {
        this.x = edge * TILE - this.w;
      } else {
        this.x = (edge + 1) * TILE;
      }
      if (cell.spec.bounce && Math.abs(this.vx) > 120) {
        this.vx = -this.vx * 0.85;
        this.face = this.vx > 0 ? 1 : -1;
        UDM.Audio.bounce();
      } else {
        this.vx = 0;
      }
      return;
    }
  };

  Player.prototype.moveY = function (dy, level) {
    if (dy === 0) { return; }
    var prevBottom = this.y + this.h;
    this.y += dy;
    var x0 = Math.floor(this.x / TILE);
    var x1 = Math.floor((this.x + this.w - 1) / TILE);

    if (dy > 0) {
      // Bewusst ohne "-1": liegt die Unterkante genau auf der Kachelgrenze,
      // muss die Kachel darunter weiterhin als Boden zaehlen.
      var footRow = Math.floor((this.y + this.h) / TILE);
      for (var tx = x0; tx <= x1; tx++) {
        var solid = level.isSolid(tx, footRow);
        var oneWay = !solid && level.isOneWay(tx, footRow) &&
          this.dropThrough <= 0 && prevBottom <= footRow * TILE + 2;
        if (!solid && !oneWay) { continue; }
        var cell = level.cell(tx, footRow);
        this.y = footRow * TILE - this.h;
        this.land(cell, level);
        return;
      }
      this.onGround = false;
    } else {
      var headRow = Math.floor(this.y / TILE);
      for (var hx = x0; hx <= x1; hx++) {
        if (!level.isSolid(hx, headRow)) { continue; }
        var head = level.cell(hx, headRow);
        this.y = (headRow + 1) * TILE;
        this.vy = head.spec.bounce ? 260 : 0;
        return;
      }
    }
  };

  Player.prototype.land = function (cell, level) {
    var impact = this.vy;
    if (cell && cell.spec.bounce) {
      this.vy = -Math.max(P.bounceMin, Math.abs(impact) * 1.02);
      this.onGround = false;
      this.squash = 0.6;
      UDM.Audio.bounce();
      level.burst(this.centerX(), this.y + this.h, '#7be0a0', 6);
      return;
    }

    this.vy = 0;
    if (!this.onGround && impact > 420) {
      this.squash = UDM.clamp(1 - impact / 4200, 0.72, 0.98);
      level.burst(this.centerX(), this.y + this.h, 'rgba(255,255,255,0.5)', 3);
    }
    this.onGround = true;
    if (cell && cell.spec.crumble && cell.touch < 0) { cell.touch = 0; }
  };

  Player.prototype.updateWallContact = function (level) {
    this.wallDir = 0;
    if (this.onGround) { return; }
    var y0 = Math.floor((this.y + 4) / TILE);
    var y1 = Math.floor((this.y + this.h - 5) / TILE);
    var leftCol = Math.floor((this.x - 2) / TILE);
    var rightCol = Math.floor((this.x + this.w + 2) / TILE);
    for (var ty = y0; ty <= y1; ty++) {
      if (level.isSolid(rightCol, ty)) { this.wallDir = 1; return; }
      if (level.isSolid(leftCol, ty)) { this.wallDir = -1; return; }
    }
  };

  Player.prototype.updateAnim = function (dir) {
    if (!this.alive) { this.anim = 'dead'; return; }
    if (this.finished) { this.anim = 'done'; return; }
    if (this.onLadder) { this.anim = 'wall'; return; }
    if (!this.onGround) {
      if (this.clinging || (this.wallDir !== 0 && this.vy > 0)) { this.anim = 'wall'; }
      else { this.anim = this.vy < 0 ? 'jump' : 'fall'; }
      return;
    }
    this.anim = Math.abs(this.vx) > 25 ? 'run' : 'idle';
  };

  /* ------------------------------------------------------- Tod und Ziel */

  Player.prototype.checkFate = function (level) {
    if (!this.alive || this.finished) { return null; }
    var box = this.box();
    var i;

    if (this.y > UDM.worldHeight() + 40) {
      return this.kill('sturz', null, level);
    }

    if (UDM.overlaps(box, level.goalRect())) {
      return this.finish(level);
    }

    for (i = 0; i < level.hazards.length; i++) {
      var hazard = level.hazards[i];
      if (hazard.cell && hazard.cell.broken) { continue; }
      if (UDM.overlaps(box, hazard.rect)) {
        return this.kill(hazard.cause, hazard.ownerSlot, level);
      }
    }

    for (i = 0; i < level.saws.length; i++) {
      var saw = level.saws[i];
      if (this.circleHit(saw.x, saw.y, saw.radius)) {
        return this.kill('saege', saw.ownerSlot, level);
      }
    }

    for (i = 0; i < level.projectiles.length; i++) {
      var p = level.projectiles[i];
      if (UDM.overlaps(box, p)) {
        level.projectiles.splice(i, 1);
        return this.kill('pfeil', p.ownerSlot, level);
      }
    }

    return null;
  };

  Player.prototype.circleHit = function (cx, cy, r) {
    var nx = UDM.clamp(cx, this.x, this.x + this.w);
    var ny = UDM.clamp(cy, this.y, this.y + this.h);
    var dx = cx - nx;
    var dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  };

  Player.prototype.kill = function (cause, ownerSlot, level) {
    if (!this.alive || this.finished) { return null; }
    this.alive = false;
    this.anim = 'dead';
    this.cause = cause;
    this.killerSlot = (typeof ownerSlot === 'number' && ownerSlot >= 0) ? ownerSlot : null;
    this.deathTimer = 0;
    this.vx = 0;
    this.vy = 0;
    if (level) {
      level.burst(this.centerX(), this.centerY(), this.color, 22);
      level.burst(this.centerX(), this.centerY(), '#ff5566', 10);
    }
    UDM.Audio.die();
    return { type: 'death', cause: cause, killerSlot: this.killerSlot };
  };

  Player.prototype.finish = function (level) {
    if (this.finished || !this.alive) { return null; }
    this.finished = true;
    this.anim = 'done';
    this.cause = 'ziel';
    this.confetti = 1.4;
    if (level) {
      level.burst(this.centerX(), this.centerY(), '#fff05a', 26);
      level.burst(this.centerX(), this.centerY(), this.color, 18);
    }
    UDM.Audio.goal();
    return { type: 'finish', time: this.time };
  };

  Player.prototype.isDone = function () { return this.finished || !this.alive; };

  /* --------------------------------------------- Ferngesteuerte Figuren */

  /** Zielposition vom Server uebernehmen (wird weich angefahren). */
  Player.prototype.setRemoteTarget = function (pos) {
    if (!pos) { return; }
    this.target = pos;
    this.face = pos.face < 0 ? -1 : 1;
    this.anim = pos.anim || 'idle';
    this.alive = pos.anim !== 'dead';
    this.finished = pos.anim === 'done';
  };

  Player.prototype.updateRemote = function (dt) {
    this.animTime += dt;
    if (!this.target) { return; }
    var t = UDM.clamp(dt * 14, 0, 1);
    this.x = UDM.lerp(this.x, this.target.x, t);
    this.y = UDM.lerp(this.y, this.target.y, t);
    this.vx = this.target.vx;
    this.vy = this.target.vy;
  };

  UDM.Player = Player;
}(window));
