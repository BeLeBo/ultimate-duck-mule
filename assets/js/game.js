/* Hauptcontroller: Phasen, HUD, Spielschleife - lokal und online. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;

  var PARTY_LIMIT = 60;       // Sekunden pro Partyphase
  var PARTY_AFTER_FIRST = 10; // Restzeit, sobald jemand im Ziel ist
  var COUNTDOWN = 2.2;
  var HAND_SIZE = 4;
  var PLACES_PER_TURN = 1;   // Bauteile pro Zug - loeschen geht nur per Abrissbirne

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
    dom: {},

    build: {
      order: [], idx: 0, card: 0, rot: 0,
      tx: -1, ty: -1, valid: false, busy: false,
      // Zielt gerade mit der Abrissbirne auf ein Bauteil.
      deleting: false
    },
    party: { countdown: 0, time: 0, remaining: PARTY_LIMIT, started: false, firstFinishAt: -1, reported: false },

    net: null,
    server: null,
    serverVersion: -1,
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

      if (cfg.mode === 'online') {
        this.initOnline();
      } else {
        this.initLocal();
      }

      this.lastFrame = performance.now();
      var self = this;
      requestAnimationFrame(function (ts) { self.loop(ts); });
    },

    cacheDom: function () {
      var ids = ['round-label', 'target-label', 'players', 'banner', 'countdown', 'timer',
        'timer-fill', 'overlay', 'turn-info', 'hand', 'hints', 'btn-sound', 'btn-rules',
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

      this.dom.hand.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('[data-card]') : null;
        if (!card) { return; }
        var index = parseInt(card.getAttribute('data-card'), 10);
        if (card.hasAttribute('data-rotate')) {
          self.rotateSelection();
        } else if (card.hasAttribute('data-endturn')) {
          self.endTurn();
        } else {
          self.selectCard(index);
        }
      });

      global.addEventListener('beforeunload', function () {
        if (self.net) { self.net.leave(); }
      });
    },

    /* ------------------------------------------------------ Lokales Spiel */

    initLocal: function () {
      var defs = this.cfg.levels;
      var def = null;
      for (var i = 0; i < defs.length; i++) {
        if (defs[i].id === this.cfg.levelId) { def = defs[i]; }
      }
      if (!def) { def = defs[Math.floor(Math.random() * defs.length)]; }

      this.level = new UDM.Level(def);
      this.players = [];
      var setup = this.cfg.local.players;
      for (var p = 0; p < setup.length; p++) {
        var player = new UDM.Player(p, setup[p]);
        player.layout = UDM.LAYOUTS[p];
        this.players.push(player);
      }
      this.dom['level-label'].textContent = def.name;
      this.round = 0;
      this.startRound();
    },

    /** Zieht eine Hand nach den Gewichten aus lib/Cards.php. */
    /**
     * Zieht eine Hand wie Cards::deal() in PHP: mindestens drei Bauteile,
     * die vierte Karte ist mit etwas Glueck ein Power-up.
     */
    dealHand: function () {
      if (Math.random() * 100 < (this.cfg.powerupChance || 0)) {
        var hand = this.dealBlocks(HAND_SIZE - 1);
        hand.push(this.weightedPick(this.cfg.powerups || {}));
        return hand;
      }
      return this.dealBlocks(HAND_SIZE);
    },

    dealBlocks: function (size) {
      var hand = [];
      var guard = 0;
      while (hand.length < size && guard < 400) {
        guard++;
        var pick = this.weightedPick(this.cfg.cards);
        if (hand.indexOf(pick) === -1) { hand.push(pick); }
      }
      return hand;
    },

    weightedPick: function (catalog) {
      var ids = Object.keys(catalog);
      var total = ids.reduce(function (sum, id) { return sum + (catalog[id].weight || 1); }, 0);
      var roll = Math.random() * total;
      for (var i = 0; i < ids.length; i++) {
        roll -= catalog[ids[i]].weight || 1;
        if (roll <= 0) { return ids[i]; }
      }
      return ids[0];
    },

    isPowerUp: function (id) {
      return !!(this.cfg.powerups && this.cfg.powerups[id]);
    },

    cardMeta: function (id) {
      return (this.cfg.cards && this.cfg.cards[id]) ||
        (this.cfg.powerups && this.cfg.powerups[id]) || { name: id, desc: '' };
    },

    startRound: function () {
      this.round++;
      this.phase = 'build';
      this.winner = null;
      this.hideOverlay();

      // Wer vorne liegt, baut zuerst - wer hinten liegt, hat das letzte
      // Wort. Gleichstand entscheidet das Los. Wie Game::buildOrder() in PHP.
      this.build.order = this.players
        .map(function (p) { return { slot: p.slot, score: p.score, lot: Math.random() }; })
        .sort(function (a, b) { return (b.score - a.score) || (a.lot - b.lot); })
        .map(function (entry) { return entry.slot; });
      this.build.idx = 0;
      this.build.card = 0;
      this.build.rot = 0;

      for (var p = 0; p < this.players.length; p++) {
        this.players[p].hand = this.dealHand();
        this.players[p].placesLeft = PLACES_PER_TURN;
        // Power-ups gelten nur fuer die Partyphase direkt nach dem Einsetzen.
        this.players[p].buffs = [];
      }
      this.build.deleting = false;
      // Abgelaufene Grabsteine raus, der Rest gilt fuer diese Runde.
      var round = this.round;
      this.graves = (this.graves || []).filter(function (g) { return g.until >= round; });
      this.level.graves = this.graves;
      // Bruchbloecke heilen, Geschosse und Partikel der Vorrunde raus.
      this.level.resetRound();
      this.parkPlayers();

      this.setBanner((this.round >= this.totalRounds ? 'Letzte Runde' : 'Runde ' + this.round) + ' – Bauphase');
      this.updateHud();
    },

    /** Stellt alle Figuren waehrend der Bauphase auf den Startplatz. */
    parkPlayers: function () {
      for (var i = 0; i < this.players.length; i++) {
        var spawn = this.level.spawnPoint(i);
        this.players[i].reset(spawn.x, spawn.y);
      }
    },

    activeBuilder: function () {
      if (this.cfg.mode === 'online') {
        return this.server && this.server.turnSlot !== null ? this.playerBySlot(this.server.turnSlot) : null;
      }
      var slot = this.build.order[this.build.idx];
      return this.players[slot] || null;
    },

    playerBySlot: function (slot) {
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].slot === slot) { return this.players[i]; }
      }
      return null;
    },

    /* ----------------------------------------------------------- Bauphase */

    stepBuild: function (dt) {
      var builder = this.activeBuilder();
      var canBuild = !!builder && (this.cfg.mode !== 'online' || builder.slot === this.mySlot);
      var mouse = UDM.Input.mouse;

      if (canBuild) {
        var layout = this.cfg.mode === 'online' ? UDM.SOLO_LAYOUT : builder.layout;

        // Karten waehlen und drehen.
        for (var k = 0; k < HAND_SIZE; k++) {
          if (UDM.Input.wasPressed('Digit' + (k + 1))) { this.selectCard(k); }
        }
        if (UDM.Input.wasPressed('KeyR')) { this.rotateSelection(); }

        // Cursor per Maus oder per eigenen Tasten.
        if (mouse.inside) {
          this.build.tx = mouse.tx;
          this.build.ty = mouse.ty;
        }
        if (UDM.Input.wasPressed(layout.left)) { this.build.tx = Math.max(0, this.build.tx - 1); }
        if (UDM.Input.wasPressed(layout.right)) { this.build.tx = Math.min(this.level.cols - 1, this.build.tx + 1); }
        if (UDM.Input.wasPressed(layout.jump)) { this.build.ty = Math.max(0, this.build.ty - 1); }
        if (UDM.Input.wasPressed(layout.down)) { this.build.ty = Math.min(this.level.rows - 1, this.build.ty + 1); }
        if (this.build.tx < 0) { this.build.tx = Math.floor(this.level.cols / 2); }
        if (this.build.ty < 0) { this.build.ty = Math.floor(this.level.rows / 2); }

        if (this.build.deleting && builder.hand.indexOf('pu_remove') < 0) { this.build.deleting = false; }

        if (this.build.deleting) {
          var onBlock = this.level.cell(this.build.tx, this.build.ty);
          this.build.valid = !!(onBlock && onBlock.kind === 'block');
        } else {
          this.build.valid = this.level.canPlaceAt(this.build.tx, this.build.ty, this.selectedType());
        }

        var confirm = mouse.clicked || UDM.Input.wasPressed('Enter') || UDM.Input.wasPressed('Space');
        if (confirm) {
          if (this.build.deleting) { this.tryRemove(builder); }
          else { this.tryPlace(builder); }
        }
        if ((UDM.Input.wasPressed('Escape') || mouse.right) && this.build.deleting) {
          this.build.deleting = false;
          this.setBanner('', 0);
          this.renderHand();
        }
      } else {
        this.build.valid = false;
      }
    },

    /** Wie viele Bauteile darf der Spieler noch setzen? */
    placesLeft: function (player) {
      if (!player) { return 0; }
      if (this.cfg.mode === 'online') {
        var info = this.serverPlayer(player.slot);
        return info ? info.places : 0;
      }
      return player.placesLeft === undefined ? PLACES_PER_TURN : player.placesLeft;
    },

    serverPlayer: function (slot) {
      if (!this.server) { return null; }
      for (var i = 0; i < this.server.players.length; i++) {
        if (this.server.players[i].slot === slot) { return this.server.players[i]; }
      }
      return null;
    },

    selectCard: function (index) {
      var builder = this.activeBuilder();
      if (!builder || !builder.hand || index < 0 || index >= builder.hand.length) { return; }
      if (this.cfg.mode === 'online' && builder.slot !== this.mySlot) { return; }
      var card = builder.hand[index];
      if (this.isPowerUp(card)) {
        if (card === 'pu_remove') {
          // Abrissbirne: erst zielen, dann aufs Bauteil klicken.
          this.build.deleting = !this.build.deleting;
          UDM.Audio.select();
          this.setBanner(this.build.deleting ? 'Klick auf das Bauteil, das weg soll' : '', 2.2);
          this.renderHand();
        } else {
          this.usePower(builder, index, -1, -1);
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

    /**
     * Power-up einsetzen. Lokal direkt, online ueber den Server
     * (Game::usePower() in PHP rechnet dort dasselbe). Nur die Abrissbirne
     * braucht ein Ziel; alle anderen wirken in der folgenden Partyphase.
     */
    usePower: function (builder, index, tx, ty) {
      var card = builder.hand[index];
      var meta = this.cardMeta(card);
      var self = this;

      if (this.cfg.mode === 'online') {
        this.build.busy = true;
        this.net.call('power', { card: index, x: tx, y: ty }).then(function (data) {
          self.build.busy = false;
          self.build.deleting = false;
          self.build.card = 0;
          if (card === 'pu_remove') {
            self.level.burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, '#ffffff', 14);
            UDM.Render.kick(4);
            UDM.Audio.die();
          } else {
            UDM.Audio.goal();
          }
          self.setBanner(card === 'pu_remove' ? 'Weg damit!' : meta.name + ' für diese Runde!', 1.6);
          self.applyServerState(data.state);
        }).catch(function (err) {
          self.build.busy = false;
          UDM.Audio.deny();
          self.setBanner(err.message || 'Das hat nicht geklappt.', 1.8);
          if (err.state) { self.applyServerState(err.state); }
        });
        return;
      }

      if (card === 'pu_remove') {
        var cell = this.level.cell(tx, ty);
        if (!cell || cell.kind !== 'block') {
          UDM.Audio.deny();
          this.setBanner('Da liegt kein Bauteil', 1.2);
          return;
        }
        this.addGrave(cell);
        this.level.burst((cell.tx + (cell.w || 1) / 2) * TILE, (cell.ty + (cell.h || 1) / 2) * TILE, '#ffffff', 14);
        this.level.removeBlock(cell);
        UDM.Render.kick(4);
        UDM.Audio.die();
        this.setBanner('Weg damit!', 1.4);
      } else {
        builder.buffs = builder.buffs || [];
        if (builder.buffs.indexOf(card) < 0) { builder.buffs.push(card); }
        UDM.Audio.goal();
        this.setBanner(meta.name + ' für diese Runde!', 1.6);
      }

      builder.hand.splice(index, 1);
      this.build.card = 0;
      this.build.deleting = false;
      this.updateHud();
    },

    /** Zug vorzeitig beenden - lokal wie online. */
    endTurn: function () {
      var builder = this.activeBuilder();
      if (!builder || this.phase !== 'build') { return; }
      if (this.cfg.mode === 'online') {
        if (builder.slot !== this.mySlot) { return; }
        var self = this;
        this.net.call('skip').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
        return;
      }
      builder.hand = [];
      builder.placesLeft = 0;
      this.advanceBuild();
    },

    tryPlace: function (builder) {
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

      if (this.cfg.mode === 'online') {
        this.placeOnline(type);
        return;
      }

      this.level.addBlock({
        id: this.level.nextId(),
        type: type,
        x: this.build.tx,
        y: this.build.ty,
        rot: this.build.rot,
        ownerSlot: builder.slot
      });
      builder.hand.splice(this.selectedIndex(), 1);
      builder.placesLeft = this.placesLeft(builder) - 1;
      this.build.card = 0;
      this.build.rot = 0;
      UDM.Audio.place();
      UDM.Render.kick(2);

      // Das letzte Bauteil beendet den Zug - wie Game::place() in PHP.
      var self = this;
      var blocksLeft = builder.hand.some(function (c) { return !self.isPowerUp(c); });
      if (builder.placesLeft <= 0 || !blocksLeft) {
        this.advanceBuild();
      } else {
        this.setBanner('Noch ein Bauteil', 1.1);
        this.updateHud();
      }
    },

    /**
     * Lokaler Grabstein: derselbe Typ darf bis Ende der naechsten Runde nicht
     * wieder dorthin. Wie Game::addGrave() in PHP.
     */
    addGrave: function (cell) {
      if (!cell || cell.kind !== 'block') { return; }
      this.graves = this.graves || [];
      this.graves.push({ type: cell.type, x: cell.tx, y: cell.ty, until: this.round + 1 });
      this.level.graves = this.graves;
    },

    /** Abrissbirne auf das Bauteil unter dem Cursor. */
    tryRemove: function (builder) {
      if (this.build.busy) { return; }
      var index = builder.hand.indexOf('pu_remove');
      if (index < 0) {
        this.build.deleting = false;
        return;
      }
      var cell = this.level.cell(this.build.tx, this.build.ty);
      if (!cell || cell.kind !== 'block') {
        UDM.Audio.deny();
        this.setBanner('Da liegt kein Bauteil', 1.2);
        return;
      }
      this.usePower(builder, index, this.build.tx, this.build.ty);
    },

    advanceBuild: function () {
      this.build.idx++;
      this.build.card = 0;
      this.build.rot = 0;
      this.build.deleting = false;
      if (this.build.idx >= this.build.order.length) {
        this.beginParty();
      } else {
        var next = this.activeBuilder();
        this.setBanner(next.name + ' baut');
        this.updateHud();
      }
    },

    /* --------------------------------------------------------- Partyphase */

    beginParty: function () {
      this.phase = 'party';
      this.party.countdown = COUNTDOWN;
      this.party.time = 0;
      this.party.remaining = PARTY_LIMIT;
      this.party.started = false;
      this.party.firstFinishAt = -1;
      this.party.reported = false;

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

    stepParty: function (dt, firstStep) {
      var i;
      var p;

      if (this.party.countdown > 0) {
        var before = Math.ceil(this.party.countdown);
        this.party.countdown -= dt;
        var after = Math.ceil(this.party.countdown);
        if (after !== before && after > 0) { UDM.Audio.tick(); }
        if (this.party.countdown <= 0) {
          this.party.started = true;
          UDM.Audio.start();
          this.updateHud();
          this.refreshGiveUp();
        }
        this.level.update(dt, 0);
        return;
      }

      this.party.time += dt;
      this.party.remaining -= dt;
      this.level.update(dt, this.party.time);

      for (i = 0; i < this.players.length; i++) {
        p = this.players[i];
        if (p.remote) {
          p.updateRemote(dt);
          continue;
        }
        var input = p.isDone() ? UDM.Input.idle() : UDM.Input.stateFor(
          this.cfg.mode === 'online' ? UDM.SOLO_LAYOUT : p.layout
        );
        if (!firstStep) { input.jumpPressed = false; }
        p.update(dt, input, this.level);
        var event = p.checkFate(this.level);
        if (event) {
          UDM.Render.kick(event.type === 'death' ? 7 : event.type === 'shield' ? 3 : 4);
          if (event.type === 'finish' && this.party.firstFinishAt < 0) {
            this.party.firstFinishAt = this.party.time;
            this.party.remaining = Math.min(this.party.remaining, PARTY_AFTER_FIRST);
          }
          this.updateHud();
        }
      }

      if (this.party.remaining <= 0) {
        for (i = 0; i < this.players.length; i++) {
          p = this.players[i];
          if (!p.remote && !p.isDone()) { p.kill('zeit', null, this.level); }
        }
      }

      if (this.cfg.mode === 'online') {
        this.reportOwnResult();
        return;
      }

      var allDone = true;
      for (i = 0; i < this.players.length; i++) {
        if (!this.players[i].isDone()) { allDone = false; break; }
      }
      if (allDone) {
        this.party.endDelay = (this.party.endDelay || 0) + dt;
        if (this.party.endDelay > 1.1) {
          this.party.endDelay = 0;
          this.finishRoundLocal();
        }
      }
    },

    /* ---------------------------------------------------------- Auswertung */

    /** Punktetabelle - identisch zu Game::finishRound() in PHP. */
    scoreRound: function (players) {
      var finishers = players.filter(function (p) { return p.finished; });
      var entries = [];

      // Wer war zuerst da?
      var first = null;
      finishers.forEach(function (p) {
        if (!first || p.time < first.time) { first = p; }
      });

      players.forEach(function (p) {
        var delta = 0;
        var reasons = [];

        if (p.finished) {
          delta += 1;
          reasons.push({ text: 'Ziel erreicht', points: 1 });
          if (p === first && players.length > 1) {
            delta += 1;
            reasons.push({ text: 'Erster im Ziel', points: 1 });
          }
          if (finishers.length === 1 && players.length > 1) {
            delta += 2;
            reasons.push({ text: 'Einziger im Ziel', points: 2 });
          }
        }

        // Fallen- und Helferpunkte nur, wenn überhaupt jemand ankam.
        if (finishers.length > 0) {
          var victims = players.filter(function (o) {
            return o !== p && o.killerSlot === p.slot;
          }).length;
          if (victims > 0) {
            delta += victims;
            reasons.push({ text: victims > 1 ? 'Fallensteller (x' + victims + ')' : 'Fallensteller', points: victims });
          }

          var assists = players.filter(function (o) {
            return o !== p && o.assistSlot === p.slot && o.killerSlot !== p.slot;
          }).length;
          if (assists > 0) {
            delta += assists;
            reasons.push({ text: assists > 1 ? 'Nachgeholfen (x' + assists + ')' : 'Nachgeholfen', points: assists });
          }

          if (p.killerSlot === p.slot) {
            delta -= 1;
            reasons.push({ text: 'Eigentor', points: -1 });
          }
        }

        var before = p.score;
        p.score = Math.max(0, before + delta);
        entries.push({
          slot: p.slot,
          name: p.name,
          char: p.char,
          delta: p.score - before,
          total: p.score,
          finished: p.finished,
          time: p.finished ? p.time : null,
          cause: p.cause,
          reasons: reasons
        });
      });

      return {
        round: this.round,
        entries: entries,
        anyFinisher: finishers.length > 0,
        firstSlot: first ? first.slot : null
      };
    },

    finishRoundLocal: function () {
      this.lastRound = this.scoreRound(this.players);

      // Ein Bauteil verschwindet nur, wenn es alle erwischt hat -
      // wie Game::spentBlocks() in PHP.
      var spent = this.spentBlocks(this.players);
      var self = this;
      this.level.blocks.forEach(function (cell) {
        if (spent.indexOf(cell.id) >= 0) { self.addGrave(cell); }
      });
      this.lastRound.spent = spent.length ? this.level.removeBlocksById(spent) : 0;

      // Drei Runden ohne Zieleinlauf: das Level ist zugebaut, alles raeumen.
      if (this.lastRound.anyFinisher) {
        this.deadRounds = 0;
      } else {
        this.deadRounds = (this.deadRounds || 0) + 1;
        if (this.deadRounds >= 3) {
          this.deadRounds = 0;
          this.graves = [];
          this.level.graves = [];
          this.level.rebuild([]);
          this.lastRound.cleared = true;
        }
      }

      // Nach der letzten Runde gewinnt, wer vorne liegt - Gleichstand teilt.
      if (this.round >= this.totalRounds) {
        var best = Math.max.apply(null, this.players.map(function (p) { return p.score; }));
        this.winner = {
          score: best,
          players: this.players.filter(function (p) { return p.score === best; }).map(function (p) {
            return { slot: p.slot, name: p.name, char: p.char };
          })
        };
        this.phase = 'over';
        UDM.Audio.win();
        this.showWinner();
      } else {
        this.phase = 'score';
        this.showScore();
      }
      this.updateHud();
    },

    /**
     * Kennungen der Bauteile, die in dieser Runde jeden erwischt haben.
     * Alle anderen bleiben liegen.
     */
    spentBlocks: function (players) {
      var kills = {};
      players.forEach(function (p) {
        if (p.killerBlock) { kills[p.killerBlock] = (kills[p.killerBlock] || 0) + 1; }
      });
      return Object.keys(kills).filter(function (id) {
        return players.length > 0 && kills[id] >= players.length;
      }).map(function (id) { return parseInt(id, 10); });
    },

    /* ------------------------------------------------------------- Online */

    initOnline: function () {
      var self = this;
      this.net = new UDM.Net(this.cfg.online.code, this.cfg.online.token, this.cfg.endpoint);
      this.net.onFatal = function (err) {
        self.showError(err.message || 'Verbindung zum Raum verloren.');
        self.phase = 'error';
      };
      this.net.onError = function (err) {
        if (self.net.failures > 6) {
          self.setBanner('Verbindungsprobleme …', 2);
        }
      };

      this.dom['target-label'].textContent = 'Raum ' + this.cfg.online.code;
      this.phase = 'lobby';
      this.level = new UDM.Level(this.cfg.levels[0]);
      this.pollNow();
    },

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

      var build = null;
      var builder = this.activeBuilder();
      if (this.phase === 'build' && builder && builder.slot === this.mySlot) {
        build = {
          card: this.selectedIndex(),
          rot: this.build.rot,
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

      this.syncLevel(state);
      this.syncPlayers(state);

      var phaseChanged = !previous || previous.phase !== state.phase ||
        (previous.round !== state.round && state.phase === 'build');

      if (state.phase === 'party') {
        if (this.phase !== 'party' || phaseChanged) { this.beginParty(); }
      } else if (state.phase === 'build') {
        if (this.phase !== 'build' || phaseChanged) {
          this.phase = 'build';
          this.build.card = 0;
          this.build.rot = 0;
          this.level.resetRound();
          this.parkPlayers();
          this.hideOverlay();
        }
        // Nur beim Wechsel des Bauenden - sonst ueberschreibt jeder Abgleich
        // Hinweise wie "Klick auf das Bauteil, das weg soll".
        var builder = this.activeBuilder();
        if (builder && (phaseChanged || previous.turnSlot !== state.turnSlot)) {
          this.setBanner(builder.slot === this.mySlot ? 'Du baust!' : (builder.name + ' baut …'));
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

    syncLevel: function (state) {
      if (this.level) { this.level.graves = state.graves || []; }
      var signature = state.levelId + '|' + state.blocks.length +
        (state.blocks.length ? '|' + state.blocks[state.blocks.length - 1].id : '');
      if (signature === this.blockSignature) { return; }
      this.blockSignature = signature;

      if (!this.level || this.level.def.id !== state.levelId) {
        var def = null;
        for (var i = 0; i < this.cfg.levels.length; i++) {
          if (this.cfg.levels[i].id === state.levelId) { def = this.cfg.levels[i]; }
        }
        this.level = new UDM.Level(def || this.cfg.levels[0]);
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
          player.layout = UDM.SOLO_LAYOUT;
          this.players.push(player);
          this.players.sort(function (a, b) { return a.slot - b.slot; });
        }
        player.name = info.name;
        player.char = info.char;
        player.score = info.score;
        player.connected = info.connected;
        player.placedThisRound = info.placed;
        player.buffs = info.buffs || [];
        player.remote = info.slot !== this.mySlot;
        if (info.you || (info.hand && info.hand.length)) { player.hand = info.hand || []; }
        if (player.remote && state.phase === 'party' && info.pos) {
          if (player.x === 0 && player.y === 0) {
            player.x = info.pos.x;
            player.y = info.pos.y;
          }
          player.setRemoteTarget(info.pos);
        }
      }
    },

    placeOnline: function (type) {
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

    /**
     * Aufgeben: online nur die eigene Figur, lokal alle noch lebenden -
     * dann ist die Runde sofort vorbei.
     */
    giveUp: function () {
      if (this.phase !== 'party') { return; }
      var gaveUp = 0;

      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        if (p.remote || p.isDone()) { continue; }
        if (this.cfg.mode === 'online' && p.slot !== this.mySlot) { continue; }
        p.kill('aufgabe', null, this.level);
        gaveUp++;
      }

      if (gaveUp > 0) {
        UDM.Render.kick(4);
        this.setBanner(gaveUp > 1 ? 'Runde abgebrochen' : 'Aufgegeben', 1.6);
        this.updateHud();
      }
    },

    /** Knopf nur zeigen, wenn es etwas aufzugeben gibt. */
    refreshGiveUp: function () {
      var show = false;
      if (this.phase === 'party' && this.party.countdown <= 0) {
        for (var i = 0; i < this.players.length; i++) {
          var p = this.players[i];
          if (p.remote || p.isDone()) { continue; }
          if (this.cfg.mode === 'online' && p.slot !== this.mySlot) { continue; }
          show = true;
          break;
        }
      }
      this.dom['btn-giveup'].classList.toggle('hidden', !show);
      this.dom['btn-giveup'].textContent =
        this.cfg.mode === 'online' ? 'Aufgeben' : 'Runde abbrechen';
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
      if (this.cfg.mode !== 'online') {
        this.dom['target-label'].textContent = this.round >= this.totalRounds ? 'Letzte Runde!' : '';
      }
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
        if (p.slot === this.mySlot && this.cfg.mode === 'online') { classes.push('me'); }
        if (p.connected === false) { classes.push('offline'); }
        if (this.phase === 'party' && !p.alive) { classes.push('dead'); }
        if (this.phase === 'party' && p.finished) { classes.push('finished'); }

        var status = '';
        if (this.phase === 'party') {
          status = p.finished ? 'im Ziel' : (p.alive ? '…' : (UDM.DEATH_LABELS[p.cause] || 'tot'));
        } else if (this.phase === 'build') {
          var position = this.buildOrderSlots().indexOf(p.slot) + 1;
          var built = p.placedThisRound || (this.cfg.mode !== 'online' && this.hasBuilt(p));
          if (built) { status = 'fertig'; }
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
      if (this.cfg.mode === 'online') {
        return (this.server && this.server.buildOrder) || [];
      }
      return this.build.order || [];
    },

    hasBuilt: function (player) {
      var position = this.build.order.indexOf(player.slot);
      return position >= 0 && position < this.build.idx;
    },

    /**
     * Auswahl des Bauenden: bei mir aus dem eigenen Zustand, bei anderen
     * aus dem, was der Server von ihm weitergibt.
     */
    buildView: function (builder, mine) {
      if (mine) {
        return {
          card: this.selectedIndex(),
          rot: this.build.rot,
          deleting: this.build.deleting,
          tx: this.build.tx,
          ty: this.build.ty
        };
      }
      var remote = this.server && this.server.buildView;
      if (remote && remote.slot === builder.slot) { return remote; }
      return { card: -1, rot: 0, deleting: false, tx: -1, ty: -1 };
    },

    renderHand: function () {
      var builder = this.activeBuilder();
      var mine = !!builder && (this.cfg.mode !== 'online' || builder.slot === this.mySlot);

      if (this.phase !== 'build' || !builder) {
        this.dom.hand.innerHTML = '';
        this.dom['turn-info'].textContent = this.phaseLabel();
        return;
      }

      var places = this.placesLeft(builder);
      var quota = '<span class="quota"><b>' + places + '</b> Bauteil' + (places === 1 ? '' : 'e') + ' übrig' +
        ((builder.buffs || []).length ? ' · ' + this.buffBadges(builder) : '') + '</span>';
      var name = '<strong style="color:' + builder.color + '">' + UDM.escapeHtml(builder.name) + '</strong>';
      this.dom['turn-info'].innerHTML = (mine ? name + ' ist am Zug' : name + ' baut gerade …') + '<br>' + quota;

      var view = this.buildView(builder, mine);
      var hand = builder.hand || [];
      if (!hand.length) {
        this.dom.hand.innerHTML = mine ? '' : '<span class="muted small">Karten werden gezogen …</span>';
        return;
      }

      var html = '';
      var tag = mine ? 'button' : 'div';
      for (var i = 0; i < hand.length; i++) {
        var id = hand[i];
        var meta = this.cardMeta(id);
        var power = this.isPowerUp(id);
        var selected = power ? (id === 'pu_remove' && view.deleting) : (i === view.card && !view.deleting);
        html += '<' + tag + ' class="card' + (power ? ' power' : '') + (selected ? ' selected' : '') +
          (mine ? '' : ' spectate') + '"' + (mine ? ' data-card="' + i + '"' : '') +
          ' title="' + UDM.escapeHtml(meta.desc) + '">' +
          '<span class="ckey">' + (power ? '★' : '') + (mine ? (i + 1) : '') + '</span>' +
          '<canvas class="cicon" width="40" height="40" data-type="' + id + '"></canvas>' +
          '<span class="cname">' + UDM.escapeHtml(meta.name) + '</span>' +
          '</' + tag + '>';
      }

      var type = this.typeAt(hand, view.card);
      var rotatable = type && UDM.BLOCKS[type] && UDM.BLOCKS[type].rotatable;
      var dirLabel = ['nach oben', 'nach rechts', 'nach unten', 'nach links'][view.rot || 0];

      if (mine) {
        html += '<button class="card rotate' + (rotatable ? '' : ' disabled') +
          '" data-card="-1" data-rotate="1" title="Bauteil drehen (Taste R)">' +
          '<span class="ckey">R</span><span class="rot-icon" style="transform:rotate(' +
          ((view.rot || 0) * 90 - 90) + 'deg)">➤</span>' +
          '<span class="cname">' + (rotatable ? dirLabel : 'Drehen') + '</span></button>';

        html += '<button class="card endturn" data-card="-3" data-endturn="1"' +
          ' title="Zug beenden, ohne weitere Bauteile zu setzen">' +
          '<span class="rot-icon">⏭</span><span class="cname">Zug beenden</span></button>';
      } else {
        // Zuschauer sehen, was der Bauende gerade vorhat.
        var doing = view.deleting ? 'zielt mit der Abrissbirne'
          : type ? 'hält ' + UDM.escapeHtml(this.cardMeta(type).name) + (rotatable ? ', ' + dirLabel : '')
          : 'überlegt …';
        html += '<div class="spectate-note">' + doing + '</div>';
      }

      this.dom.hand.innerHTML = html;
      this.paintCardIcons(view.rot || 0);
    },

    typeAt: function (hand, index) {
      var card = hand[index];
      return card && !this.isPowerUp(card) ? card : null;
    },

    /** Malt die Mini-Vorschau in die Kartenbuttons. */
    paintCardIcons: function (rot) {
      var icons = this.dom.hand.querySelectorAll('canvas.cicon');
      for (var i = 0; i < icons.length; i++) {
        UDM.Render.drawCardIcon(icons[i], icons[i].getAttribute('data-type'),
          rot === undefined ? this.build.rot : rot, this.time);
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
      var builder = this.activeBuilder();
      if (this.phase === 'build' && this.cfg.mode === 'online' && builder && builder.slot !== this.mySlot) {
        var me = this.playerBySlot(this.mySlot);
        var pos = this.buildOrderSlots().indexOf(this.mySlot) + 1;
        html = me && me.placedThisRound
          ? '<span>Du hast schon gebaut – jetzt heißt es zuschauen.</span>'
          : '<span>Du baust als <b>' + pos + '.</b> – bis dahin zuschauen.</span>';
      } else if (this.phase === 'build') {
        html = '<span><b>Maus</b> platzieren</span><span><b>1-4</b> Karte</span>' +
          '<span><b>R</b> drehen</span>' +
          '<span>★ Power-ups vor dem eigenen Bauteil einsetzen</span>';
      } else if (this.cfg.mode === 'online') {
        html = '<span><b>' + UDM.SOLO_LAYOUT.label + '</b></span><span>Wandsprung: an der Wand springen</span>';
      } else {
        for (var i = 0; i < this.players.length; i++) {
          html += '<span style="color:' + this.players[i].color + '"><b>' +
            UDM.escapeHtml(this.players[i].name) + ':</b> ' + this.players[i].layout.label + '</span>';
        }
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
     * Lobby: Mitspieler, Welt und Rundenzahl - kompakt in zwei Spalten,
     * damit auch auf kleinen Bildschirmen alles ohne Scrollen passt. Der
     * Gastgeber waehlt, alle anderen sehen live, was gewaehlt ist.
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
        state.players.map(function (p) { return [p.slot, p.name, p.char, p.host, p.connected]; }),
        state.levelId, state.randomLevel, state.rounds, state.isHost
      ]);
      if (signature === this.lobbySignature && this.dom.overlay.querySelector('.lobby')) { return; }
      this.lobbySignature = signature;

      var rows = state.players.map(function (p) {
        return '<li style="--c:' + UDM.slotColor(p.slot) + '"' + (p.connected ? '' : ' class="offline"') + '>' +
          '<span class="pdot"></span><span class="lname">' + UDM.escapeHtml(p.name) + '</span>' +
          (p.host ? ' <em>Gastgeber</em>' : '') +
          (p.you ? ' <em>du</em>' : '') +
          '<small>' + (UDM.CHARACTERS[p.char] ? UDM.CHARACTERS[p.char].label : p.char) + '</small></li>';
      }).join('');

      var levelName = state.randomLevel ? 'Zufall' : this.levelName(state.levelId);
      var canStart = state.isHost && state.players.length >= 2;
      var rounds = state.rounds || 8;
      var side = '<div class="lobby-label">Spieler (' + state.players.length + '/4)</div>' +
        '<ul class="lobby-list">' + rows + '</ul>';
      var main;

      if (state.isHost) {
        side += '<div class="lobby-label">Spiellänge</div><div class="chips">' +
          [3, 5, 8, 10, 12, 15, 20].map(function (n) {
            return '<button type="button" class="chip' + (n === rounds ? ' on' : '') +
              '" data-action="rounds" data-rounds="' + n + '">' + n + '</button>';
          }).join('') + '</div>' +
          '<p class="muted small lobby-note">' + rounds + ' Runden, dann gewinnt, wer vorne liegt.</p>' +
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

      var waiting = '';
      if (this.cfg.mode === 'online' && this.server) {
        var pending = this.server.players.filter(function (p) { return p.connected && !p.ready; });
        waiting = '<p class="muted small">' + (pending.length
          ? 'Warten auf: ' + pending.map(function (p) { return UDM.escapeHtml(p.name); }).join(', ')
          : 'Alle bereit …') + '</p>';
      }

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

      var again = (this.cfg.mode !== 'online' || (this.server && this.server.isHost))
        ? '<button class="big" data-action="restart">Nochmal spielen</button>' +
          '<p class="muted small">' + (this.cfg.mode === 'online'
            ? 'Zurück in die Lobby: Welt und Runden neu wählen, weitere Mitspieler können beitreten.'
            : 'Zurück zu den Einstellungen – Welt, Spieler und Runden lassen sich dort ändern.') + '</p>'
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
        'Alles, was gebaut wird, ist ein Hindernis \u2013 keine Hilfe.</li>' +
        '<li><b>Bauphase:</b> Der Reihe nach setzt jeder <b>ein Bauteil</b>. ' +
        'Wer vorne liegt, baut zuerst – wer hinten liegt, hat das letzte Wort.</li>' +
        '<li><b>Partyphase:</b> Alle rennen gleichzeitig los und versuchen, die Fahne zu erreichen.</li>' +
        '<li><b>Punkte:</b> Ziel erreicht <b>+1</b>, erster im Ziel <b>+1</b> extra, ' +
        'einziger im Ziel <b>+2</b> extra, ein Gegner stirbt an deinem Bauteil <b>+1</b>, ' +
        'du hast ihn mit Öl oder Ventilator hineingeschoben <b>+1</b>, ' +
        'du stirbst an deinem eigenen <b>-1</b>. ' +
        '<b>Kommt niemand ins Ziel, gibt es gar nichts</b> – auch keine Fallenpunkte.</li>' +
        '<li><b>Bauteile bleiben liegen.</b> Selbst löschen geht nicht. Ein Bauteil verschwindet nur, ' +
        'wenn es in einer Runde <b>alle</b> erwischt hat – oder durch die <b>Abrissbirne</b>.</li>' +
        '<li>Das Match dauert <b>' + this.totalRounds + ' Runden</b>. Danach gewinnt, wer die meisten ' +
        'Punkte hat – bei Gleichstand teilen sich die Führenden den Sieg.</li>' +
        '<li>Kommt <b>drei Runden lang niemand</b> ins Ziel, wird das Level komplett ger\u00e4umt.</li>' +
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

    /** Menue mit allen aktuellen Einstellungen vorausgefuellt. */
    settingsUrl: function () {
      var params = [
        'tab=local',
        'players=' + this.players.length,
        'level=' + encodeURIComponent(this.cfg.levelId || ''),
        'rounds=' + this.totalRounds
      ];
      this.players.forEach(function (p, i) {
        params.push('n' + i + '=' + encodeURIComponent(p.name));
        params.push('c' + i + '=' + encodeURIComponent(p.char));
      });
      return 'index.php?' + params.join('&');
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
      if (action === 'start' && this.net) {
        this.net.call('start').then(function (data) { self.applyServerState(data.state); })
          .catch(function (err) { self.setBanner(err.message, 3); });
        return;
      }
      if (action === 'next') {
        if (this.cfg.mode === 'online') {
          this.net.call('ready').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
          var button = this.dom.overlay.querySelector('.big');
          if (button) { button.setAttribute('disabled', 'disabled'); }
        } else {
          this.startRound();
        }
        return;
      }
      if (action === 'restart') {
        if (this.cfg.mode === 'online') {
          this.net.call('ready').then(function (data) { self.applyServerState(data.state); }).catch(function () {});
        } else {
          global.location.href = this.settingsUrl();
        }
        return;
      }
      if (action === 'level') {
        this.sendSettings(target.getAttribute('data-level'), null);
      }
      if (action === 'rounds') {
        this.sendSettings(null, parseInt(target.getAttribute('data-rounds'), 10));
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

      if (this.phase === 'build') {
        // Nur einmal pro Frame: Klicks und Tastendruecke sind Flanken.
        this.stepBuild(dt);
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
     * Zustand; alle anderen sehen live, was der Bauende gerade vorhat.
     */
    buildOverlayState: function () {
      var builder = this.activeBuilder();
      if (this.phase !== 'build' || !builder) { return null; }
      var mine = this.cfg.mode !== 'online' || builder.slot === this.mySlot;

      if (mine) {
        return {
          tx: this.build.tx,
          ty: this.build.ty,
          rot: this.build.rot,
          type: this.selectedType(),
          valid: this.build.valid,
          deleting: this.build.deleting,
          color: builder.color
        };
      }

      var view = this.buildView(builder, false);
      if (view.tx < 0 || view.ty < 0) { return null; }
      var type = this.typeAt(builder.hand || [], view.card);
      var cell = this.level.cell(view.tx, view.ty);
      var valid = view.deleting ? !!(cell && cell.kind === 'block')
        : !!type && this.level.canPlaceAt(view.tx, view.ty, type);
      return {
        tx: view.tx,
        ty: view.ty,
        rot: view.rot,
        type: type,
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

      // Countdown und Zeitbalken.
      var cd = this.dom.countdown;
      if (this.phase === 'party' && this.party.countdown > 0) {
        var n = Math.ceil(this.party.countdown);
        cd.textContent = n > 0 ? String(n) : 'LOS!';
        cd.classList.remove('hidden');
        cd.style.transform = 'scale(' + (1 + (this.party.countdown % 1) * 0.35) + ')';
      } else if (this.phase === 'party' && this.party.time < 0.6) {
        cd.textContent = 'LOS!';
        cd.classList.remove('hidden');
      } else {
        cd.classList.add('hidden');
      }

      if (this.phase === 'party' && this.party.countdown <= 0) {
        this.dom.timer.classList.remove('hidden');
        var pct = UDM.clamp(this.party.remaining / PARTY_LIMIT, 0, 1) * 100;
        this.dom['timer-fill'].style.width = pct + '%';
        this.dom['timer-fill'].classList.toggle('warn', this.party.remaining < 10);
      } else {
        this.dom.timer.classList.add('hidden');
      }
    }
  };

  UDM.Game = Game;

  document.addEventListener('DOMContentLoaded', function () {
    if (global.UDM_CONFIG) { Game.init(global.UDM_CONFIG); }
  });
}(window));
