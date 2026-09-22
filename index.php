<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/Cards.php';
require_once __DIR__ . '/lib/Levels.php';
require_once __DIR__ . '/lib/Game.php';
require_once __DIR__ . '/lib/View.php';

$notice = '';
$noticeMap = [
    'notoken' => 'Fuer diesen Raum liegt kein Spieler-Token vor. Bitte neu beitreten.',
    'gone' => 'Der Raum existiert nicht mehr.',
    'full' => 'Der Raum ist voll.',
];
if (isset($_GET['hinweis']) && isset($noticeMap[$_GET['hinweis']])) {
    $notice = $noticeMap[$_GET['hinweis']];
}

$levels = Levels::all();
$characters = Game::CHARACTERS;
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ultimate Duck Mule</title>
<meta name="description" content="Ein Party-Plattformer zum Selberbauen fuer bis zu drei Spieler.">
<?= View::favicon() ?>
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<div class="menu-wrap">

  <header class="brand">
    <div class="logo">
      <canvas id="mascot0" width="70" height="70"></canvas>
      <h1>Ultimate Duck&nbsp;Mule</h1>
      <canvas id="mascot1" width="70" height="70"></canvas>
    </div>
    <p class="sub">Baut das Level gemeinsam &ndash; und rennt euch gegenseitig ins Verderben.</p>
  </header>

  <?php if ($notice !== ''): ?>
    <div class="error-box"><?= htmlspecialchars($notice, ENT_QUOTES) ?></div>
  <?php endif; ?>

  <nav class="tabs" id="tabs">
    <button data-tab="local" class="on">Lokal an einer Tastatur</button>
    <button data-tab="online">Online mit Raumcode</button>
    <button data-tab="rules">Regeln &amp; Bauteile</button>
  </nav>

  <!-- ------------------------------------------------------------ lokal -->
  <section class="panel" id="tab-local">
    <h2>Lokales Spiel</h2>
    <p class="muted">2 oder 3 Spieler an einer Tastatur. Jeder hat seinen eigenen Tastenblock.</p>

    <form method="get" action="game.php" id="local-form">
      <input type="hidden" name="mode" value="local">

      <div class="row" style="margin-bottom:14px">
        <div>
          <label for="local-count">Anzahl Spieler</label>
          <select name="players" id="local-count">
            <option value="2">2 Spieler</option>
            <option value="3" selected>3 Spieler</option>
          </select>
        </div>
        <div>
          <label for="local-level">Level</label>
          <select name="level" id="local-level">
            <option value="">Zufall</option>
            <?php foreach ($levels as $level): ?>
              <option value="<?= htmlspecialchars($level['id'], ENT_QUOTES) ?>"><?= htmlspecialchars($level['name'], ENT_QUOTES) ?></option>
            <?php endforeach; ?>
          </select>
        </div>
        <div>
          <label for="local-target">Punkte zum Sieg</label>
          <input type="number" name="target" id="local-target" value="10" min="3" max="30">
        </div>
      </div>

      <?php for ($i = 0; $i < Game::MAX_PLAYERS; $i++): ?>
        <div class="seat" data-seat="<?= $i ?>">
          <canvas class="seat-canvas" width="54" height="54" data-slot="<?= $i ?>"></canvas>
          <div>
            <label for="name<?= $i ?>">Spieler <?= $i + 1 ?></label>
            <input type="text" id="name<?= $i ?>" name="n<?= $i ?>" maxlength="14"
                   value="Spieler <?= $i + 1 ?>" autocomplete="off">
            <div class="chars" data-charpick="<?= $i ?>">
              <?php $ci = 0; foreach ($characters as $char): ?>
                <button type="button" data-char="<?= htmlspecialchars($char, ENT_QUOTES) ?>"
                        class="<?= $ci === $i ? 'on' : '' ?>">
                  <?= htmlspecialchars(['duck' => 'Ente', 'mule' => 'Maultier', 'racoon' => 'Waschbär'][$char] ?? $char, ENT_QUOTES) ?>
                </button>
              <?php $ci++; endforeach; ?>
            </div>
            <input type="hidden" name="c<?= $i ?>" value="<?= htmlspecialchars($characters[$i % count($characters)], ENT_QUOTES) ?>">
            <div class="keys" data-keys="<?= $i ?>"></div>
          </div>
        </div>
      <?php endfor; ?>

      <button type="submit" class="big">Los geht&rsquo;s</button>
    </form>
  </section>

  <!-- ----------------------------------------------------------- online -->
  <section class="panel hidden" id="tab-online">
    <h2>Online spielen</h2>
    <p class="muted">Ein Spieler erstellt einen Raum und gibt den Code weiter &ndash; bis zu 3 Spieler.</p>

    <div class="seat" style="margin-bottom:16px">
      <canvas class="seat-canvas" width="54" height="54" data-slot="0" id="online-avatar"></canvas>
      <div>
        <label for="online-name">Dein Name</label>
        <input type="text" id="online-name" maxlength="14" value="Spieler" autocomplete="off">
        <div class="chars" data-charpick="online">
          <?php $ci = 0; foreach ($characters as $char): ?>
            <button type="button" data-char="<?= htmlspecialchars($char, ENT_QUOTES) ?>" class="<?= $ci === 0 ? 'on' : '' ?>">
              <?= htmlspecialchars(['duck' => 'Ente', 'mule' => 'Maultier', 'racoon' => 'Waschbär'][$char] ?? $char, ENT_QUOTES) ?>
            </button>
          <?php $ci++; endforeach; ?>
        </div>
      </div>
    </div>

    <div class="grid two">
      <div>
        <h3>Raum erstellen</h3>
        <div class="row" style="margin-bottom:12px">
          <div>
            <label for="host-level">Level</label>
            <select id="host-level">
              <option value="">Zufall</option>
              <?php foreach ($levels as $level): ?>
                <option value="<?= htmlspecialchars($level['id'], ENT_QUOTES) ?>"><?= htmlspecialchars($level['name'], ENT_QUOTES) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
          <div>
            <label for="host-target">Punkte zum Sieg</label>
            <input type="number" id="host-target" value="10" min="3" max="30">
          </div>
        </div>
        <button type="button" class="big" id="btn-create">Raum erstellen</button>
      </div>

      <div>
        <h3>Raum beitreten</h3>
        <label for="join-code">Raumcode</label>
        <input type="text" id="join-code" maxlength="6" placeholder="z.&nbsp;B. K7QM"
               style="text-transform:uppercase;letter-spacing:4px;font-weight:800" autocomplete="off">
        <p class="muted small" style="margin-top:10px">Den Code bekommst du vom Gastgeber.</p>
        <button type="button" class="big" id="btn-join">Beitreten</button>
      </div>
    </div>

    <div id="online-error" class="error-box hidden"></div>
    <div class="hint-box">
      Online laufen Bauphase, Punkte und Rundenwechsel &uuml;ber den PHP-Server;
      die Figuren werden per Polling synchronisiert. Im gemeinsamen WLAN oder
      auf einem Webspace funktioniert das ohne weitere Software.
    </div>
  </section>

  <!-- ------------------------------------------------------------ Regeln -->
  <section class="panel hidden" id="tab-rules">
    <h2>Regeln</h2>
    <ol class="rules">
      <li><strong>Jedes Level ist ohne ein einziges Bauteil zu schaffen.</strong> Alles, was gebaut wird, ist ein Hindernis &ndash; es gibt keine Kletterhilfen.</li>
      <li><strong>Bauphase:</strong> Der Reihe nach setzt jeder <strong>ein Bauteil</strong> aus seiner Hand und darf dabei <strong>ein bereits liegendes entfernen</strong> (Taste X oder Rechtsklick).</li>
      <li><strong>Bauteile verbrauchen sich:</strong> Jedes Bauteil, das jemanden erwischt hat, verschwindet nach der Runde wieder.</li>
      <li><strong>Partyphase:</strong> Alle starten gleichzeitig und versuchen, die Fahne zu erreichen. Wer stirbt, schaut den Rest der Runde zu.</li>
      <li><strong>Punkte:</strong> Ziel erreicht <b>+1</b> &middot; erster im Ziel <b>+1</b> extra &middot;
        einziger im Ziel <b>+2</b> extra &middot; ein Gegner stirbt an deinem Bauteil <b>+1</b> &middot;
        du hast ihn mit &Ouml;l oder Ventilator hineingeschoben <b>+1</b> &middot;
        du stirbst an deinem eigenen Bauteil <b>-1</b>. Unter 0 geht es nicht.
        <strong>Kommt niemand ins Ziel, gibt es f&uuml;r die Runde gar keine Punkte</strong> &ndash; auch keine f&uuml;r Fallen.</li>
      <li><strong>Sieg:</strong> Wer nach einer Runde die Zielpunktzahl erreicht hat und allein vorne liegt, gewinnt.</li>
      <li><strong>Bewegung:</strong> Laufen, springen, an W&auml;nden abrutschen und abspringen (Wandsprung).</li>
      <li>Kommt <strong>drei Runden lang niemand</strong> ins Ziel, ist das Level zugebaut und wird ger&auml;umt.</li>
    </ol>

    <h3>Bauteile</h3>
    <ul class="cardlist">
      <?php foreach (Cards::CATALOG as $id => $card): ?>
        <li>
          <canvas class="cicon" width="40" height="40" data-type="<?= htmlspecialchars($id, ENT_QUOTES) ?>"></canvas>
          <div>
            <b><?= htmlspecialchars($card['name'], ENT_QUOTES) ?></b><br>
            <small><?= htmlspecialchars($card['desc'], ENT_QUOTES) ?><?= $card['rotatable'] ? ' (drehbar)' : '' ?></small>
          </div>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>

</div>

<script src="assets/js/core.js"></script>
<script src="assets/js/level.js"></script>
<script src="assets/js/render.js"></script>
<script>
(function () {
  'use strict';
  var UDM = window.UDM;
  var CHAR_ORDER = <?= json_encode(array_values($characters)) ?>;

  /* ------------------------------------------------------------- Tabs */
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (e) {
    var name = e.target.getAttribute && e.target.getAttribute('data-tab');
    if (!name) { return; }
    ['local', 'online', 'rules'].forEach(function (key) {
      document.getElementById('tab-' + key).classList.toggle('hidden', key !== name);
    });
    Array.prototype.forEach.call(tabs.children, function (button) {
      button.classList.toggle('on', button.getAttribute('data-tab') === name);
    });
  });

  /* --------------------------------------------- Figuren-Vorschauen */
  function stub(slot, charId) {
    return {
      x: 16, y: 16, w: UDM.PHYS.playerW, h: UDM.PHYS.playerH,
      slot: slot, char: charId, face: 1, anim: 'idle', animTime: 0,
      squash: 1, alive: true, finished: false, deathTimer: 0, name: '',
      color: UDM.SLOT_COLORS[slot % 3], dark: UDM.SLOT_DARK[slot % 3]
    };
  }

  function paint(canvas, slot, charId, time) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var p = stub(slot, charId);
    p.x = canvas.width / 2 - p.w / 2;
    p.y = canvas.height - p.h - 6;
    p.animTime = time;
    UDM.Render.drawPlayer(ctx, p, time, false);
  }

  // Nur die Sitzplaetze des lokalen Spiels - der Online-Block nutzt dieselbe
  // Optik, hat aber kein data-seat und darf hier nicht mitlaufen.
  var seats = Array.prototype.slice.call(document.querySelectorAll('.seat[data-seat]'));
  var mascots = [document.getElementById('mascot0'), document.getElementById('mascot1')];

  function currentChar(index) {
    var picker = document.querySelector('[data-charpick="' + index + '"] .on');
    return picker ? picker.getAttribute('data-char') : CHAR_ORDER[index % CHAR_ORDER.length];
  }

  function repaintSeats(time) {
    seats.forEach(function (seat) {
      var index = parseInt(seat.getAttribute('data-seat'), 10);
      paint(seat.querySelector('canvas'), index, currentChar(index), time);
    });
    paint(mascots[0], 0, 'duck', time);
    paint(mascots[1], 1, 'mule', time + 1);

    var avatar = document.getElementById('online-avatar');
    if (avatar) { paint(avatar, 0, currentChar('online'), time); }
  }

  /* -------------------------------------------------- Zeichenauswahl */
  document.querySelectorAll('[data-charpick]').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var button = e.target.closest('button[data-char]');
      if (!button) { return; }
      Array.prototype.forEach.call(group.children, function (child) { child.classList.remove('on'); });
      button.classList.add('on');
      var key = group.getAttribute('data-charpick');
      var hidden = document.querySelector('input[name="c' + key + '"]');
      if (hidden) { hidden.value = button.getAttribute('data-char'); }
      repaintSeats(performance.now() / 1000);
    });
  });

  /* --------------------------------------------- Sitzplaetze / Tasten */
  var countSelect = document.getElementById('local-count');
  function syncSeats() {
    var count = parseInt(countSelect.value, 10);
    seats.forEach(function (seat) {
      var index = parseInt(seat.getAttribute('data-seat'), 10);
      var off = index >= count;
      seat.classList.toggle('off', off);
      seat.querySelectorAll('input, button').forEach(function (field) { field.disabled = off; });
      var keys = seat.querySelector('[data-keys]');
      var layout = ['A / D laufen, W springen, S runter',
        '← / → laufen, ↑ springen, ↓ runter',
        'J / L laufen, I springen, K runter'][index];
      keys.textContent = off ? 'nicht dabei' : layout;
    });
  }
  countSelect.addEventListener('change', syncSeats);
  syncSeats();

  /* -------------------------------------------------- Bauteil-Symbole */
  document.querySelectorAll('canvas.cicon').forEach(function (canvas) {
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(4, 4);
    var type = canvas.getAttribute('data-type');
    UDM.Render.drawBlock(ctx, {
      type: type, tx: 0, ty: 0, rot: 1, spec: UDM.BLOCKS[type],
      broken: false, touch: -1, shake: 0, id: 1
    }, 0, 0, 0);
    ctx.restore();
  });

  /* ------------------------------------------------------- Animation */
  (function tickAnim(ts) {
    repaintSeats((ts || 0) / 1000);
    requestAnimationFrame(tickAnim);
  }(0));

  /* ---------------------------------------------------------- Online */
  var errorBox = document.getElementById('online-error');

  function onlineName() {
    return document.getElementById('online-name').value;
  }
  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function api(payload) {
    return fetch('api/index.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) { throw new Error(data.error || ('HTTP ' + res.status)); }
        return data;
      });
    });
  }

  function enterRoom(data) {
    try {
      sessionStorage.setItem('udm:' + data.code, data.token);
    } catch (e) {
      // Ohne sessionStorage geht es notfalls auch ueber die URL.
      window.location.href = 'game.php?mode=online&code=' + encodeURIComponent(data.code) +
        '&token=' + encodeURIComponent(data.token);
      return;
    }
    window.location.href = 'game.php?mode=online&code=' + encodeURIComponent(data.code);
  }

  document.getElementById('btn-create').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    errorBox.classList.add('hidden');
    api({
      action: 'create',
      name: onlineName(),
      char: currentChar('online'),
      level: document.getElementById('host-level').value,
      target: parseInt(document.getElementById('host-target').value, 10) || 10
    }).then(enterRoom).catch(function (err) {
      button.disabled = false;
      showError(err.message);
    });
  });

  document.getElementById('btn-join').addEventListener('click', function () {
    var button = this;
    var code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      showError('Bitte einen gueltigen Raumcode eingeben.');
      return;
    }
    button.disabled = true;
    errorBox.classList.add('hidden');
    api({
      action: 'join',
      code: code,
      name: onlineName(),
      char: currentChar('online')
    }).then(enterRoom).catch(function (err) {
      button.disabled = false;
      showError(err.message);
    });
  });

  document.getElementById('join-code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { document.getElementById('btn-join').click(); }
  });
}());
</script>
</body>
</html>
