/* Hauptcontroller: Phasen, HUD, Spielschleife - Online-Spiel mit Raumcode. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;

  var HAND_SIZE = 4;
  var FINAL_SECONDS = 3;          // grosser Countdown vor Ablauf der Zeit
  var ROUND_CHOICES = [3, 5, 8, 10, 12, 15, 20];
  var CHAR_ORDER = ['duck', 'mule', 'racoon', 'frog'];

  // Spielautomat zu Beginn des eigenen Bauzugs (Sekunden): Hebel geht runter,
  // Walzen laufen an, die erste steht nach ROLL_FIRST, jede weitere
  // ROLL_STEP spaeter; danach bleibt das Ergebnis ROLL_HOLD sichtbar.
  // Den Hebel zieht man selbst (Klick oder Leertaste); wer es vergisst,
  // dem hilft der Automat nach ROLL_AUTO Sekunden. Die Walzen starten
  // ROLL_SPIN nach dem Ziehen.
  var ROLL_AUTO = 15;
  var ROLL_SPIN = 0.25;
  var PULL_KEYS = ['Space', 'Enter', 'ArrowDown', 'KeyS'];
  var ROLL_FIRST = 1.1;
  var ROLL_STEP = 0.4;
  var ROLL_HOLD = 0.8;
  // Walzen: Fenstergroesse, Symbolgroesse und Abstand der Symbole (px).
  var REEL_W = 84;
  var REEL_H = 132;
  var SLOT_ICON = 56;
  var SLOT_STEP = 68;

  // Bauzeiger per Tastatur - ohne Leertaste, die setzt das Bauteil.
  var CURSOR = {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown']
  };

  var Game = {
    cfg: null,
    canvas: null,
    ctx: null,
    level: null,
    players: [],
    phase: 'boot',
    round: 0,
    totalRounds: 8,
    time: 0,
    lastFrame: 0,
    winner: null,
    lastRound: null,
    message: '',
    bannerTimer: 0,
    dom: {},
    overlayKind: '',
    lobbySignature: '',
    // Laufender Spielautomat (null = keiner).
    roll: null,

    build: {
      card: 0, rot: 0, tx: -1, ty: -1, valid: false, busy: false,
      // Zielt gerade mit der Abrissbirne; wreckRot 0 = waagerecht, 1 = senkrecht.
      deleting: false, wreckRot: 0
    },
    // Die Uhr fuehrt der Server (Game::partyClock), hier laeuft sie nur
    // zwischen zwei Abgleichen weiter.
    party: { countdown: 0, time: 0, remaining: 60, limit: 60, started: false, reported: false, lastBeep: -1 },

    net: null,
    server: null,
    mySlot: 0,
    polling: false,
    lastPoll: 0,
    blockSignature: '',

    /* ------------------------------------------------------------- Start */

    init: function (cfg) {
      this.cfg = cfg;
      this.totalRounds = cfg.rounds || 8;
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.cacheDom();
      UDM.Input.init(this.canvas);
      this.bindUi();
      this.initOnline();

      this.lastFrame = performance.now();
      var self = this;
      requestAnimationFrame(function (ts) { self.loop(ts); });
    },

    cacheDom: function () {
      var ids = ['round-label', 'target-label', 'players', 'banner', 'countdown', 'timer',
        'timer-fill', 'overlay', 'slot', 'turn-info', 'hand', 'hints', 'btn-sound', 'btn-rules',
        'btn-giveup', 'level-label', 'log'];
      var self = this;
      ids.forEach(function (id) { self.dom[id] = document.getElementById(id); });
    },

    bindUi: function () {
      var self = this;

      this.dom['btn-sound'].addEventListener('click', function () {
        var on = !UDM.Audio.enabled;
        UDM.Audio.setEnabled(on);
        UDM.Audio.resume();
        this.textContent = on ? '🔊 Ton an' : '🔇 Ton aus';
        this.classList.toggle('muted', !on);
      });

      this.dom['btn-rules'].addEventListener('click', function () { self.showRules(); });
      this.dom['btn-giveup'].addEventListener('click', function () { self.giveUp(); });

      this.dom.overlay.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!el || el.disabled) { return; }
        e.preventDefault();
        self.onOverlayAction(el.getAttribute('data-action'), el);
      });

      // Spielautomat: Hebel (oder das PULL-Schild) anklicken.
      this.dom.slot.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.slot-lever, .pull-sign')) { self.pullLever(); }
      });

      this.dom.hand.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('[data-card]') : null;
        if (!card) { return; }
        if (card.hasAttribute('data-rotate')) {
          self.rotateSelection();
        } else if (card.hasAttribute('data-endturn')) {
          self.endTurn();
        } else {
          self.selectCard(parseInt(card.getAttribute('data-card'), 10));
        }
      });

      global.addEventListener('beforeunload', function () {
        if (self.net) { self.net.leave(); }
      });
    },

    initOnline: function () {
      var self = this;
      this.net = new UDM.Net(this.cfg.online.code, this.cfg.online.token, this.cfg.endpoint);
      this.net.onFatal = function (err) {
        self.showError(err.message || 'Verbindung zum Raum verloren.');
        self.phase = 'error';
      };
      this.net.onError = function () {
        if (self.net.failures > 6) {
          self.setBanner('Verbindungsprobleme …', 2);
        }
      };

      this.phase = 'lobby';
      this.level = new UDM.Level(this.cfg.levels[0]);
      this.pollNow();
    },

    isPowerUp: function (id) {
      return !!(this.cfg.powerups && this.cfg.powerups[id]);
    },

    cardMeta: function (id) {
      return (this.cfg.cards && this.cfg.cards[id]) ||
        (this.cfg.powerups && this.cfg.powerups[id]) || { name: id, desc: '' };
    },

    /** Stellt alle Figuren waehrend der Bauphase auf den Startplatz. */
    parkPlayers: function () {
      for (var i = 0; i < this.players.length; i++) {
        var spawn = this.level.spawnPoint(i);
        this.players[i].reset(spawn.x, spawn.y);
      }
    },

    activeBuilder: function () {
      return this.server && this.server.turnSlot !== null ? this.playerBySlot(this.server.turnSlot) : null;
    },

    isMyTurn: function () {
      var builder = this.activeBuilder();
      return this.phase === 'build' && !!builder && builder.slot === this.mySlot;
    },

    playerBySlot: function (slot) {
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].slot === slot) { return this.players[i]; }
      }
      return null;
    },

    serverPlayer: function (slot) {
      if (!this.server) { return null; }
      for (var i = 0; i < this.server.players.length; i++) {
        if (this.server.players[i].slot === slot) { return this.server.players[i]; }
      }
      return null;
    },

    /* ----------------------------------------------------------- Bauphase */

    stepBuild: function () {
      if (!this.isMyTurn()) {
        this.build.valid = false;
        return;
      }
      var builder = this.activeBuilder();
      var mouse = UDM.Input.mouse;
      var input = UDM.Input;

      // Waehrend die Walzen laufen, wird noch nicht gebaut.
      if (this.roll) {
        this.build.valid = false;
        return;
      }

      // Karten waehlen und drehen.
      for (var k = 0; k < HAND_SIZE; k++) {
        if (input.wasPressed('Digit' + (k + 1))) { this.selectCard(k); }
      }
      if (input.wasPressed('KeyR')) { this.rotateSelection(); }

      // Cursor per Maus oder per Tastatur.
      if (mouse.inside) {
        this.build.tx = mouse.tx;
        this.build.ty = mouse.ty;
      }
      if (input.wasPressed(CURSOR.left)) { this.build.tx = Math.max(0, this.build.tx - 1); }
      if (input.wasPressed(CURSOR.right)) { this.build.tx = Math.min(this.level.cols - 1, this.build.tx + 1); }
      if (input.wasPressed(CURSOR.up)) { this.build.ty = Math.max(0, this.build.ty - 1); }
      if (input.wasPressed(CURSOR.down)) { this.build.ty = Math.min(this.level.rows - 1, this.build.ty + 1); }
      if (this.build.tx < 0) { this.build.tx = Math.floor(this.level.cols / 2); }
      if (this.build.ty < 0) { this.build.ty = Math.floor(this.level.rows / 2); }

      if (this.build.deleting && builder.hand.indexOf('pu_remove') < 0) { this.build.deleting = false; }

      this.build.valid = this.build.deleting
        ? this.wreckTargets(this.build.tx, this.build.ty, this.build.wreckRot).length > 0
        : this.level.canPlaceAt(this.build.tx, this.build.ty, this.selectedType());

      var confirm = mouse.clicked || input.wasPressed('Enter') || input.wasPressed('Space');
      if (confirm) {
        if (this.build.deleting) { this.tryRemove(builder); }
        else { this.tryPlace(); }
      }
      if ((input.wasPressed('Escape') || mouse.right) && this.build.deleting) {
        this.build.deleting = false;
        this.setBanner('', 0);
        this.updateHud();
      }
    },

    /** Wie viele Bauteile darf der Spieler noch setzen? */
    placesLeft: function (player) {
      var info = player ? this.serverPlayer(player.slot) : null;
      return info ? info.places : 0;
    },

    selectCard: function (index) {
      if (!this.isMyTurn() || this.roll) { return; }
      var builder = this.activeBuilder();
      if (!builder.hand || index < 0 || index >= builder.hand.length) { return; }
      var card = builder.hand[index];
      if (this.isPowerUp(card)) {
        if (card === 'pu_remove') {
          // Abrissbirne: erst zielen (R dreht), dann klicken.
          this.build.deleting = !this.build.deleting;
          UDM.Audio.select();
          this.setBanner(this.build.deleting ? 'Zwei Felder abreißen – R dreht, Klick setzt an' : '', 2.4);
          this.updateHud();
        } else {
          this.usePower(index, -1, -1, 0);
        }
        return;
      }
      this.build.card = index;
      this.build.rot = 0;
      this.build.deleting = false;
      UDM.Audio.select();
      this.renderHand();
    },

    rotateSelection: function () {
      if (!this.isMyTurn() || this.roll) { return; }
      if (this.build.deleting) {
        this.build.wreckRot = 1 - this.build.wreckRot;
        UDM.Audio.select();
        this.updateHud();
        return;
      }
      var type = this.selectedType();
      if (!type || !UDM.BLOCKS[type] || !UDM.BLOCKS[type].rotatable) {
        UDM.Audio.deny();
        return;
      }
      this.build.rot = (this.build.rot + 1) % 4;
      UDM.Audio.select();
      this.renderHand();
    },

    /** Das ausgewaehlte Bauteil - Power-ups sind keine Bauteile. */
    selectedType: function () {
      var builder = this.activeBuilder();
      if (!builder || !builder.hand) { return null; }
      var card = builder.hand[this.build.card] || null;
      if (card && this.isPowerUp(card)) {
        // Auf die erste echte Bauteilkarte ausweichen.
        for (var i = 0; i < builder.hand.length; i++) {
          if (!this.isPowerUp(builder.hand[i])) { return builder.hand[i]; }
        }
        return null;
      }
      return card;
    },

    /** Index der gewaehlten Bauteilkarte (ueberspringt Power-ups). */
    selectedIndex: function () {
      var builder = this.activeBuilder();
      var type = this.selectedType();
      if (!builder || !type) { return -1; }
      return builder.hand[this.build.card] === type ? this.build.card : builder.hand.indexOf(type);
    },

    /** Die zwei Felder der Abrissbirne - wie Game::wreckTiles() in PHP. */
    wreckTiles: function (tx, ty, rot) {
      return rot % 2 === 0 ? [[tx, ty], [tx + 1, ty]] : [[tx, ty], [tx, ty + 1]];
    },

    /** Alle Bauteile, die auf einem der beiden Felder liegen. */
    wreckTargets: function (tx, ty, rot) {
      var level = this.level;
      var found = [];
      this.wreckTiles(tx, ty, rot).forEach(function (tile) {
        var cell = level.cell(tile[0], tile[1]);
        if (cell && cell.kind === 'block' && found.indexOf(cell) < 0) { found.push(cell); }
      });
      return found;
    },

    /**
     * Power-up einsetzen (Game::usePower() in PHP). Nur die Abrissbirne
     * braucht ein Ziel; alle anderen wirken in der folgenden Partyphase.
     */
    usePower: function (index, tx, ty, rot) {
      var builder = this.activeBuilder();
      var card = builder.hand[index];
      var meta = this.cardMeta(card);
      var targets = card === 'pu_remove' ? this.wreckTargets(tx, ty, rot) : [];
      var self = this;

      this.build.busy = true;
      this.net.call('power', { card: index, x: tx, y: ty, rot: rot }).then(function (data) {
        self.build.busy = false;
        self.build.deleting = false;
        self.build.card = 0;
        if (card === 'pu_remove') {
          targets.forEach(function (cell) {
            self.level.burst((cell.tx + (cell.w || 1) / 2) * TILE, (cell.ty + (cell.h || 1) / 2) * TILE, '#ffffff', 14);
          });
          UDM.Render.kick(4);
          UDM.Audio.die();
          self.setBanner('Weg damit!', 1.4);
        } else {
          UDM.Audio.goal();
          self.setBanner(meta.name + ' für diese Runde!', 1.6);
        }
        self.applyServerState(data.state);
      }).catch(function (err) {
        self.build.busy = false;
        UDM.Audio.deny();
        self.setBanner(err.message || 'Das hat nicht geklappt.', 1.8);
        if (err.state) { self.applyServerState(err.state); }
      });
    },

    /** Zug vorzeitig beenden. */
    endTurn: function () {
      if (!this.isMyTurn() || this.roll) { return; }
      var self = this;
      this.net.call('skip').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
    },

    tryPlace: function () {
      if (this.build.busy) { return; }
      var type = this.selectedType();
      if (!type) { return; }
      if (this.level.blockedByGrave(this.build.tx, this.build.ty, type)) {
        UDM.Audio.deny();
        this.setBanner('Hier wurde eben erst ' + this.cardMeta(type).name + ' entfernt – nächste Runde wieder', 2);
        return;
      }
      if (!this.level.canPlaceAt(this.build.tx, this.build.ty, type)) {
        UDM.Audio.deny();
        this.setBanner('Da passt nichts hin!', 1.2);
        return;
      }

      var self = this;
      this.build.busy = true;
      this.net.call('place', {
        card: this.selectedIndex(),
        x: this.build.tx,
        y: this.build.ty,
        rot: this.build.rot
      }).then(function (data) {
        self.build.busy = false;
        self.build.card = 0;
        self.build.rot = 0;
        UDM.Audio.place();
        UDM.Render.kick(2);
        self.applyServerState(data.state);
      }).catch(function (err) {
        self.build.busy = false;
        UDM.Audio.deny();
        self.setBanner(err.message || 'Das hat nicht geklappt.', 1.8);
        if (err.state) { self.applyServerState(err.state); }
      });
    },

    /** Abrissbirne auf die zwei Felder unter dem Cursor. */
    tryRemove: function (builder) {
      if (this.build.busy) { return; }
      var index = builder.hand.indexOf('pu_remove');
      if (index < 0) {
        this.build.deleting = false;
        return;
      }
      if (!this.wreckTargets(this.build.tx, this.build.ty, this.build.wreckRot).length) {
        UDM.Audio.deny();
        this.setBanner('Da liegt kein Bauteil', 1.2);
        return;
      }
      this.usePower(index, this.build.tx, this.build.ty, this.build.wreckRot);
    },

    /* --------------------------------------------------------- Partyphase */

    /** Start der Partyphase - mit der Uhr des Servers, damit alle gleich laufen. */
    beginParty: function (clock) {
      this.phase = 'party';
      var countdown = clock ? clock.countdown : 2.2;
      var elapsed = clock ? clock.elapsed : 0;
      this.party.limit = clock ? clock.limit : 60;
      this.party.countdown = Math.max(0, countdown - elapsed);
      this.party.remaining = clock ? clock.remaining : this.party.limit + countdown;
      this.party.time = Math.max(0, elapsed - countdown);
      this.party.started = this.party.countdown <= 0;
      this.party.reported = false;
      this.party.lastBeep = -1;

      this.level.resetRound();
      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        var spawn = this.level.spawnPoint(i);
        p.reset(spawn.x, spawn.y);
        // Power-ups aus der Bauphase wirken genau in dieser Partyphase.
        p.applyBuffs(p.buffs || []);
      }
      this.setBanner('');
      this.updateHud();
    },

    /**
     * Uhr nachstellen, wenn sie merklich vom Server abweicht - etwa weil
     * jemand im Ziel ist und die Restzeit auf 10 Sekunden gefallen ist.
     */
    syncPartyClock: function (clock) {
      if (!clock) { return; }
      if (Math.abs(clock.remaining - this.party.remaining) > 0.25) {
        this.party.remaining = clock.remaining;
      }
      var countdown = Math.max(0, clock.countdown - clock.elapsed);
      if (this.party.countdown > 0 && Math.abs(countdown - this.party.countdown) > 0.25) {
        this.party.countdown = countdown;
      }
    },

    stepParty: function (dt, firstStep) {
      if (this.party.countdown > 0) {
        var before = Math.ceil(this.party.countdown);
        this.party.countdown -= dt;
        this.party.remaining -= dt;
        var after = Math.ceil(this.party.countdown);
        if (after !== before && after > 0) { UDM.Audio.tick(); }
        if (this.party.countdown <= 0) {
          this.party.started = true;
          UDM.Audio.start();
          this.updateHud();
        }
        this.level.update(dt, 0);
        return;
      }

      this.party.time += dt;
      this.party.remaining = Math.max(0, this.party.remaining - dt);
      this.level.update(dt, this.party.time);

      // Die letzten Sekunden ticken hoerbar herunter.
      var second = Math.ceil(this.party.remaining);
      if (this.party.remaining > 0 && second <= FINAL_SECONDS && second !== this.party.lastBeep && this.anyoneRunning()) {
        this.party.lastBeep = second;
        UDM.Audio.tick();
      }

      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        if (p.remote) {
          p.updateRemote(dt);
          continue;
        }
        var input = p.isDone() ? UDM.Input.idle() : UDM.Input.stateFor(UDM.SOLO_LAYOUT);
        if (!firstStep) { input.jumpPressed = false; }
        p.update(dt, input, this.level);
        var event = p.checkFate(this.level);
        if (event) {
          UDM.Render.kick(event.type === 'death' ? 7 : event.type === 'shield' ? 3 : 4);
          this.updateHud();
        }
        // Zeit abgelaufen: die eigene Figur scheidet aus.
        if (this.party.remaining <= 0 && !p.isDone()) {
          p.kill('zeit', null, this.level);
          this.updateHud();
        }
      }

      this.reportOwnResult();
    },

    /** Laeuft noch irgendeine Figur? */
    anyoneRunning: function () {
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].connected !== false && !this.players[i].isDone()) { return true; }
      }
      return false;
    },

    reportOwnResult: function () {
      if (this.party.reported) { return; }
      var me = this.playerBySlot(this.mySlot);
      if (!me || me.remote || !me.isDone()) { return; }
      this.party.reported = true;
      var self = this;
      this.net.call('result', {
        finished: me.finished,
        time: Math.round(me.time * 100) / 100,
        killerSlot: me.killerSlot,
        assistSlot: me.assistSlot,
        killerBlock: me.killerBlock,
        assistBlock: me.assistBlock,
        cause: me.cause
      }).then(function (data) {
        self.applyServerState(data.state);
      }).catch(function () {
        self.party.reported = false;
      });
    },

    /** Aufgeben: die eigene Figur scheidet aus. */
    giveUp: function () {
      if (this.phase !== 'party') { return; }
      var me = this.playerBySlot(this.mySlot);
      if (!me || me.isDone()) { return; }
      me.kill('aufgabe', null, this.level);
      UDM.Render.kick(4);
      this.setBanner('Aufgegeben', 1.6);
      this.updateHud();
    },

    /** Knopf nur zeigen, wenn es etwas aufzugeben gibt. */
    refreshGiveUp: function () {
      var me = this.playerBySlot(this.mySlot);
      var show = this.phase === 'party' && this.party.countdown <= 0 && !!me && !me.isDone();
      this.dom['btn-giveup'].classList.toggle('hidden', !show);
    },

    /* ------------------------------------------------------ Serverabgleich */

    pollNow: function () {
      if (!this.net || this.polling || this.phase === 'error') { return; }
      var self = this;
      this.polling = true;
      this.lastPoll = performance.now();

      var pos = null;
      var me = this.playerBySlot(this.mySlot);
      if (this.phase === 'party' && me && !me.remote) {
        pos = {
          x: Math.round(me.x * 10) / 10,
          y: Math.round(me.y * 10) / 10,
          vx: Math.round(me.vx),
          vy: Math.round(me.vy),
          face: me.face,
          anim: me.anim,
          shield: me.shield > 0
        };
      }

      // Der Bauende meldet nur, wo und was er setzen will - keine Handkarten.
      var build = null;
      if (this.isMyTurn()) {
        build = {
          type: this.build.deleting ? null : this.selectedType(),
          rot: this.build.deleting ? this.build.wreckRot : this.build.rot,
          deleting: this.build.deleting,
          tx: this.build.tx,
          ty: this.build.ty
        };
      }

      this.net.sync(pos, build).then(function (data) {
        self.polling = false;
        self.applyServerState(data.state);
      }).catch(function () {
        self.polling = false;
      });
    },

    applyServerState: function (state) {
      if (!state) { return; }
      var previous = this.server;
      this.server = state;
      this.mySlot = state.youSlot !== null ? state.youSlot : 0;
      this.round = state.round;
      this.totalRounds = state.rounds || this.totalRounds;

      this.syncColors(state);
      this.syncLevel(state);
      this.syncPlayers(state);

      var phaseChanged = !previous || previous.phase !== state.phase ||
        (previous.round !== state.round && state.phase === 'build');

      if (state.phase === 'party') {
        if (this.phase !== 'party' || phaseChanged) { this.beginParty(state.party); }
        else { this.syncPartyClock(state.party); }
      } else if (state.phase === 'build') {
        if (this.phase !== 'build' || phaseChanged) {
          this.phase = 'build';
          this.build.card = 0;
          this.build.rot = 0;
          this.build.deleting = false;
          this.level.resetRound();
          this.parkPlayers();
          this.hideOverlay();
        }
        // Nur beim Wechsel des Bauenden - sonst ueberschreibt jeder Abgleich
        // Hinweise wie den der Abrissbirne.
        var builder = this.activeBuilder();
        if (builder && (phaseChanged || previous.turnSlot !== state.turnSlot)) {
          this.build.deleting = false;
          this.setBanner(builder.slot === this.mySlot ? 'Du baust!' : (builder.name + ' baut …'));
          if (builder.slot === this.mySlot) { this.startRoll(builder.hand); }
          else { this.stopRoll(); }
        }
      } else if (state.phase === 'score') {
        if (this.phase !== 'score') {
          this.phase = 'score';
          this.lastRound = state.lastRound;
          this.showScore();
        }
      } else if (state.phase === 'over') {
        if (this.phase !== 'over') {
          this.phase = 'over';
          this.lastRound = state.lastRound;
          this.winner = state.winner;
          UDM.Audio.win();
          this.showWinner();
        }
      } else if (state.phase === 'lobby') {
        this.phase = 'lobby';
        this.showLobby();
      }

      this.updateHud();
    },

    /** Gewaehlte Farben fuer alles, was per slotColor() faerbt. */
    syncColors: function (state) {
      var colors = {};
      state.players.forEach(function (p) {
        if (p.color) { colors[p.slot] = p.color; }
      });
      UDM.playerColors = colors;
    },

    syncLevel: function (state) {
      if (this.level) { this.level.graves = state.graves || []; }
      var signature = state.levelId + '|' + state.blocks.length +
        (state.blocks.length ? '|' + state.blocks[state.blocks.length - 1].id : '') +
        '|' + state.blocks.map(function (b) { return b.id; }).join(',');
      if (signature === this.blockSignature) { return; }
      this.blockSignature = signature;

      if (!this.level || this.level.def.id !== state.levelId) {
        this.level = new UDM.Level(this.levelDef(state.levelId) || this.cfg.levels[0]);
        this.dom['level-label'].textContent = this.level.def.name;
      }
      this.level.rebuild(state.blocks);
      this.level.graves = state.graves || [];
    },

    syncPlayers: function (state) {
      for (var i = 0; i < state.players.length; i++) {
        var info = state.players[i];
        var player = this.playerBySlot(info.slot);
        if (!player) {
          player = new UDM.Player(info.slot, info);
          this.players.push(player);
          this.players.sort(function (a, b) { return a.slot - b.slot; });
        }
        player.name = info.name;
        player.char = info.char;
        player.color = info.color || UDM.slotColor(info.slot);
        player.dark = UDM.darken(player.color);
        player.score = info.score;
        player.connected = info.connected;
        player.placedThisRound = info.placed;
        player.buffs = info.buffs || [];
        player.remote = info.slot !== this.mySlot;
        // Handkarten kommen nur fuer die eigene Figur.
        player.hand = info.you ? (info.hand || []) : [];
        if (player.remote && state.phase === 'party' && info.pos) {
          if (player.x === 0 && player.y === 0) {
            player.x = info.pos.x;
            player.y = info.pos.y;
          }
          player.setRemoteTarget(info.pos);
        }
      }
    },

    /* ---------------------------------------------------------- Oberflaeche */

    setBanner: function (text, seconds) {
      this.message = text;
      this.dom.banner.textContent = text;
      this.dom.banner.classList.toggle('hidden', !text);
      this.bannerTimer = seconds || 0;
    },

    updateHud: function () {
      this.dom['round-label'].textContent = this.round > 0
        ? 'Runde ' + Math.min(this.round, this.totalRounds) + ' / ' + this.totalRounds
        : 'Lobby';
      this.renderPlayers();
      this.renderHand();
      this.renderHints();
      this.refreshGiveUp();
    },

    renderPlayers: function () {
      var builder = this.activeBuilder();
      var html = '';
      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        var classes = ['pcard'];
        if (builder && builder.slot === p.slot && this.phase === 'build') { classes.push('active'); }
        if (p.slot === this.mySlot) { classes.push('me'); }
        if (p.connected === false) { classes.push('offline'); }
        if (this.phase === 'party' && !p.alive) { classes.push('dead'); }
        if (this.phase === 'party' && p.finished) { classes.push('finished'); }

        var status = '';
        if (this.phase === 'party') {
          status = p.finished ? 'im Ziel' : (p.alive ? '…' : (UDM.DEATH_LABELS[p.cause] || 'tot'));
        } else if (this.phase === 'build') {
          var position = this.buildOrderSlots().indexOf(p.slot) + 1;
          if (p.placedThisRound) { status = 'fertig'; }
          else if (builder && builder.slot === p.slot) { status = 'baut gerade'; }
          else { status = position > 0 ? 'baut als ' + position + '.' : 'baut noch'; }
        } else if (p.connected === false) {
          status = 'offline';
        }

        html += '<div class="' + classes.join(' ') + '" style="--c:' + p.color + '">' +
          '<span class="pdot"></span>' +
          '<span class="pname">' + UDM.escapeHtml(p.name) + '</span>' +
          '<span class="pscore">' + p.score + '</span>' +
          '<span class="pstatus">' + status + this.buffBadges(p) + '</span>' +
          '</div>';
      }
      this.dom.players.innerHTML = html;
    },

    /** Kleine Marken fuer die Power-ups, die diese Runde wirken. */
    buffBadges: function (player) {
      if (this.phase !== 'build' && this.phase !== 'party') { return ''; }
      var self = this;
      return (player.buffs || []).map(function (id) {
        return ' <span class="pbuff" title="' + UDM.escapeHtml(self.cardMeta(id).name) + '">' +
          (UDM.BUFF_BADGES[id] || '★') + '</span>';
      }).join('');
    },

    /** Bau-Reihenfolge dieser Runde als Liste von Spielerplaetzen. */
    buildOrderSlots: function () {
      return (this.server && this.server.buildOrder) || [];
    },

    /** Was der Bauende gerade vorhat - so, wie der Server es weitergibt. */
    remoteBuildView: function (builder) {
      var view = this.server && this.server.buildView;
      if (view && view.slot === builder.slot) { return view; }
      return { type: null, rot: 0, deleting: false, tx: -1, ty: -1 };
    },

    renderHand: function () {
      var builder = this.activeBuilder();
      if (this.phase !== 'build' || !builder) {
        this.dom.hand.innerHTML = '';
        this.dom['turn-info'].textContent = this.phaseLabel();
        return;
      }

      var name = '<strong style="color:' + builder.color + '">' + UDM.escapeHtml(builder.name) + '</strong>';
      if (builder.slot !== this.mySlot) {
        // Zuschauer sehen im Level, wo gebaut wird - aber nicht die Hand.
        this.dom['turn-info'].innerHTML = name + ' baut gerade …';
        this.dom.hand.innerHTML = '<div class="spectate-note">Du schaust zu, wo gebaut wird.</div>';
        return;
      }

      var places = this.placesLeft(builder);
      var quota = '<span class="quota"><b>' + places + '</b> Bauteil' + (places === 1 ? '' : 'e') + ' übrig' +
        ((builder.buffs || []).length ? ' · ' + this.buffBadges(builder) : '') + '</span>';
      this.dom['turn-info'].innerHTML = name + ' ist am Zug<br>' + quota;

      var hand = builder.hand || [];
      if (this.roll) {
        this.dom.hand.innerHTML = '<div class="spectate-note">' +
          (this.roll.pulled ? 'Der Automat läuft …' : 'Zieh am Hebel!') + '</div>';
        return;
      }
      var selectedIndex = this.selectedIndex();
      var html = '';
      for (var i = 0; i < hand.length; i++) {
        var id = hand[i];
        var meta = this.cardMeta(id);
        var power = this.isPowerUp(id);
        var selected = power ? (id === 'pu_remove' && this.build.deleting) : (i === selectedIndex && !this.build.deleting);
        html += '<button class="card' + (power ? ' power' : '') + (selected ? ' selected' : '') + '"' +
          ' data-card="' + i + '" title="' + UDM.escapeHtml(meta.desc) + '">' +
          '<span class="ckey">' + (power ? '★' : '') + (i + 1) + '</span>' +
          '<canvas class="cicon" width="40" height="40" data-type="' + id + '"></canvas>' +
          '<span class="cname">' + UDM.escapeHtml(meta.name) + '</span>' +
          '</button>';
      }

      var label;
      var icon;
      var enabled;
      if (this.build.deleting) {
        enabled = true;
        label = this.build.wreckRot ? 'senkrecht' : 'waagerecht';
        icon = '<span class="rot-icon">' + (this.build.wreckRot ? '↕' : '↔') + '</span>';
      } else {
        var type = this.selectedType();
        enabled = !!(type && UDM.BLOCKS[type] && UDM.BLOCKS[type].rotatable);
        label = enabled ? ['nach oben', 'nach rechts', 'nach unten', 'nach links'][this.build.rot] : 'Drehen';
        icon = '<span class="rot-icon" style="transform:rotate(' + (this.build.rot * 90 - 90) + 'deg)">➤</span>';
      }
      html += '<button class="card rotate' + (enabled ? '' : ' disabled') +
        '" data-card="-1" data-rotate="1" title="Drehen (Taste R)">' +
        '<span class="ckey">R</span>' + icon + '<span class="cname">' + label + '</span></button>';

      html += '<button class="card endturn" data-card="-3" data-endturn="1"' +
        ' title="Zug beenden, ohne weitere Bauteile zu setzen">' +
        '<span class="rot-icon">⏭</span><span class="cname">Zug beenden</span></button>';

      this.dom.hand.innerHTML = html;
      this.paintCardIcons(this.build.rot);
    },

    /* ------------------------------------------------------ Spielautomat */

    /**
     * Zu Beginn des eigenen Bauzugs erscheint in der Bildschirmmitte ein
     * Spielautomat: der Hebel geht runter, die Walzen laufen an, bremsen ab
     * und rasten nacheinander auf den gezogenen Karten ein.
     */
    startRoll: function (hand) {
      if (!hand || !hand.length) {
        this.stopRoll();
        return;
      }
      var pool = Object.keys(this.cfg.cards).concat(Object.keys(this.cfg.powerups || {}));
      var pick = function () { return pool[Math.floor(Math.random() * pool.length)]; };
      this.roll = {
        time: 0,
        pulled: false,
        pullAt: 0,
        finishing: false,
        reels: hand.map(function (id, i) {
          var dur = ROLL_FIRST + i * ROLL_STEP;
          // So viele Symbole laufen durch, bis die Walze steht.
          var final = Math.round(dur * 7) + 4;
          var strip = [];
          for (var k = 0; k <= final + 2; k++) { strip.push(pick()); }
          strip[final] = id;
          return { id: id, dur: dur, final: final, strip: strip, pos: 0, speed: 0, tick: 0, landedAt: -1 };
        })
      };
      this.buildSlot(hand.length);
      this.renderHand();
    },

    /** Automat beenden - mit kurzem Ausblenden, wenn er gerade zu sehen ist. */
    stopRoll: function (fade) {
      this.roll = null;
      var slot = this.dom.slot;
      if (!slot || slot.classList.contains('hidden')) { return; }
      if (!fade) {
        slot.className = 'slot hidden';
        slot.innerHTML = '';
        return;
      }
      slot.classList.add('leaving');
      setTimeout(function () {
        if (slot.classList.contains('leaving')) {
          slot.className = 'slot hidden';
          slot.innerHTML = '';
        }
      }, 260);
    },

    /** Der Automat als HTML ueber dem Level; die Walzen sind Canvas. */
    buildSlot: function (count) {
      var slot = this.dom.slot;
      var reels = '';
      for (var i = 0; i < count; i++) {
        reels += '<div class="slot-reel" data-reel="' + i + '">' +
          '<canvas width="' + REEL_W + '" height="' + REEL_H + '"></canvas>' +
          '<span class="slot-name">&nbsp;</span></div>';
      }
      var lights = '';
      for (var l = 0; l < 9; l++) { lights += '<i style="animation-delay:' + (l * 0.11).toFixed(2) + 's"></i>'; }
      slot.innerHTML =
        '<div class="slot-machine">' +
        '<div class="slot-lights">' + lights + '</div>' +
        '<div class="slot-title">★ Bauteil-Automat ★</div>' +
        '<div class="slot-window">' + reels + '<div class="slot-payline"></div></div>' +
        '<div class="slot-foot">Viel Glück!</div>' +
        '<div class="slot-lever" title="Hebel ziehen"><div class="lever-base"></div>' +
        '<div class="lever-arm"><div class="lever-knob"></div></div></div>' +
        '<div class="pull-sign" title="Hebel ziehen">' +
        '<span class="pull-arrows"><i>◀</i><i>◀</i><i>◀</i></span>' +
        '<div class="pull-board">' + this.bulbs(7) + '<b>PULL!</b>' + this.bulbs(7) + '</div>' +
        '</div>' +
        '</div>';
      slot.className = 'slot';
      this.paintSlot();
    },

    /** Eine Reihe Gluehbirnen fuer das PULL-Schild (blinken abwechselnd). */
    bulbs: function (count) {
      var html = '<span class="bulbs">';
      for (var i = 0; i < count; i++) { html += '<i class="' + (i % 2 ? 'odd' : 'even') + '"></i>'; }
      return html + '</span>';
    },

    /** Hebel ziehen: Klack, Schild weg, gleich laufen die Walzen an. */
    pullLever: function () {
      var roll = this.roll;
      if (!roll || roll.pulled) { return; }
      roll.pulled = true;
      roll.pullAt = roll.time;
      this.dom.slot.classList.add('pulled');
      var lever = this.dom.slot.querySelector('.slot-lever');
      if (lever) { lever.classList.add('pulled'); }
      UDM.Audio.lever();
      this.updateHud();
    },

    /** Symbol einer Karte, einmal gezeichnet und dann wiederverwendet. */
    slotIcon: function (id) {
      this.iconCache = this.iconCache || {};
      if (!this.iconCache[id]) {
        var canvas = document.createElement('canvas');
        canvas.width = SLOT_ICON;
        canvas.height = SLOT_ICON;
        UDM.Render.drawCardIcon(canvas, id, 0, 0);
        this.iconCache[id] = canvas;
      }
      return this.iconCache[id];
    },

    /** Hebel ziehen, Walzen drehen und nacheinander einrasten lassen. */
    updateRoll: function (dt) {
      var roll = this.roll;
      if (!roll) { return; }
      if (!this.isMyTurn()) {
        this.stopRoll();
        return;
      }

      roll.time += dt;
      if (!roll.pulled && (UDM.Input.wasPressed(PULL_KEYS) || roll.time >= ROLL_AUTO)) {
        this.pullLever();
      }

      var t = roll.pulled ? roll.time - roll.pullAt - ROLL_SPIN : 0;
      var ticked = false;
      var lastLanding = 0;
      var allLanded = true;
      for (var i = 0; i < roll.reels.length; i++) {
        var reel = roll.reels[i];
        if (t <= 0) { allLanded = false; continue; }
        var u = Math.min(1, t / reel.dur);
        if (u < 1) {
          // Schnell los, dann immer langsamer (ease-out).
          reel.pos = reel.final * (1 - Math.pow(1 - u, 3));
          reel.speed = 3 * reel.final * Math.pow(1 - u, 2) / reel.dur;
          allLanded = false;
        } else {
          if (reel.landedAt < 0) {
            reel.landedAt = roll.time;
            reel.speed = 0;
            UDM.Audio.reel(i);
            var el = this.dom.slot.querySelector('[data-reel="' + i + '"]');
            if (el) {
              el.classList.add('landed');
              el.classList.toggle('power', this.isPowerUp(reel.id));
              el.querySelector('.slot-name').textContent = this.cardMeta(reel.id).name;
            }
          }
          // Kleines Nachwippen beim Einrasten.
          var b = (roll.time - reel.landedAt) / 0.28;
          reel.pos = reel.final + (b < 1 ? -0.16 * Math.sin(Math.PI * b) * (1 - b) : 0);
          lastLanding = Math.max(lastLanding, reel.landedAt);
        }
        var index = Math.floor(reel.pos + 0.5);
        if (index !== reel.tick && reel.landedAt < 0) {
          reel.tick = index;
          ticked = true;
        }
      }
      if (ticked) { UDM.Audio.spin(); }

      if (allLanded && !roll.finishing && roll.time >= lastLanding + 0.2) {
        roll.finishing = true;
        UDM.Audio.jackpot();
        this.dom.slot.classList.add('win');
      }
      if (allLanded && roll.time >= lastLanding + ROLL_HOLD) {
        // Alles steht - der Automat verschwindet, jetzt wird gebaut.
        this.stopRoll(true);
        this.updateHud();
        return;
      }
      this.paintSlot();
    },

    /** Walzen zeichnen: sichtbare Symbole, Bewegungsunschaerfe, Schatten. */
    paintSlot: function () {
      var roll = this.roll;
      if (!roll) { return; }
      var canvases = this.dom.slot.querySelectorAll('.slot-reel canvas');
      for (var r = 0; r < canvases.length; r++) {
        var reel = roll.reels[r];
        if (!reel) { continue; }
        var ctx = canvases[r].getContext('2d');
        var w = canvases[r].width;
        var h = canvases[r].height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f4f1e8';
        ctx.fillRect(0, 0, w, h);

        var base = Math.floor(reel.pos);
        ctx.save();
        if (reel.speed > 9) { ctx.filter = 'blur(' + Math.min(3, reel.speed / 8).toFixed(1) + 'px)'; }
        for (var k = base - 2; k <= base + 2; k++) {
          if (k < 0 || k >= reel.strip.length) { continue; }
          // Symbole wandern von oben nach unten durchs Fenster.
          var y = h / 2 + (reel.pos - k) * SLOT_STEP;
          if (y < -SLOT_ICON || y > h + SLOT_ICON) { continue; }
          ctx.drawImage(this.slotIcon(reel.strip[k]), (w - SLOT_ICON) / 2, y - SLOT_ICON / 2);
        }
        ctx.restore();

        var shade = ctx.createLinearGradient(0, 0, 0, h);
        shade.addColorStop(0, 'rgba(20,16,40,0.75)');
        shade.addColorStop(0.28, 'rgba(20,16,40,0)');
        shade.addColorStop(0.72, 'rgba(20,16,40,0)');
        shade.addColorStop(1, 'rgba(20,16,40,0.75)');
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, w, h);
      }
    },

    /** Malt die Mini-Vorschau in die Kartenbuttons. */
    paintCardIcons: function (rot) {
      var icons = this.dom.hand.querySelectorAll('canvas.cicon');
      for (var i = 0; i < icons.length; i++) {
        UDM.Render.drawCardIcon(icons[i], icons[i].getAttribute('data-type'), rot, this.time);
      }
    },

    phaseLabel: function () {
      switch (this.phase) {
        case 'party': return this.party.countdown > 0 ? 'Gleich geht es los …' : 'Party! Rennt zur Fahne!';
        case 'score': return 'Punkte werden verteilt';
        case 'over': return 'Match beendet';
        case 'lobby': return 'Warten auf Mitspieler';
        default: return '';
      }
    },

    renderHints: function () {
      var html = '';
      if (this.phase === 'build' && !this.isMyTurn()) {
        var me = this.playerBySlot(this.mySlot);
        var pos = this.buildOrderSlots().indexOf(this.mySlot) + 1;
        html = me && me.placedThisRound
          ? '<span>Du hast schon gebaut – jetzt heißt es zuschauen.</span>'
          : '<span>Du baust als <b>' + pos + '.</b> – bis dahin zuschauen.</span>';
      } else if (this.phase === 'build' && this.roll && !this.roll.pulled) {
        html = '<span><b>Hebel anklicken</b> oder <b>Leertaste</b> – deine Karten werden gezogen.</span>';
      } else if (this.phase === 'build' && this.roll) {
        html = '<span>Die Walzen drehen – gleich geht es los.</span>';
      } else if (this.phase === 'build' && this.build.deleting) {
        html = '<span><b>R</b> waagerecht / senkrecht</span><span><b>Klick</b> abreißen</span>' +
          '<span><b>Rechtsklick</b> / <b>Esc</b> abbrechen</span>';
      } else if (this.phase === 'build') {
        html = '<span><b>Maus</b> platzieren</span><span><b>1-4</b> Karte</span>' +
          '<span><b>R</b> drehen</span>' +
          '<span>★ Power-ups vor dem eigenen Bauteil einsetzen</span>';
      } else {
        html = '<span><b>' + UDM.SOLO_LAYOUT.label + '</b></span><span>Wandsprung: an der Wand springen</span>';
      }
      this.dom.hints.innerHTML = html;
    },

    /* ------------------------------------------------------------ Overlays */

    showOverlay: function (html, extraClass) {
      this.overlayKind = extraClass || '';
      this.dom.overlay.className = 'overlay' + (extraClass ? ' ' + extraClass : '');
      this.dom.overlay.innerHTML = '<div class="panel">' + html + '</div>';
      this.dom.overlay.scrollTop = 0;
    },

    hideOverlay: function () {
      this.overlayKind = '';
      this.dom.overlay.className = 'overlay hidden';
      this.dom.overlay.innerHTML = '';
    },

    /**
     * Lobby: Mitspieler, eigene Farbe, Welt und Rundenzahl - kompakt in zwei
     * Spalten. Der Gastgeber waehlt Welt und Runden, alle anderen sehen live,
     * was gewaehlt ist. Seine Farbe waehlt jeder selbst.
     */
    showLobby: function () {
      var state = this.server;
      if (!state) { return; }
      // Regeln nicht wegziehen, waehrend jemand sie liest - beim Schliessen
      // kommt die Lobby von selbst zurueck.
      if (this.overlayKind === 'rules') { return; }

      // Nur neu aufbauen, wenn sich etwas geaendert hat - sonst flackern
      // die Vorschaubilder bei jedem Abgleich.
      var signature = JSON.stringify([
        state.players.map(function (p) { return [p.slot, p.name, p.char, p.color, p.host, p.connected]; }),
        state.levelId, state.randomLevel, state.rounds, state.isHost
      ]);
      if (signature === this.lobbySignature && this.dom.overlay.querySelector('.lobby')) { return; }
      this.lobbySignature = signature;

      var rows = state.players.map(function (p) {
        return '<li style="--c:' + p.color + '"' + (p.connected ? '' : ' class="offline"') + '>' +
          '<span class="pdot"></span><span class="lname">' + UDM.escapeHtml(p.name) + '</span>' +
          (p.host ? ' <em>Gastgeber</em>' : '') +
          (p.you ? ' <em>du</em>' : '') +
          '<small>' + (UDM.CHARACTERS[p.char] ? UDM.CHARACTERS[p.char].label : p.char) + '</small></li>';
      }).join('');

      // Farbwahl: belegte Farben sind gesperrt und zeigen, wer sie hat.
      var mine = null;
      var myChar = null;
      var owners = {};
      state.players.forEach(function (p) {
        if (p.you) {
          mine = p.color;
          myChar = p.char;
        } else {
          owners[p.color] = p.name;
        }
      });
      // Tierwahl: dasselbe Tier darf es mehrfach geben.
      var figs = CHAR_ORDER.map(function (id) {
        var label = UDM.CHARACTERS[id] ? UDM.CHARACTERS[id].label : id;
        return '<button type="button" class="fig' + (id === myChar ? ' on' : '') + '" data-action="char"' +
          ' data-char="' + id + '" title="' + label + '"><canvas width="40" height="40" data-fig="' + id + '"></canvas></button>';
      }).join('');
      var swatches = (this.cfg.colors || UDM.SLOT_COLORS).map(function (color) {
        var owner = owners[color];
        return '<button type="button" class="swatch' + (color === mine ? ' on' : '') + '" style="--c:' + color + '"' +
          ' data-action="color" data-color="' + color + '"' + (owner ? ' disabled' : '') +
          ' title="' + (owner ? 'hat ' + UDM.escapeHtml(owner) : 'Diese Farbe nehmen') + '"></button>';
      }).join('');

      var levelName = state.randomLevel ? 'Zufall' : this.levelName(state.levelId);
      var canStart = state.isHost && state.players.length >= 2;
      var rounds = state.rounds || 8;
      var side = '<div class="lobby-label">Spieler (' + state.players.length + '/4)</div>' +
        '<ul class="lobby-list">' + rows + '</ul>' +
        '<div class="lobby-me">' +
        '<div class="me-row"><span class="lobby-label">Tier</span><div class="figs">' + figs + '</div></div>' +
        '<div class="me-row"><span class="lobby-label">Farbe</span><div class="swatches">' + swatches + '</div></div>' +
        '</div>';
      var main;

      if (state.isHost) {
        side += '<div class="lobby-label">Spiellänge (Runden)</div><div class="chips">' +
          ROUND_CHOICES.map(function (n) {
            return '<button type="button" class="chip' + (n === rounds ? ' on' : '') +
              '" data-action="rounds" data-rounds="' + n + '">' + n + '</button>';
          }).join('') + '</div>' +
          '<button class="big" data-action="start"' + (canStart ? '' : ' disabled') + '>Spiel starten</button>' +
          (canStart ? '' : '<p class="muted small lobby-note">Mindestens 2 Spieler nötig.</p>');

        main = '<div class="lobby-label">Welt: <b>' + UDM.escapeHtml(levelName) + '</b></div>' +
          '<div class="level-picker lobby-picker">' +
          '<button type="button" class="lvl' + (state.randomLevel ? ' on' : '') + '" data-action="level" data-level="">' +
          '<span class="lvl-thumb lvl-random">?</span><span class="lvl-name">Zufall</span></button>' +
          this.cfg.levels.map(function (def) {
            var on = !state.randomLevel && def.id === state.levelId;
            return '<button type="button" class="lvl' + (on ? ' on' : '') + '" data-action="level" data-level="' +
              def.id + '" title="' + UDM.escapeHtml(def.desc || '') + '">' +
              '<canvas class="lvl-thumb" width="160" height="92" data-preview="' + def.id + '"></canvas>' +
              '<span class="lvl-name">' + UDM.escapeHtml(def.name) + '</span></button>';
          }).join('') +
          '</div>';
      } else {
        side += '<div class="lobby-label">Spiellänge</div><p class="lobby-value"><b>' + rounds + ' Runden</b></p>' +
          '<p class="muted small lobby-note">Warten, bis der Gastgeber startet …</p>';
        main = '<div class="lobby-label">Welt: <b>' + UDM.escapeHtml(levelName) + '</b></div>' +
          (state.randomLevel
            ? '<span class="lvl-thumb lvl-random lobby-preview">?</span>'
            : '<canvas class="lvl-thumb lobby-preview" width="400" height="230" data-preview="' + state.levelId + '"></canvas>');
      }

      this.showOverlay(
        '<div class="lobby">' +
        '<div class="lobby-head"><h2>Raum <span class="room-code">' + UDM.escapeHtml(state.code) + '</span></h2>' +
        '<span class="muted small">Code weitergeben – bis zu 4 Spieler.</span></div>' +
        '<div class="lobby-grid"><div class="lobby-side">' + side + '</div>' +
        '<div class="lobby-main">' + main + '</div></div>' +
        '</div>',
        'lobby-overlay'
      );

      var self = this;
      this.dom.overlay.querySelectorAll('canvas[data-preview]').forEach(function (canvas) {
        var def = self.levelDef(canvas.getAttribute('data-preview'));
        if (def) { UDM.Render.drawPreview(canvas, def); }
      });
      this.dom.overlay.querySelectorAll('canvas[data-fig]').forEach(function (canvas) {
        self.paintFigure(canvas, canvas.getAttribute('data-fig'), mine || UDM.slotColor(self.mySlot));
      });
    },

    /** Kleine Figurenvorschau in der eigenen Farbe (Tierwahl der Lobby). */
    paintFigure: function (canvas, char, color) {
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var p = {
        x: 0, y: 0, w: UDM.PHYS.playerW, h: UDM.PHYS.playerH, slot: this.mySlot, char: char,
        face: 1, anim: 'idle', animTime: 0, squash: 1, alive: true, finished: false,
        deathTimer: 0, name: '', color: color, dark: UDM.darken(color)
      };
      p.x = canvas.width / 2 - p.w / 2;
      p.y = canvas.height - p.h - 4;
      UDM.Render.drawPlayer(ctx, p, this.time, false);
    },

    levelDef: function (id) {
      for (var i = 0; i < this.cfg.levels.length; i++) {
        if (this.cfg.levels[i].id === id) { return this.cfg.levels[i]; }
      }
      return null;
    },

    levelName: function (id) {
      var def = this.levelDef(id);
      return def ? def.name : id;
    },

    /** Gastgeber aendert Welt oder Rundenzahl (null = unveraendert). */
    sendSettings: function (levelId, rounds) {
      if (!this.server || !this.server.isHost) { return; }
      var self = this;
      var level = levelId !== null ? levelId : (this.server.randomLevel ? '' : this.server.levelId);
      var count = rounds === null || isNaN(rounds) ? this.server.rounds : rounds;
      this.net.call('settings', { level: level, rounds: count }).then(function (data) {
        self.applyServerState(data.state);
      }).catch(function (err) { self.setBanner(err.message, 2); });
    },

    /** Eigene Farbe oder eigenes Tier in der Lobby waehlen. */
    sendChoice: function (action, payload) {
      var self = this;
      this.net.call(action, payload).then(function (data) {
        UDM.Audio.select();
        self.applyServerState(data.state);
      }).catch(function (err) {
        UDM.Audio.deny();
        self.setBanner(err.message, 2);
        if (err.state) { self.applyServerState(err.state); }
      });
    },

    /** Tabellenzeilen einer Rundenauswertung: Gruende, Punkte, Stand. */
    scoreRows: function (entries) {
      return entries.slice().sort(function (a, b) { return b.total - a.total; }).map(function (e) {
        var reasons = e.reasons.length
          ? e.reasons.map(function (r) {
              return '<span class="reason">' + UDM.escapeHtml(r.text) +
                ' <b>' + (r.points > 0 ? '+' : '') + r.points + '</b></span>';
            }).join('')
          : '<span class="reason muted">' + (e.finished ? '' : UDM.escapeHtml(UDM.DEATH_LABELS[e.cause] || 'nichts geholt')) + '</span>';
        return '<tr style="--c:' + UDM.slotColor(e.slot) + '">' +
          '<td><span class="pdot"></span>' + UDM.escapeHtml(e.name) + '</td>' +
          '<td class="reasons">' + reasons + '</td>' +
          '<td class="delta' + (e.delta === 0 ? ' zero' : '') + '">' +
          (e.delta > 0 ? '+' + e.delta : e.delta) + '</td>' +
          '<td class="total">' + e.total + '</td>' +
          '</tr>';
      }).join('');
    },

    /** Hinweise unter der Rundentabelle: nichts geholt, verschwunden, geraeumt. */
    roundNotes: function (data, final) {
      return (data.anyFinisher ? ''
          : '<p class="muted">Niemand hat das Ziel erreicht – diese Runde gibt es gar keine Punkte, auch keine für Fallen.</p>') +
        (data.spent ? '<p class="cleared">' + (data.spent === 1
          ? 'Ein Bauteil hat alle erwischt und verschwindet.'
          : data.spent + ' Bauteile haben alle erwischt und verschwinden.') + '</p>' : '') +
        (data.cleared && !final ? '<p class="cleared">Drei Runden ohne Zieleinlauf – das Level wird komplett geräumt.</p>' : '');
    },

    showScore: function () {
      var data = this.lastRound;
      if (!data) { return; }

      var pending = this.server ? this.server.players.filter(function (p) { return p.connected && !p.ready; }) : [];
      var waiting = '<p class="muted small">' + (pending.length
        ? 'Warten auf: ' + pending.map(function (p) { return UDM.escapeHtml(p.name); }).join(', ')
        : 'Alle bereit …') + '</p>';

      var left = this.totalRounds - data.round;
      this.showOverlay(
        '<h2>Runde ' + data.round + ' von ' + this.totalRounds + '</h2>' +
        this.roundNotes(data) +
        '<table class="scoretable"><tbody>' + this.scoreRows(data.entries) + '</tbody></table>' +
        '<button class="big" data-action="next">' + (left === 1 ? 'Letzte Runde' : 'Weiter') + '</button>' + waiting,
        'score'
      );
    },

    showWinner: function () {
      var w = this.winner || {};
      var winners = w.players || [];
      var tie = winners.length > 1;
      var names = winners.map(function (p) { return UDM.escapeHtml(p.name); });
      var title = tie
        ? '<h2>🤝 Unentschieden!</h2><p class="muted">' + names.slice(0, -1).join(', ') + ' und ' +
          names[names.length - 1] + ' teilen sich den Sieg mit je ' + w.score + ' Punkten.</p>'
        : '<h2 style="color:' + UDM.slotColor(winners.length ? winners[0].slot : 0) + '">🏆 ' +
          (names[0] || '?') + ' gewinnt!</h2><p class="muted">Nach ' + this.totalRounds +
          ' Runden mit ' + w.score + ' Punkt' + (w.score === 1 ? '' : 'en') + '.</p>';
      var data = this.lastRound;

      var again = this.server && this.server.isHost
        ? '<button class="big" data-action="restart">Nochmal spielen</button>' +
          '<p class="muted small">Zurück in die Lobby: Welt und Runden neu wählen, weitere Mitspieler können beitreten.</p>'
        : '<p class="muted">Der Gastgeber wählt gleich die nächste Welt.</p>';

      this.showOverlay(
        title +
        (data ? '<h3>Letzte Runde</h3>' + this.roundNotes(data, true) +
          '<table class="scoretable"><tbody>' + this.scoreRows(data.entries) + '</tbody></table>' : '') +
        again + '<a class="link" href="index.php">Zurück zum Menü</a>',
        'winner'
      );
    },

    showRules: function () {
      var item = function (catalog) {
        return Object.keys(catalog).map(function (id) {
          return '<li><canvas class="cicon" width="40" height="40" data-type="' + id + '"></canvas>' +
            '<div><b>' + UDM.escapeHtml(catalog[id].name) + '</b><br><small>' +
            UDM.escapeHtml(catalog[id].desc) + '</small></div></li>';
        }).join('');
      };
      var list = item(this.cfg.cards);
      var powers = item(this.cfg.powerups || {});

      this.showOverlay(
        '<h2>So läuft es</h2>' +
        '<ol class="rules">' +
        '<li><b>Jedes Level ist ohne ein einziges Bauteil zu schaffen.</b> ' +
        'Alles, was gebaut wird, ist ein Hindernis – keine Hilfe.</li>' +
        '<li><b>Bauphase:</b> Der Reihe nach setzt jeder <b>ein Bauteil</b>. ' +
        'Wer vorne liegt, baut zuerst – wer hinten liegt, hat das letzte Wort. ' +
        'Die anderen sehen, wo gebaut wird, aber nicht deine Karten.</li>' +
        '<li><b>Partyphase:</b> Alle rennen gleichzeitig los und versuchen, die Fahne zu erreichen. ' +
        'Nach 60 Sekunden ist Schluss – sobald jemand im Ziel ist, bleiben noch 10.</li>' +
        '<li><b>Punkte:</b> Ziel erreicht <b>+1</b>, erster im Ziel <b>+1</b> extra, ' +
        'einziger im Ziel <b>+2</b> extra, ein Gegner stirbt an deinem Bauteil <b>+1</b>, ' +
        'du hast ihn mit Öl oder Ventilator hineingeschoben <b>+1</b>, ' +
        'du stirbst an deinem eigenen <b>-1</b>. ' +
        '<b>Kommt niemand ins Ziel, gibt es gar nichts</b> – auch keine Fallenpunkte.</li>' +
        '<li><b>Bauteile bleiben liegen.</b> Selbst löschen geht nicht. Ein Bauteil verschwindet nur, ' +
        'wenn es in einer Runde <b>alle</b> erwischt hat – oder durch die <b>Abrissbirne</b>.</li>' +
        '<li>Das Match dauert <b>' + this.totalRounds + ' Runden</b>. Danach gewinnt, wer die meisten ' +
        'Punkte hat – bei Gleichstand teilen sich die Führenden den Sieg.</li>' +
        '<li>Kommt <b>drei Runden lang niemand</b> ins Ziel, wird das Level komplett geräumt.</li>' +
        '</ol>' +
        '<h3>Bauteile</h3><ul class="cardlist">' + list + '</ul>' +
        '<h3>Power-ups</h3><p class="muted small">Liegen oft als vierte Karte auf der Hand und helfen dir selbst. ' +
        'Anklicken setzt sie ein – sie kosten keinen Zug, müssen aber <b>vor</b> dem eigenen Bauteil kommen, ' +
        'denn das beendet den Zug. Doppelsprung, Schutzschild, Turbo und Gleitschirm wirken in der ' +
        'direkt folgenden Partyphase.</p>' +
        '<ul class="cardlist">' + powers + '</ul>' +
        '<button class="big" data-action="close">Alles klar</button>',
        'rules'
      );
      this.paintOverlayIcons();
    },

    paintOverlayIcons: function () {
      var icons = this.dom.overlay.querySelectorAll('canvas.cicon');
      for (var i = 0; i < icons.length; i++) {
        UDM.Render.drawCardIcon(icons[i], icons[i].getAttribute('data-type'), 1, this.time);
      }
    },

    showError: function (message) {
      this.showOverlay(
        '<h2>Ups</h2><p>' + UDM.escapeHtml(message) + '</p>' +
        '<a class="big" href="index.php">Zurück zum Menü</a>',
        'error'
      );
    },

    onOverlayAction: function (action, target) {
      var self = this;
      if (action === 'close') {
        this.overlayKind = '';
        if (this.phase === 'score') { this.showScore(); }
        else if (this.phase === 'over') { this.showWinner(); }
        else if (this.phase === 'lobby') { this.showLobby(); }
        else { this.hideOverlay(); }
        return;
      }
      if (action === 'start') {
        this.net.call('start').then(function (data) { self.applyServerState(data.state); })
          .catch(function (err) { self.setBanner(err.message, 3); });
        return;
      }
      if (action === 'next') {
        this.net.call('ready').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
        var button = this.dom.overlay.querySelector('.big');
        if (button) { button.setAttribute('disabled', 'disabled'); }
        return;
      }
      if (action === 'restart') {
        this.net.call('ready').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
        return;
      }
      if (action === 'level') {
        this.sendSettings(target.getAttribute('data-level'), null);
      } else if (action === 'rounds') {
        this.sendSettings(null, parseInt(target.getAttribute('data-rounds'), 10));
      } else if (action === 'color') {
        this.sendChoice('color', { color: target.getAttribute('data-color') });
      } else if (action === 'char') {
        this.sendChoice('char', { char: target.getAttribute('data-char') });
      }
    },

    /* -------------------------------------------------------- Spielschleife */

    loop: function (ts) {
      var self = this;
      var dt = Math.min(0.05, (ts - this.lastFrame) / 1000);
      this.lastFrame = ts;
      this.time += dt;

      if (this.bannerTimer > 0) {
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) { this.setBanner(''); }
      }

      // Pfeilfallen & Co. sind nur waehrend des Spiels zu hoeren - in Lobby,
      // Punkteansicht und nach dem Match ist Ruhe.
      UDM.Audio.ambient = this.phase === 'build' || this.phase === 'party';

      if (this.phase !== 'build' && this.roll) { this.stopRoll(); }

      if (this.phase === 'build') {
        this.updateRoll(dt);
        // Nur einmal pro Frame: Klicks und Tastendruecke sind Flanken.
        this.stepBuild();
        // Auch in der Bauphase laufen Saegen, Pendel und Pfeile weiter -
        // sonst stehen Geschosse der Vorrunde eingefroren im Bild.
        this.level.update(dt, this.time);
      } else if (this.phase === 'party') {
        // Physik in festen Schritten, damit sie stabil bleibt.
        var steps = Math.min(4, Math.ceil(dt / (1 / 120)));
        var stepDt = dt / steps;
        for (var i = 0; i < steps; i++) {
          this.stepParty(stepDt, i === 0);
        }
      } else if (this.level) {
        this.level.update(dt, this.time);
      }

      if (this.net && this.phase !== 'error') {
        // Partyphase: Positionen. Bauphase: Mauszeiger des Bauenden.
        var interval = this.phase === 'party' ? 90 : (this.phase === 'build' ? 180 : 750);
        if (ts - this.lastPoll > interval) { this.pollNow(); }
      }

      this.renderFrame();
      UDM.Input.endFrame();
      requestAnimationFrame(function (next) { self.loop(next); });
    },

    /**
     * Was die Bauvorschau zeigen soll. Wer baut, sieht seinen eigenen
     * Zustand; alle anderen sehen live, wo und wie er setzt.
     */
    buildOverlayState: function () {
      var builder = this.activeBuilder();
      if (this.phase !== 'build' || !builder) { return null; }

      if (builder.slot === this.mySlot) {
        return {
          tx: this.build.tx,
          ty: this.build.ty,
          rot: this.build.deleting ? this.build.wreckRot : this.build.rot,
          type: this.build.deleting ? null : this.selectedType(),
          valid: this.build.valid,
          deleting: this.build.deleting,
          color: builder.color
        };
      }

      var view = this.remoteBuildView(builder);
      if (view.tx < 0 || view.ty < 0) { return null; }
      var valid = view.deleting
        ? this.wreckTargets(view.tx, view.ty, view.rot).length > 0
        : !!view.type && this.level.canPlaceAt(view.tx, view.ty, view.type);
      return {
        tx: view.tx,
        ty: view.ty,
        rot: view.rot,
        type: view.deleting ? null : view.type,
        valid: valid,
        deleting: view.deleting,
        color: builder.color,
        label: builder.name
      };
    },

    renderFrame: function () {
      if (!this.level) { return; }
      UDM.Render.draw(this.ctx, {
        level: this.level,
        players: this.phase === 'lobby' ? [] : this.players,
        time: this.time,
        showNames: true,
        build: this.buildOverlayState()
      });

      this.renderCountdown();

      if (this.phase === 'party' && this.party.countdown <= 0) {
        this.dom.timer.classList.remove('hidden');
        var pct = UDM.clamp(this.party.remaining / this.party.limit, 0, 1) * 100;
        this.dom['timer-fill'].style.width = pct + '%';
        this.dom['timer-fill'].classList.toggle('warn', this.party.remaining < 10);
      } else {
        this.dom.timer.classList.add('hidden');
      }
    },

    /** Startcountdown und - gross und rot - die letzten Sekunden der Runde. */
    renderCountdown: function () {
      var cd = this.dom.countdown;
      var text = '';
      var pulse = 0;
      var final = false;

      if (this.phase === 'party') {
        if (this.party.countdown > 0) {
          text = String(Math.ceil(this.party.countdown));
          pulse = this.party.countdown % 1;
        } else if (this.party.time < 0.6) {
          text = 'LOS!';
        } else if (this.party.remaining <= 0) {
          // Bis der Server die Runde auswertet.
          text = 'ZEIT!';
          final = true;
        } else if (this.party.remaining <= FINAL_SECONDS && this.anyoneRunning()) {
          text = String(Math.ceil(this.party.remaining));
          pulse = this.party.remaining % 1;
          final = true;
        }
      }

      if (!text) {
        cd.classList.add('hidden');
        return;
      }
      cd.textContent = text;
      cd.classList.remove('hidden');
      cd.classList.toggle('final', final);
      cd.style.transform = 'translate(-50%, -50%) scale(' + (1 + pulse * 0.35) + ')';
    }
  };

  UDM.Game = Game;

  document.addEventListener('DOMContentLoaded', function () {
    if (global.UDM_CONFIG) { Game.init(global.UDM_CONFIG); }
  });
}(window));
