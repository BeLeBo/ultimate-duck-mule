<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/Cards.php';
require_once __DIR__ . '/lib/Levels.php';
require_once __DIR__ . '/lib/Game.php';
require_once __DIR__ . '/lib/Rooms.php';
require_once __DIR__ . '/lib/View.php';

$mode = ($_GET['mode'] ?? 'local') === 'online' ? 'online' : 'local';

$config = [
    'mode' => $mode,
    'tile' => Levels::TILE,
    'cols' => Levels::COLS,
    'rows' => Levels::ROWS,
    'cards' => Cards::CATALOG,
    'levels' => Levels::all(),
    'endpoint' => 'api/index.php',
    'handSize' => Game::HAND_SIZE,
    'targetScore' => Game::DEFAULT_TARGET,
    'levelId' => null,
    'local' => null,
    'online' => null,
];

if ($mode === 'online') {
    $code = strtoupper(trim((string) ($_GET['code'] ?? '')));
    if (!Rooms::isValidCode($code) || !Rooms::exists($code)) {
        header('Location: index.php?hinweis=gone');
        exit;
    }
    $config['online'] = [
        'code' => $code,
        // Das Token liegt normalerweise im sessionStorage; der URL-Parameter
        // ist nur der Notweg fuer Browser ohne sessionStorage.
        'token' => preg_match('/^[a-f0-9]{32}$/', (string) ($_GET['token'] ?? ''))
            ? (string) $_GET['token']
            : null,
    ];
    $title = 'Raum ' . $code . ' – Ultimate Duck Mule';
} else {
    $count = (int) ($_GET['players'] ?? 3);
    $count = max(2, min(Game::MAX_PLAYERS, $count));

    $players = [];
    for ($i = 0; $i < $count; $i++) {
        $players[] = [
            'name' => Game::cleanName((string) ($_GET['n' . $i] ?? ''), $i),
            'char' => Game::cleanChar((string) ($_GET['c' . $i] ?? ''), $i),
        ];
    }

    $levelId = (string) ($_GET['level'] ?? '');
    $config['levelId'] = Levels::byId($levelId) !== null ? $levelId : null;
    $config['targetScore'] = max(3, min(30, (int) ($_GET['target'] ?? Game::DEFAULT_TARGET)));
    $config['local'] = ['players' => $players];
    $title = $count . ' Spieler – Ultimate Duck Mule';
}

$configJson = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars($title, ENT_QUOTES) ?></title>
<?= View::favicon() ?>
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<div id="app">

  <header id="topbar">
    <div id="round-info">
      <span id="round-label">Runde 1</span>
      <span id="target-label">Ziel: <?= (int) $config['targetScore'] ?> Punkte</span>
      <span id="level-label">&nbsp;</span>
    </div>
    <div id="players"></div>
    <div id="topbar-right">
      <button id="btn-sound" type="button">&#128266; Ton an</button>
      <button id="btn-rules" type="button">Regeln</button>
      <a id="btn-exit" href="index.php">Men&uuml;</a>
    </div>
  </header>

  <div id="stage">
    <canvas id="game" width="<?= Levels::COLS * Levels::TILE ?>" height="<?= Levels::ROWS * Levels::TILE ?>"></canvas>
    <div id="banner" class="hidden"></div>
    <div id="countdown" class="hidden"></div>
    <div id="timer" class="hidden"><i id="timer-fill"></i></div>
    <div id="overlay" class="overlay hidden"></div>
  </div>

  <footer id="bottombar">
    <div id="turn-info"></div>
    <div id="hand"></div>
    <div id="hints"></div>
  </footer>

</div>

<script>window.UDM_CONFIG = <?= $configJson ?>;</script>
<script>
(function () {
  'use strict';
  var cfg = window.UDM_CONFIG;
  if (cfg.mode !== 'online') { return; }

  // Token aus dem sessionStorage holen, falls es nicht in der URL steht.
  if (!cfg.online.token) {
    try {
      cfg.online.token = sessionStorage.getItem('udm:' + cfg.online.code);
    } catch (e) {
      cfg.online.token = null;
    }
  } else {
    try {
      sessionStorage.setItem('udm:' + cfg.online.code, cfg.online.token);
      // Token nicht in der Adressleiste stehen lassen.
      history.replaceState(null, '', 'game.php?mode=online&code=' + encodeURIComponent(cfg.online.code));
    } catch (e) { /* egal */ }
  }

  if (!cfg.online.token) {
    window.location.href = 'index.php?hinweis=notoken';
  }
}());
</script>
<script src="assets/js/core.js"></script>
<script src="assets/js/level.js"></script>
<script src="assets/js/input.js"></script>
<script src="assets/js/player.js"></script>
<script src="assets/js/render.js"></script>
<script src="assets/js/net.js"></script>
<script src="assets/js/game.js"></script>
</body>
</html>
