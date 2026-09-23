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
$charLabels = ['duck' => 'Ente', 'mule' => 'Maultier', 'racoon' => 'Waschbär', 'frog' => 'Frosch'];

// Vorbelegung ueber die Adresse, etwa ?tab=rules oder ?level=vulkan.
$preLevel = (string) ($_GET['level'] ?? '');
$pre = [
    'tab' => in_array($_GET['tab'] ?? '', ['online', 'rules'], true) ? $_GET['tab'] : 'online',
    'level' => Levels::byId($preLevel) !== null ? $preLevel : '',
    'rounds' => Game::clampRounds((int) ($_GET['rounds'] ?? Game::DEFAULT_ROUNDS)),
];

/** Auswahlliste fuer die Matchlaenge in Runden. */
function roundsSelect(string $id, string $name, int $selected): void
{
    $choices = [3, 5, 8, 10, 12, 15, 20];
    if (!in_array($selected, $choices, true)) {
        $choices[] = $selected;
        sort($choices);
    }
    echo '<select id="' . htmlspecialchars($id, ENT_QUOTES) . '"'
        . ($name !== '' ? ' name="' . htmlspecialchars($name, ENT_QUOTES) . '"' : '') . '>';
    foreach ($choices as $n) {
        echo '<option value="' . $n . '"' . ($n === $selected ? ' selected' : '') . '>' . $n . ' Runden</option>';
    }
    echo '</select>';
}

/**
 * Weltauswahl mit Vorschaubildern. Die Bilder zeichnet der Browser mit
 * derselben Rendering-Funktion wie im Spiel.
 *
 * @param list<array<string, mixed>> $levels
 */
function levelPicker(string $inputId, string $inputName, string $selected, array $levels): void
{
    $e = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES);
    echo '<div class="level-picker" data-input="' . $e($inputId) . '">';
    echo '<button type="button" class="lvl' . ($selected === '' ? ' on' : '') . '" data-level="">'
        . '<span class="lvl-thumb lvl-random">?</span><span class="lvl-name">Zufall</span></button>';
    foreach ($levels as $level) {
        echo '<button type="button" class="lvl' . ($selected === $level['id'] ? ' on' : '')
            . '" data-level="' . $e($level['id']) . '" title="' . $e($level['desc']) . '">'
            . '<canvas class="lvl-thumb" width="200" height="115" data-preview="' . $e($level['id']) . '"></canvas>'
            . '<span class="lvl-name">' . $e($level['name']) . '</span></button>';
    }
    echo '</div>';
    echo '<input type="hidden" id="' . $e($inputId) . '"'
        . ($inputName !== '' ? ' name="' . $e($inputName) . '"' : '')
        . ' value="' . $e($selected) . '">';
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ultimate Duck Mule</title>
<meta name="description" content="Ein Party-Plattformer zum Selberbauen für bis zu vier Spieler.">
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
    <button data-tab="online"<?= $pre['tab'] === 'online' ? ' class="on"' : '' ?>>Spielen</button>
    <button data-tab="rules"<?= $pre['tab'] === 'rules' ? ' class="on"' : '' ?>>Regeln &amp; Bauteile</button>
  </nav>

  <!-- ----------------------------------------------------------- online -->
  <section class="panel<?= $pre['tab'] === 'online' ? '' : ' hidden' ?>" id="tab-online">
    <h2>Online spielen</h2>
    <p class="muted">Ein Spieler erstellt einen Raum und gibt den Code weiter &ndash; bis zu 4 Spieler.
      Jeder spielt an seinem eigenen Rechner; Farbe und Einstellungen w&auml;hlt ihr danach in der Lobby.</p>

    <div class="seat" style="margin-bottom:16px">
      <canvas class="seat-canvas" width="54" height="54" data-slot="0" id="online-avatar"></canvas>
      <div>
        <label for="online-name">Dein Name</label>
        <input type="text" id="online-name" maxlength="14" value="Spieler" autocomplete="off">
        <div class="chars" data-charpick="online">
          <?php $ci = 0; foreach ($characters as $char): ?>
            <button type="button" data-char="<?= htmlspecialchars($char, ENT_QUOTES) ?>" class="<?= $ci === 0 ? 'on' : '' ?>">
              <?= htmlspecialchars($charLabels[$char] ?? $char, ENT_QUOTES) ?>
            </button>
          <?php $ci++; endforeach; ?>
        </div>
      </div>
    </div>

    <div class="grid two">
      <div>
        <h3>Raum erstellen</h3>
        <label>Welt</label>
        <?php levelPicker('host-level', '', $pre['level'], $levels); ?>
        <div class="row" style="margin:12px 0">
          <div>
            <label for="host-rounds">Spiellänge</label>
            <?php roundsSelect('host-rounds', '', $pre['rounds']); ?>
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
  <section class="panel<?= $pre['tab'] === 'rules' ? '' : ' hidden' ?>" id="tab-rules">
    <h2>Regeln</h2>
    <ol class="rules">
      <li><strong>Jedes Level ist ohne ein einziges Bauteil zu schaffen.</strong> Alles, was gebaut wird, ist ein Hindernis &ndash; es gibt keine Kletterhilfen.</li>
      <li><strong>Bauphase:</strong> Der Reihe nach setzt jeder <strong>ein Bauteil</strong> aus seiner Hand. Die Reihenfolge richtet sich nach dem Punktestand: <strong>wer vorne liegt, baut zuerst</strong> &ndash; wer hinten liegt, sieht alles und hat das letzte Wort. Gleichstand entscheidet das Los.</li>
      <li><strong>Bauteile bleiben liegen.</strong> Selbst l&ouml;schen kann man nichts. Ein Bauteil verschwindet nur, wenn es in einer Runde <strong>alle Spieler</strong> erwischt hat &ndash; oder wenn jemand die <strong>Abrissbirne</strong> (Power-up) darauf ansetzt.</li>
      <li><strong>Partyphase:</strong> Alle starten gleichzeitig und versuchen, die Fahne zu erreichen. Wer stirbt, schaut den Rest der Runde zu.</li>
      <li><strong>Punkte:</strong> Ziel erreicht <b>+1</b> &middot; erster im Ziel <b>+1</b> extra &middot;
        einziger im Ziel <b>+2</b> extra &middot; ein Gegner stirbt an deinem Bauteil <b>+1</b> &middot;
        du hast ihn mit &Ouml;l oder Ventilator hineingeschoben <b>+1</b> &middot;
        du stirbst an deinem eigenen Bauteil <b>-1</b>. Unter 0 geht es nicht.
        <strong>Kommt niemand ins Ziel, gibt es f&uuml;r die Runde gar keine Punkte</strong> &ndash; auch keine f&uuml;r Fallen.</li>
      <li><strong>Sieg:</strong> Ein Match dauert eine feste Zahl an Runden. Wer danach die meisten Punkte hat, gewinnt &ndash; bei Gleichstand teilen sich die F&uuml;hrenden den Sieg.</li>
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

    <h3 style="margin-top:18px">Power-ups</h3>
    <p class="muted small">Liegen oft als vierte Karte auf der Hand und helfen dir selbst. Anklicken setzt sie ein &ndash; sie kosten keinen Zug, m&uuml;ssen aber <strong>vor</strong> dem eigenen Bauteil kommen, denn das beendet den Zug. Doppelsprung, Schutzschild, Turbo und Gleitschirm wirken in der direkt folgenden Partyphase.</p>
    <ul class="cardlist">
      <?php foreach (Cards::POWERUPS as $id => $card): ?>
        <li>
          <canvas class="cicon" width="40" height="40" data-type="<?= htmlspecialchars($id, ENT_QUOTES) ?>"></canvas>
          <div>
            <b><?= htmlspecialchars($card['name'], ENT_QUOTES) ?></b><br>
            <small><?= htmlspecialchars($card['desc'], ENT_QUOTES) ?></small>
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
  var LEVELS = <?= json_encode($levels, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;

  /* ------------------------------------------------- Weltauswahl */
  document.querySelectorAll('canvas[data-preview]').forEach(function (canvas) {
    var id = canvas.getAttribute('data-preview');
    var def = LEVELS.filter(function (l) { return l.id === id; })[0];
    if (def) { UDM.Render.drawPreview(canvas, def); }
  });

  document.querySelectorAll('.level-picker').forEach(function (picker) {
    var input = document.getElementById(picker.getAttribute('data-input'));
    picker.addEventListener('click', function (e) {
      var card = e.target.closest('.lvl');
      if (!card) { return; }
      Array.prototype.forEach.call(picker.querySelectorAll('.lvl'), function (other) {
        other.classList.toggle('on', other === card);
      });
      input.value = card.getAttribute('data-level');
    });
  });

  /* ------------------------------------------------------------- Tabs */
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (e) {
    var name = e.target.getAttribute && e.target.getAttribute('data-tab');
    if (!name) { return; }
    ['online', 'rules'].forEach(function (key) {
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
      color: UDM.slotColor(slot), dark: UDM.darken(UDM.slotColor(slot))
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

  var mascots = [document.getElementById('mascot0'), document.getElementById('mascot1')];

  function currentChar(index) {
    var picker = document.querySelector('[data-charpick="' + index + '"] .on');
    return picker ? picker.getAttribute('data-char') : CHAR_ORDER[index % CHAR_ORDER.length];
  }

  function repaintSeats(time) {
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
      repaintSeats(performance.now() / 1000);
    });
  });

  /* -------------------------------------------------- Bauteil-Symbole */
  document.querySelectorAll('canvas.cicon').forEach(function (canvas) {
    UDM.Render.drawCardIcon(canvas, canvas.getAttribute('data-type'), 1, 0);
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
      window.location.href = 'game.php?code=' + encodeURIComponent(data.code) +
        '&token=' + encodeURIComponent(data.token);
      return;
    }
    window.location.href = 'game.php?code=' + encodeURIComponent(data.code);
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
      rounds: parseInt(document.getElementById('host-rounds').value, 10) || 8
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
