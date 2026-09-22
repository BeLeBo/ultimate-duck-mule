<?php
declare(strict_types=1);

/**
 * Selbsttest-Seite: prueft die Physik im Browser und vergleicht die
 * Bauregeln von JavaScript mit denen des Servers.
 *
 * Aufruf: tests.php im Browser oeffnen.
 */

require_once __DIR__ . '/lib/Levels.php';
require_once __DIR__ . '/lib/Cards.php';

// Vom Server berechnete Sperrflaechen - der Client muss zum selben Ergebnis kommen.
$blocked = [];
foreach (Levels::all() as $level) {
    $blocked[$level['id']] = array_keys(Levels::blockedTiles($level['id']));
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Selbsttest – Ultimate Duck Mule</title>
<link rel="stylesheet" href="assets/css/style.css">
<style>
  .menu-wrap { max-width: 900px; }
  #results { list-style: none; padding: 0; margin: 0; }
  #results li { padding: 8px 12px; border-radius: 8px; margin-bottom: 5px; font-size: 14px; background: rgba(0,0,0,0.25); }
  #results li.pass { border-left: 4px solid var(--good); }
  #results li.fail { border-left: 4px solid var(--bad); background: rgba(255,95,109,0.12); }
  #results .detail { color: var(--muted); font-size: 12px; }
  #summary { font-size: 20px; font-weight: 800; margin-bottom: 14px; }
</style>
</head>
<body>
<div class="menu-wrap">
  <h1>Selbsttest</h1>
  <p class="muted">Physik, Bauteile und die Abstimmung zwischen Server und Client.</p>
  <div class="panel">
    <div id="summary">läuft …</div>
    <ul id="results"></ul>
  </div>
  <p style="margin-top:16px"><a href="index.php">&larr; zurück zum Menü</a></p>
</div>

<script>window.UDM_BLOCKED = <?= json_encode($blocked) ?>;</script>
<script src="assets/js/core.js"></script>
<script src="assets/js/level.js"></script>
<script src="assets/js/player.js"></script>
<script>
(function () {
  'use strict';
  var UDM = window.UDM;
  var TILE = UDM.TILE;
  var results = [];

  function check(name, condition, detail) {
    results.push({ name: name, ok: !!condition, detail: detail || '' });
  }

  /* ------------------------------------------------------- Testwerkzeug */

  var FLAT = {
    id: 'test-flat', name: 'Testboden', theme: 'day',
    spawn: { x: 2, y: 17 }, goal: { x: 35, y: 17 },
    rects: [{ x: 0, y: 18, w: 40, h: 5, t: 'ground' }]
  };
  var VOID = {
    id: 'test-void', name: 'Testleere', theme: 'day',
    spawn: { x: 2, y: 17 }, goal: { x: 35, y: 17 },
    rects: []
  };

  var nextId = 1;
  function block(type, x, y, rot, owner) {
    return { id: nextId++, type: type, x: x, y: y, rot: rot || 0, ownerSlot: owner === undefined ? 1 : owner };
  }

  function makeLevel(def, blocks) {
    var level = new UDM.Level(def);
    level.rebuild(blocks || []);
    level.resetRound();
    return level;
  }

  function makePlayer(tx, ty) {
    var p = new UDM.Player(0, { name: 'Test', char: 'duck' });
    // Fuesse auf der Oberkante der Kachel darunter.
    p.reset(tx * TILE + 5, (ty + 1) * TILE - UDM.PHYS.playerH);
    return p;
  }

  var NONE = { left: false, right: false, jump: false, down: false, jumpPressed: false };
  function keys(o) { return Object.assign({}, NONE, o || {}); }

  /** Simuliert mit festem Zeitschritt und liefert Messwerte zurueck. */
  function simulate(player, level, seconds, input, options) {
    var dt = 1 / 120;
    var steps = Math.round(seconds / dt);
    var opts = options || {};
    var minY = player.y;
    var events = [];
    var t = 0;
    for (var i = 0; i < steps; i++) {
      var frameInput = typeof input === 'function' ? input(t, player) : input;
      level.update(dt, t);
      player.update(dt, frameInput, level);
      var event = player.checkFate(level);
      if (event) { events.push(event); }
      minY = Math.min(minY, player.y);
      t += dt;
      if (!opts.keepGoing && (!player.alive || player.finished)) { break; }
    }
    return { time: t, minY: minY, events: events };
  }

  /* --------------------------------------------------------- Grundlagen */

  (function testFallAndLand() {
    var level = makeLevel(FLAT);
    var p = makePlayer(10, 10);
    simulate(p, level, 2, NONE);
    var expected = 18 * TILE - UDM.PHYS.playerH;
    check('Figur fällt und landet auf dem Boden',
      Math.abs(p.y - expected) < 1.5 && p.onGround,
      'y=' + p.y.toFixed(1) + ' erwartet ' + expected);
  }());

  (function testJumpHeight() {
    var level = makeLevel(FLAT);
    var p = makePlayer(10, 17);
    var start = p.y;
    var run = simulate(p, level, 1.4, function (t) {
      return keys({ jump: t < 0.6, jumpPressed: t < 1 / 60 });
    });
    var height = start - run.minY;
    check('Sprunghöhe liegt bei rund 3 Kacheln',
      height > 90 && height < 130,
      'Höhe = ' + height.toFixed(0) + 'px (' + (height / TILE).toFixed(2) + ' Kacheln)');
  }());

  (function testShortHop() {
    var level = makeLevel(FLAT);
    var p = makePlayer(10, 17);
    var start = p.y;
    var run = simulate(p, level, 1.2, function (t) {
      return keys({ jump: t < 0.05, jumpPressed: t < 1 / 60 });
    });
    check('Kurz getippt springt die Figur niedriger',
      start - run.minY < 80 && start - run.minY > 15,
      'Höhe = ' + (start - run.minY).toFixed(0) + 'px');
  }());

  (function testWallJump() {
    var level = makeLevel(FLAT, [
      block('stone', 11, 17), block('stone', 11, 16), block('stone', 11, 15),
      block('stone', 11, 14), block('stone', 11, 13), block('stone', 11, 12)
    ]);
    var p = makePlayer(10, 17);
    var start = p.y;
    // Erst gegen die Wand springen, dann immer wieder abdrücken.
    var run = simulate(p, level, 3, function (t, player) {
      var pressJump = (t % 0.35) < 1 / 90;
      return keys({ right: true, jump: true, jumpPressed: pressJump });
    }, { keepGoing: true });
    check('Wandsprung gewinnt Höhe',
      start - run.minY > 110,
      'Höhengewinn = ' + (start - run.minY).toFixed(0) + 'px');
  }());

  (function testFallOutOfWorld() {
    var level = makeLevel(VOID);
    var p = makePlayer(10, 5);
    simulate(p, level, 3, NONE);
    check('Sturz aus dem Level tötet (Ursache "sturz")',
      !p.alive && p.cause === 'sturz', 'cause=' + p.cause);
  }());

  (function testGoal() {
    var level = makeLevel(FLAT);
    var goal = level.goalRect();
    var p = makePlayer(35, 17);
    p.x = goal.x + 2;
    simulate(p, level, 1, NONE);
    check('Fahne berühren beendet die Runde erfolgreich',
      p.finished && p.cause === 'ziel', 'finished=' + p.finished);
  }());

  /* ------------------------------------------------------------ Bauteile */

  (function testBounce() {
    // Aus Kachel 14 auf einen Sprungblock in Kachel 17 fallen lassen und
    // messen, wie hoch es ueber die Blockoberkante zurueckgeht.
    var level = makeLevel(FLAT, [block('bounce', 10, 17)]);
    var p = makePlayer(10, 14);
    var run = simulate(p, level, 2.5, NONE, { keepGoing: true });
    var surface = 17 * TILE - UDM.PHYS.playerH;
    var rebound = surface - run.minY;
    check('Sprungblock katapultiert ohne Tastendruck nach oben',
      rebound > 100, 'Rückprall = ' + rebound.toFixed(0) + 'px über der Blockoberkante');
  }());

  (function testBounceBeatsJump() {
    var jumpLevel = makeLevel(FLAT);
    var jumper = makePlayer(10, 17);
    var jumpRun = simulate(jumper, jumpLevel, 1.4, function (t) {
      return keys({ jump: t < 0.6, jumpPressed: t < 1 / 60 });
    }, { keepGoing: true });

    var level = makeLevel(FLAT, [block('bounce', 10, 17)]);
    var p = makePlayer(10, 13);
    var run = simulate(p, level, 3, NONE, { keepGoing: true });
    check('Aus großer Höhe federt der Sprungblock höher als ein Sprung',
      run.minY < jumpRun.minY,
      'Sprungblock=' + run.minY.toFixed(0) + ' vs. Sprung=' + jumpRun.minY.toFixed(0));
  }());

  (function testIceVsStone() {
    function slide(type) {
      var blocks = [];
      for (var x = 8; x < 20; x++) { blocks.push(block(type, x, 17)); }
      var level = makeLevel(FLAT, blocks);
      var p = makePlayer(9, 16);
      // Erst beschleunigen, dann loslassen und die Rutschstrecke messen.
      simulate(p, level, 1.2, keys({ right: true }), { keepGoing: true });
      var x0 = p.x;
      simulate(p, level, 1.5, NONE, { keepGoing: true });
      return p.x - x0;
    }
    var ice = slide('ice');
    var stone = slide('stone');
    check('Eis rutscht deutlich weiter als Stein',
      ice > stone + 50 && stone < 30,
      'Eis=' + ice.toFixed(0) + 'px, Stein=' + stone.toFixed(0) + 'px');
  }());

  (function testConveyor() {
    var blocks = [];
    for (var x = 8; x < 18; x++) { blocks.push(block('conveyor', x, 17, 1)); }
    var level = makeLevel(FLAT, blocks);
    var p = makePlayer(9, 16);
    var x0 = p.x;
    simulate(p, level, 1, NONE, { keepGoing: true });
    check('Förderband schiebt die Figur ohne Eingabe nach rechts',
      p.x - x0 > 120, 'Versatz = ' + (p.x - x0).toFixed(0) + 'px');

    var left = makeLevel(FLAT, [block('conveyor', 9, 17, 3), block('conveyor', 8, 17, 3), block('conveyor', 7, 17, 3)]);
    var q = makePlayer(9, 16);
    var qx = q.x;
    simulate(q, left, 0.8, NONE, { keepGoing: true });
    check('Gedrehtes Förderband schiebt nach links',
      q.x - qx < -60, 'Versatz = ' + (q.x - qx).toFixed(0) + 'px');
  }());

  (function testFan() {
    var level = makeLevel(FLAT, [block('fan', 10, 17, 0)]);
    var p = makePlayer(10, 16);
    var run = simulate(p, level, 1.2, NONE, { keepGoing: true });
    check('Ventilator hebt die Figur nach oben',
      (16 * TILE - UDM.PHYS.playerH) - run.minY > 60,
      'Hub = ' + ((16 * TILE - UDM.PHYS.playerH) - run.minY).toFixed(0) + 'px');
  }());

  (function testLadder() {
    var level = makeLevel(FLAT, [
      block('ladder', 10, 17), block('ladder', 10, 16), block('ladder', 10, 15), block('ladder', 10, 14)
    ]);
    var p = makePlayer(10, 17);
    var start = p.y;
    simulate(p, level, 1.2, keys({ jump: true }), { keepGoing: true });
    check('Leiter lässt die Figur nach oben klettern',
      start - p.y > 100, 'Kletterhöhe = ' + (start - p.y).toFixed(0) + 'px');
  }());

  (function testHoney() {
    var blocks = [];
    for (var x = 8; x < 22; x++) { blocks.push(block('honey', x, 17)); }
    var level = makeLevel(FLAT, blocks);
    var sticky = makePlayer(9, 16);
    var x0 = sticky.x;
    simulate(sticky, level, 1, keys({ right: true }), { keepGoing: true });
    var stickyDist = sticky.x - x0;

    var plain = makeLevel(FLAT);
    var fast = makePlayer(9, 17);
    var fx = fast.x;
    simulate(fast, plain, 1, keys({ right: true }), { keepGoing: true });
    check('Klebeblock bremst die Figur',
      stickyDist < (fast.x - fx) * 0.7 && stickyDist > 40,
      'Klebe=' + stickyDist.toFixed(0) + 'px, normal=' + (fast.x - fx).toFixed(0) + 'px');
  }());

  (function testCloud() {
    var level = makeLevel(FLAT, [block('cloud', 10, 16)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 1.6, function (t) {
      return keys({ jump: t < 0.6, jumpPressed: t < 1 / 60 });
    }, { keepGoing: true });
    var onCloud = 16 * TILE - UDM.PHYS.playerH;
    check('Wolke ist von unten durchspringbar und trägt von oben',
      Math.abs(p.y - onCloud) < 2 && p.onGround,
      'y=' + p.y.toFixed(1) + ' erwartet ' + onCloud);
  }());

  (function testCloudDropThrough() {
    var level = makeLevel(FLAT, [block('cloud', 10, 16)]);
    var p = makePlayer(10, 15);
    simulate(p, level, 0.6, NONE, { keepGoing: true });
    var landed = Math.abs(p.y - (16 * TILE - UDM.PHYS.playerH)) < 2;
    simulate(p, level, 1.2, keys({ down: true }), { keepGoing: true });
    check('Mit der Abwärtstaste fällt man durch die Wolke',
      landed && p.y > 17 * TILE, 'gelandet=' + landed + ', y=' + p.y.toFixed(0));
  }());

  (function testCrumble() {
    var level = makeLevel(FLAT, [block('crumble', 10, 17)]);
    var p = makePlayer(10, 16);
    simulate(p, level, 0.2, NONE, { keepGoing: true });
    var intact = !level.cell(10, 17).broken;
    simulate(p, level, 1.2, NONE, { keepGoing: true });
    check('Bruchblock hält kurz und bricht dann weg',
      intact && level.cell(10, 17).broken && p.y > 16 * TILE,
      'vorher intakt=' + intact + ', danach gebrochen=' + level.cell(10, 17).broken);
  }());

  /* --------------------------------------------------------- Todesfallen */

  (function testSpike() {
    var level = makeLevel(FLAT, [block('spike', 10, 17, 0, 2)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 1, NONE);
    check('Stacheln töten und werden dem Besitzer zugeordnet',
      !p.alive && p.cause === 'stachel' && p.killerSlot === 2,
      'cause=' + p.cause + ', killerSlot=' + p.killerSlot);
  }());

  (function testSpikeRotation() {
    // Nach oben zeigende Stacheln in der Kachel darüber dürfen nicht töten,
    // wenn die Figur nur daneben steht.
    var level = makeLevel(FLAT, [block('spike', 14, 17, 0, 2)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 1, NONE);
    check('Stacheln weit weg töten nicht', p.alive, 'alive=' + p.alive);
  }());

  (function testSaw() {
    var level = makeLevel(FLAT, [block('saw', 10, 17, 1, 1)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 2, NONE);
    check('Kreissäge tötet', !p.alive && p.cause === 'saege', 'cause=' + p.cause);
  }());

  (function testSawMoves() {
    var level = makeLevel(FLAT, [block('saw', 10, 14, 1, 1)]);
    var saw = level.saws[0];
    level.update(1 / 120, 0);
    var x0 = saw.x;
    level.update(1 / 120, saw.period / 4);
    check('Kreissäge pendelt entlang ihrer Schiene',
      level.saws.length === 1 && Math.abs(saw.x - x0) > 10 && saw.amp > 10,
      'amp=' + saw.amp.toFixed(0) + ', Versatz=' + (saw.x - x0).toFixed(0));
  }());

  (function testArrow() {
    var level = makeLevel(FLAT, [block('arrow', 5, 17, 1, 1)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 3, NONE);
    check('Pfeilfalle schießt und trifft',
      !p.alive && p.cause === 'pfeil', 'cause=' + p.cause + ', Geschosse=' + level.projectiles.length);
  }());

  (function testArrowBlocked() {
    var level = makeLevel(FLAT, [block('arrow', 5, 17, 1, 1), block('stone', 7, 17)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 3, NONE);
    check('Pfeile bleiben an einer Wand hängen', p.alive, 'alive=' + p.alive);
  }());

  /* ------------------------------------------------- Kompletter Durchlauf */

  (function testWalkthrough() {
    // Auf "Wiesenweg" eine Steinbruecke ueber beide Abgruende bauen und die
    // Figur automatisch durchlaufen lassen: laufen, springen, ins Ziel.
    var def = null;
    <?= 'var allLevels = ' . json_encode(Levels::all()) . ';' ?>
    allLevels.forEach(function (candidate) { if (candidate.id === 'wiese') { def = candidate; } });
    if (!def) { check('Testlevel "Wiesenweg" vorhanden', false, 'nicht gefunden'); return; }

    var bridge = [];
    var x;
    for (x = 8; x <= 14; x++) { bridge.push(block('stone', x, 18, 0, 0)); }
    for (x = 19; x <= 31; x++) { bridge.push(block('stone', x, 18, 0, 0)); }

    var level = makeLevel(def, bridge);
    var p = new UDM.Player(0, { name: 'Bot', char: 'duck' });
    var spawn = level.spawnPoint(0);
    p.reset(spawn.x, spawn.y);

    var run = simulate(p, level, 20, function (t) {
      // Dauerhaft nach rechts, regelmäßig springen.
      return keys({ right: true, jump: (t % 0.5) < 0.22, jumpPressed: (t % 0.5) < 1 / 90 });
    });

    check('Mit gebauter Brücke erreicht eine Figur das Ziel',
      p.finished,
      'finished=' + p.finished + ', x=' + p.x.toFixed(0) + ', Zeit=' + run.time.toFixed(1) + 's' +
      (p.alive ? '' : ', gestorben an: ' + p.cause));
  }());

  /* ------------------------------------------- Abgleich mit dem Server */

  (function testPlacementRules() {
    var mismatches = [];
    var levels = <?= json_encode(Levels::all()) ?>;
    var expected = window.UDM_BLOCKED;

    levels.forEach(function (def) {
      var level = new UDM.Level(def);
      var serverSet = {};
      (expected[def.id] || []).forEach(function (keyString) { serverSet[keyString] = true; });

      for (var x = 0; x < UDM.COLS; x++) {
        for (var y = 0; y < UDM.ROWS; y++) {
          var clientBlocked = !level.canPlaceAt(x, y);
          var serverBlocked = !!serverSet[x + ',' + y];
          if (clientBlocked !== serverBlocked) {
            mismatches.push(def.id + ' ' + x + ',' + y + ' (Client=' + clientBlocked + ', Server=' + serverBlocked + ')');
          }
        }
      }
    });

    check('Bauregeln von Client und Server sind identisch',
      mismatches.length === 0,
      mismatches.length ? mismatches.slice(0, 6).join(' | ') : 'alle 4 Level, 920 Kacheln geprüft');
  }());

  (function testCardCatalogMatches() {
    var server = <?= json_encode(array_map(static fn (array $c): bool => $c['rotatable'], Cards::CATALOG)) ?>;
    var problems = [];
    Object.keys(server).forEach(function (id) {
      if (!UDM.BLOCKS[id]) { problems.push('fehlt in blocks.js: ' + id); return; }
      if (!!UDM.BLOCKS[id].rotatable !== server[id]) { problems.push('Drehbarkeit weicht ab: ' + id); }
    });
    Object.keys(UDM.BLOCKS).forEach(function (id) {
      if (!(id in server)) { problems.push('nur im Client: ' + id); }
    });
    check('Bauteil-Katalog stimmt zwischen PHP und JavaScript',
      problems.length === 0, problems.join(' | ') || Object.keys(server).length + ' Bauteile');
  }());

  (function testSpawnIsSafe() {
    var levels = <?= json_encode(Levels::all()) ?>;
    var problems = [];
    levels.forEach(function (def) {
      var level = new UDM.Level(def);
      for (var i = 0; i < 3; i++) {
        var spawn = level.spawnPoint(i);
        var p = new UDM.Player(i, { name: 'T', char: 'duck' });
        p.reset(spawn.x, spawn.y);
        simulate(p, level, 1.5, NONE, { keepGoing: true });
        if (!p.alive) { problems.push(def.name + ': Spieler ' + (i + 1) + ' stirbt am Start'); }
        if (!p.onGround) { problems.push(def.name + ': Spieler ' + (i + 1) + ' steht nicht auf Boden'); }
      }
    });
    check('Alle drei Startplätze sind in jedem Level sicher',
      problems.length === 0, problems.join(' | ') || '4 Level x 3 Startplätze');
  }());

  /* -------------------------------------------------------- Darstellung */

  var summary = document.getElementById('summary');
  var list = document.getElementById('results');
  var failed = results.filter(function (r) { return !r.ok; }).length;

  list.innerHTML = results.map(function (r) {
    return '<li class="' + (r.ok ? 'pass' : 'fail') + '">' +
      (r.ok ? '✔' : '✖') + ' ' + UDM.escapeHtml(r.name) +
      (r.detail ? '<br><span class="detail">' + UDM.escapeHtml(r.detail) + '</span>' : '') + '</li>';
  }).join('');

  summary.textContent = failed === 0
    ? results.length + ' von ' + results.length + ' Tests bestanden'
    : failed + ' von ' + results.length + ' Tests fehlgeschlagen';
  summary.style.color = failed === 0 ? 'var(--good)' : 'var(--bad)';
  window.UDM_TEST_RESULT = { total: results.length, failed: failed, results: results };
}());
</script>
</body>
</html>
