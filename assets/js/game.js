/* Hauptcontroller: Phasen, HUD, Spielschleife - lokal und online. */
(function (global) {
  'use strict';

  var UDM = global.UDM;
  var TILE = UDM.TILE;

  var PARTY_LIMIT = 60;       // Sekunden pro Partyphase
  var PARTY_AFTER_FIRST = 10; // Restzeit, sobald jemand im Ziel ist
  var COUNTDOWN = 2.2;
  var HAND_SIZE = 4;

  var Game = {
    cfg: null,
    canvas: null,
    ctx: null,
    level: null,
    players: [],
    phase: 'boot',
    round: 0,
    targetScore: 10,
    time: 0,
    lastFrame: 0,
    winner: null,
    lastRound: null,
    message: '',
    dom: {},

    build: { order: [], idx: 0, card: 0, rot: 0, tx: -1, ty: -1, valid: false, busy: false },
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
      this.targetScore = cfg.targetScore || 10;
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
        'level-label', 'log'];
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

      this.dom.overlay.addEventListener('click', function (e) {
        var action = e.target.getAttribute && e.target.getAttribute('data-action');
        if (!action) { return; }
        e.preventDefault();
        self.onOverlayAction(action, e.target);
      });

      this.dom.hand.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('[data-card]') : null;
        if (!card) { return; }
        var index = parseInt(card.getAttribute('data-card'), 10);
        if (card.hasAttribute('data-rotate')) {
          self.rotateSelection();
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
      this.dom['target-label'].textContent = 'Ziel: ' + this.targetScore + ' Punkte';
      this.round = 0;
      this.startRound();
    },

    /** Zieht eine Hand nach den Gewichten aus lib/Cards.php. */
    dealHand: function () {
      var cards = this.cfg.cards;
      var pool = [];
      Object.keys(cards).forEach(function (id) {
        for (var i = 0; i < (cards[id].weight || 1); i++) { pool.push(id); }
      });
      var hand = [];
      var guard = 0;
      while (hand.length < HAND_SIZE && guard < 400) {
        guard++;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        if (hand.indexOf(pick) === -1) { hand.push(pick); }
      }
      return hand;
    },

    startRound: function () {
      this.round++;
      this.phase = 'build';
      this.winner = null;
      this.hideOverlay();

      var count = this.players.length;
      var first = (this.round - 1) % count;
      this.build.order = [];
      for (var i = 0; i < count; i++) {
        this.build.order.push((first + i) % count);
      }
      this.build.idx = 0;
      this.build.card = 0;
      this.build.rot = 0;

      for (var p = 0; p < this.players.length; p++) {
        this.players[p].hand = this.dealHand();
      }
      this.parkPlayers();

      this.setBanner('Runde ' + this.round + ' – Bauphase');
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

        this.build.valid = this.level.canPlaceAt(this.build.tx, this.build.ty);

        var wantsPlace = mouse.clicked || UDM.Input.wasPressed('Enter') || UDM.Input.wasPressed('Space');
        if (wantsPlace) {
          this.tryPlace(builder);
        }
      } else {
        this.build.valid = false;
      }
    },

    selectCard: function (index) {
      var builder = this.activeBuilder();
      if (!builder || !builder.hand || index < 0 || index >= builder.hand.length) { return; }
      if (this.cfg.mode === 'online' && builder.slot !== this.mySlot) { return; }
      this.build.card = index;
      this.build.rot = 0;
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

    selectedType: function () {
      var builder = this.activeBuilder();
      if (!builder || !builder.hand) { return null; }
      return builder.hand[this.build.card] || null;
    },

    tryPlace: function (builder) {
      if (this.build.busy) { return; }
      var type = this.selectedType();
      if (!type) { return; }
      if (!this.level.canPlaceAt(this.build.tx, this.build.ty)) {
        UDM.Audio.deny();
        this.setBanner('Da passt nichts hin!', 1.2);
        return;
      }

      if (this.cfg.mode === 'online') {
        this.placeOnline(type);
        return;
      }

      this.level.addBlock({
        id: this.level.blocks.length + 1,
        type: type,
        x: this.build.tx,
        y: this.build.ty,
        rot: this.build.rot,
        ownerSlot: builder.slot
      });
      builder.hand = [];
      UDM.Audio.place();
      UDM.Render.kick(2);
      this.advanceBuild();
    },

    advanceBuild: function () {
      this.build.idx++;
      this.build.card = 0;
      this.build.rot = 0;
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
          UDM.Render.kick(event.type === 'death' ? 7 : 4);
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

      players.forEach(function (p) {
        var delta = 0;
        var reasons = [];

        if (p.finished) {
          delta += 1;
          reasons.push({ text: 'Ziel erreicht', points: 1 });
          if (finishers.length === 1 && players.length > 1) {
            delta += 2;
            reasons.push({ text: 'Einziger im Ziel', points: 2 });
          }
        }

        var victims = players.filter(function (o) {
          return o !== p && o.killerSlot === p.slot;
        }).length;
        if (victims > 0) {
          delta += victims;
          reasons.push({ text: victims > 1 ? 'Fallensteller (x' + victims + ')' : 'Fallensteller', points: victims });
        }

        if (p.killerSlot === p.slot) {
          delta -= 1;
          reasons.push({ text: 'Eigengoal', points: -1 });
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

      return { round: this.round, entries: entries, anyFinisher: finishers.length > 0 };
    },

    finishRoundLocal: function () {
      this.lastRound = this.scoreRound(this.players);

      // Drei Runden ohne Zieleinlauf: das Level ist zugebaut, alles raeumen.
      if (this.lastRound.anyFinisher) {
        this.deadRounds = 0;
      } else {
        this.deadRounds = (this.deadRounds || 0) + 1;
        if (this.deadRounds >= 3) {
          this.deadRounds = 0;
          this.level.rebuild([]);
          this.lastRound.cleared = true;
        }
      }

      var leader = this.players.slice().sort(function (a, b) { return b.score - a.score; });
      var champion = null;
      if (leader[0].score >= this.targetScore && (leader.length < 2 || leader[0].score > leader[1].score)) {
        champion = leader[0];
      }

      if (champion) {
        this.winner = { slot: champion.slot, name: champion.name, char: champion.char, score: champion.score };
        this.phase = 'over';
        UDM.Audio.win();
        this.showWinner();
      } else {
        this.phase = 'score';
        this.showScore();
      }
      this.updateHud();
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
          anim: me.anim
        };
      }

      this.net.sync(pos).then(function (data) {
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
      this.targetScore = state.targetScore;

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
          this.parkPlayers();
          this.hideOverlay();
        }
        var builder = this.activeBuilder();
        if (builder) {
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
        player.remote = info.slot !== this.mySlot;
        if (info.you) { player.hand = info.hand || []; }
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
        card: this.build.card,
        x: this.build.tx,
        y: this.build.ty,
        rot: this.build.rot
      }).then(function (data) {
        self.build.busy = false;
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
        cause: me.cause
      }).then(function (data) {
        self.applyServerState(data.state);
      }).catch(function () {
        self.party.reported = false;
      });
    },

    /* ---------------------------------------------------------- Oberflaeche */

    setBanner: function (text, seconds) {
      this.message = text;
      this.dom.banner.textContent = text;
      this.dom.banner.classList.toggle('hidden', !text);
      this.bannerTimer = seconds || 0;
    },

    updateHud: function () {
      this.dom['round-label'].textContent = this.round > 0 ? 'Runde ' + this.round : 'Lobby';
      if (this.cfg.mode !== 'online') {
        this.dom['target-label'].textContent = 'Ziel: ' + this.targetScore + ' Punkte';
      }
      this.renderPlayers();
      this.renderHand();
      this.renderHints();
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
          status = p.placedThisRound || (this.cfg.mode !== 'online' && this.hasBuilt(p)) ? 'fertig' : 'baut noch';
        } else if (p.connected === false) {
          status = 'offline';
        }

        html += '<div class="' + classes.join(' ') + '" style="--c:' + p.color + '">' +
          '<span class="pdot"></span>' +
          '<span class="pname">' + UDM.escapeHtml(p.name) + '</span>' +
          '<span class="pscore">' + p.score + '</span>' +
          '<span class="pstatus">' + status + '</span>' +
          '</div>';
      }
      this.dom.players.innerHTML = html;
    },

    hasBuilt: function (player) {
      var position = this.build.order.indexOf(player.slot);
      return position >= 0 && position < this.build.idx;
    },

    renderHand: function () {
      var builder = this.activeBuilder();
      var mine = builder && (this.cfg.mode !== 'online' || builder.slot === this.mySlot);

      if (this.phase !== 'build' || !builder) {
        this.dom.hand.innerHTML = '';
        this.dom['turn-info'].textContent = this.phaseLabel();
        return;
      }

      this.dom['turn-info'].innerHTML = mine
        ? '<strong style="color:' + builder.color + '">' + UDM.escapeHtml(builder.name) + '</strong> ist am Zug – Bauteil wählen und platzieren'
        : '<strong style="color:' + builder.color + '">' + UDM.escapeHtml(builder.name) + '</strong> baut gerade …';

      if (!mine || !builder.hand || !builder.hand.length) {
        this.dom.hand.innerHTML = '';
        return;
      }

      var cards = this.cfg.cards;
      var html = '';
      for (var i = 0; i < builder.hand.length; i++) {
        var id = builder.hand[i];
        var meta = cards[id] || { name: id, desc: '' };
        var selected = i === this.build.card ? ' selected' : '';
        html += '<button class="card' + selected + '" data-card="' + i + '" title="' +
          UDM.escapeHtml(meta.desc) + '">' +
          '<span class="ckey">' + (i + 1) + '</span>' +
          '<canvas class="cicon" width="40" height="40" data-type="' + id + '"></canvas>' +
          '<span class="cname">' + UDM.escapeHtml(meta.name) + '</span>' +
          '</button>';
      }

      var type = this.selectedType();
      var rotatable = type && UDM.BLOCKS[type] && UDM.BLOCKS[type].rotatable;
      html += '<button class="card rotate' + (rotatable ? '' : ' disabled') + '" data-card="-1" data-rotate="1">' +
        '<span class="ckey">R</span><span class="rot-icon" style="transform:rotate(' +
        (this.build.rot * 90) + 'deg)">↑</span><span class="cname">Drehen</span></button>';

      this.dom.hand.innerHTML = html;
      this.paintCardIcons();
    },

    /** Malt die Mini-Vorschau in die Kartenbuttons. */
    paintCardIcons: function () {
      var icons = this.dom.hand.querySelectorAll('canvas.cicon');
      for (var i = 0; i < icons.length; i++) {
        var canvas = icons[i];
        var type = canvas.getAttribute('data-type');
        var ictx = canvas.getContext('2d');
        ictx.clearRect(0, 0, 40, 40);
        ictx.save();
        ictx.translate(4, 4);
        ictx.scale(1, 1);
        UDM.Render.drawBlock(ictx, {
          type: type,
          tx: 0,
          ty: 0,
          rot: UDM.BLOCKS[type] && UDM.BLOCKS[type].rotatable ? this.build.rot : 0,
          spec: UDM.BLOCKS[type],
          broken: false,
          touch: -1,
          shake: 0,
          id: 1
        }, 0, 0, this.time);
        ictx.restore();
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
      if (this.phase === 'build') {
        html = '<span><b>Maus</b> platzieren</span><span><b>1-4</b> Bauteil</span><span><b>R</b> drehen</span>' +
          '<span>oder eigene Tasten + <b>Enter</b></span>';
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
      this.dom.overlay.className = 'overlay' + (extraClass ? ' ' + extraClass : '');
      this.dom.overlay.innerHTML = '<div class="panel">' + html + '</div>';
    },

    hideOverlay: function () {
      this.dom.overlay.className = 'overlay hidden';
      this.dom.overlay.innerHTML = '';
    },

    showLobby: function () {
      var state = this.server;
      if (!state) { return; }
      var rows = state.players.map(function (p) {
        return '<li style="--c:' + UDM.SLOT_COLORS[p.slot % 3] + '">' +
          '<span class="pdot"></span>' + UDM.escapeHtml(p.name) +
          (p.host ? ' <em>(Gastgeber)</em>' : '') +
          (p.you ? ' <em>(du)</em>' : '') +
          ' <small>' + (UDM.CHARACTERS[p.char] ? UDM.CHARACTERS[p.char].label : p.char) + '</small></li>';
      }).join('');

      var canStart = state.isHost && state.players.length >= 2;
      this.showOverlay(
        '<h2>Raum ' + UDM.escapeHtml(state.code) + '</h2>' +
        '<p class="muted">Code weitergeben – bis zu 3 Spieler.</p>' +
        '<ul class="lobby-list">' + rows + '</ul>' +
        (state.isHost
          ? '<button class="big" data-action="start"' + (canStart ? '' : ' disabled') + '>Spiel starten</button>' +
            (canStart ? '' : '<p class="muted">Mindestens 2 Spieler nötig.</p>')
          : '<p class="muted">Warten, bis der Gastgeber startet …</p>') +
        '<p class="muted small">Level: ' + UDM.escapeHtml(this.level.def.name) +
        ' · Ziel: ' + state.targetScore + ' Punkte</p>'
      );
    },

    showScore: function () {
      var data = this.lastRound;
      if (!data) { return; }
      var self = this;
      var rows = data.entries.slice().sort(function (a, b) { return b.total - a.total; }).map(function (e) {
        var reasons = e.reasons.length
          ? e.reasons.map(function (r) {
              return '<span class="reason">' + UDM.escapeHtml(r.text) +
                ' <b>' + (r.points > 0 ? '+' : '') + r.points + '</b></span>';
            }).join('')
          : '<span class="reason muted">' + (e.finished ? '' : UDM.escapeHtml(UDM.DEATH_LABELS[e.cause] || 'nichts geholt')) + '</span>';
        return '<tr style="--c:' + UDM.SLOT_COLORS[e.slot % 3] + '">' +
          '<td><span class="pdot"></span>' + UDM.escapeHtml(e.name) + '</td>' +
          '<td class="reasons">' + reasons + '</td>' +
          '<td class="delta' + (e.delta === 0 ? ' zero' : '') + '">' +
          (e.delta > 0 ? '+' + e.delta : e.delta) + '</td>' +
          '<td class="total">' + e.total + '</td>' +
          '</tr>';
      }).join('');

      var waiting = '';
      if (this.cfg.mode === 'online' && this.server) {
        var pending = this.server.players.filter(function (p) { return p.connected && !p.ready; });
        waiting = '<p class="muted small">' + (pending.length
          ? 'Warten auf: ' + pending.map(function (p) { return UDM.escapeHtml(p.name); }).join(', ')
          : 'Alle bereit …') + '</p>';
      }

      this.showOverlay(
        '<h2>Runde ' + data.round + '</h2>' +
        (data.anyFinisher ? '' : '<p class="muted">Niemand hat das Ziel erreicht – keine Punkte.</p>') +
        (data.cleared ? '<p class="cleared">Drei Runden ohne Zieleinlauf – das Level wird komplett geräumt.</p>' : '') +
        '<table class="scoretable"><tbody>' + rows + '</tbody></table>' +
        '<button class="big" data-action="next">Weiter</button>' + waiting,
        'score'
      );
    },

    showWinner: function () {
      var w = this.winner || {};
      var color = UDM.SLOT_COLORS[(w.slot || 0) % 3];
      var rows = (this.lastRound ? this.lastRound.entries : []).slice()
        .sort(function (a, b) { return b.total - a.total; })
        .map(function (e) {
          return '<tr style="--c:' + UDM.SLOT_COLORS[e.slot % 3] + '"><td><span class="pdot"></span>' +
            UDM.escapeHtml(e.name) + '</td><td class="total">' + e.total + '</td></tr>';
        }).join('');

      var again = (this.cfg.mode !== 'online' || (this.server && this.server.isHost))
        ? '<button class="big" data-action="restart">Nochmal spielen</button>'
        : '<p class="muted">Der Gastgeber kann ein neues Match starten.</p>';

      this.showOverlay(
        '<h2 style="color:' + color + '">🏆 ' + UDM.escapeHtml(w.name || '?') + ' gewinnt!</h2>' +
        '<table class="scoretable"><tbody>' + rows + '</tbody></table>' +
        again + '<a class="link" href="index.php">Zurück zum Menü</a>',
        'winner'
      );
    },

    showRules: function () {
      var cards = this.cfg.cards;
      var list = Object.keys(cards).map(function (id) {
        return '<li><canvas class="cicon" width="40" height="40" data-type="' + id + '"></canvas>' +
          '<div><b>' + UDM.escapeHtml(cards[id].name) + '</b><br><small>' +
          UDM.escapeHtml(cards[id].desc) + '</small></div></li>';
      }).join('');

      this.showOverlay(
        '<h2>So läuft es</h2>' +
        '<ol class="rules">' +
        '<li><b>Jedes Level ist ohne ein einziges Bauteil zu schaffen.</b> ' +
        'Alles, was gebaut wird, ist ein Hindernis \u2013 keine Hilfe.</li>' +
        '<li><b>Bauphase:</b> Jeder setzt der Reihe nach ein Bauteil ins Level. Es bleibt das ganze Match liegen.</li>' +
        '<li><b>Partyphase:</b> Alle rennen gleichzeitig los und versuchen, die Fahne zu erreichen.</li>' +
        '<li><b>Punkte:</b> Ziel erreicht <b>+1</b>, einziger im Ziel <b>+2</b> extra, ' +
        'ein Gegner stirbt an deinem Bauteil <b>+1</b>, du stirbst an deinem eigenen <b>-1</b>.</li>' +
        '<li>Wer zuerst <b>' + this.targetScore + ' Punkte</b> hat und allein vorn liegt, gewinnt.</li>' +
        '<li>Kommt <b>drei Runden lang niemand</b> ins Ziel, wird das Level komplett ger\u00e4umt.</li>' +
        '</ol>' +
        '<h3>Bauteile</h3><ul class="cardlist">' + list + '</ul>' +
        '<button class="big" data-action="close">Alles klar</button>',
        'rules'
      );
      this.paintOverlayIcons();
    },

    paintOverlayIcons: function () {
      var icons = this.dom.overlay.querySelectorAll('canvas.cicon');
      for (var i = 0; i < icons.length; i++) {
        var canvas = icons[i];
        var type = canvas.getAttribute('data-type');
        var ictx = canvas.getContext('2d');
        ictx.clearRect(0, 0, 40, 40);
        ictx.save();
        ictx.translate(4, 4);
        UDM.Render.drawBlock(ictx, {
          type: type, tx: 0, ty: 0, rot: 1,
          spec: UDM.BLOCKS[type], broken: false, touch: -1, shake: 0, id: 1
        }, 0, 0, this.time);
        ictx.restore();
      }
    },

    showError: function (message) {
      this.showOverlay(
        '<h2>Ups</h2><p>' + UDM.escapeHtml(message) + '</p>' +
        '<a class="big" href="index.php">Zurück zum Menü</a>',
        'error'
      );
    },

    onOverlayAction: function (action) {
      var self = this;
      if (action === 'close') {
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
          for (var i = 0; i < this.players.length; i++) { this.players[i].score = 0; }
          this.level.rebuild([]);
          this.deadRounds = 0;
          this.round = 0;
          this.winner = null;
          this.lastRound = null;
          this.startRound();
        }
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
        var interval = this.phase === 'party' ? 90 : 750;
        if (ts - this.lastPoll > interval) { this.pollNow(); }
      }

      this.renderFrame();
      UDM.Input.endFrame();
      requestAnimationFrame(function (next) { self.loop(next); });
    },

    renderFrame: function () {
      if (!this.level) { return; }
      var builder = this.activeBuilder();
      var showBuild = this.phase === 'build' && builder &&
        (this.cfg.mode !== 'online' || builder.slot === this.mySlot);

      UDM.Render.draw(this.ctx, {
        level: this.level,
        players: this.phase === 'lobby' ? [] : this.players,
        time: this.time,
        showNames: true,
        build: showBuild ? {
          tx: this.build.tx,
          ty: this.build.ty,
          rot: this.build.rot,
          type: this.selectedType(),
          valid: this.build.valid,
          color: builder.color
        } : null
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
