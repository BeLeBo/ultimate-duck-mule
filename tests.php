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
require_once __DIR__ . '/lib/View.php';

require_once __DIR__ . '/lib/Game.php';

// ------------------------------------------------------------ Serverregeln
// Diese Pruefungen laufen direkt in PHP gegen lib/Game.php, lib/Cards.php und
// lib/Levels.php und erscheinen in derselben Ergebnisliste.
$serverChecks = [];
$serverCheck = static function (string $name, bool $ok, string $detail = '') use (&$serverChecks): void {
    $serverChecks[] = ['name' => $name, 'ok' => $ok, 'detail' => $detail];
};

$makeRoom = static function (array $names): array {
    $room = Game::newRoom('TEST', 8, 'wiese');
    foreach ($names as $name) {
        Game::addPlayer($room, $name, '');
    }
    foreach ($room['players'] as &$player) {
        $player['lastSeen'] = time();
    }
    unset($player);

    return $room;
};
$tokenOf = static function (array $room, string $name): string {
    foreach ($room['players'] as $token => $player) {
        if ($player['name'] === $name) {
            return $token;
        }
    }

    return '';
};

// Vier Spieler passen hinein, der fuenfte nicht.
$room = $makeRoom(['A', 'B', 'C', 'D']);
$fifth = '';
try {
    Game::addPlayer($room, 'E', '');
} catch (RuntimeException $e) {
    $fifth = $e->getMessage();
}
$serverCheck('Raum nimmt vier Spieler auf, den fünften nicht', count($room['order']) === 4 && $fifth !== '', $fifth);

// Bau-Reihenfolge nach Punkten.
$room = $makeRoom(['Anna', 'Bo', 'Cem', 'Dana']);
$scores = ['Anna' => 3, 'Bo' => 7, 'Cem' => 3, 'Dana' => 1];
foreach ($room['players'] as &$player) {
    $player['score'] = $scores[$player['name']];
}
unset($player);
$orders = [];
for ($i = 0; $i < 60; $i++) {
    $orders[implode('>', array_map(static fn ($t) => $room['players'][$t]['name'], Game::buildOrder($room)))] = true;
}
$serverCheck('Bau-Reihenfolge: Führender zuerst, Gleichstand ausgelost',
    array_keys($orders) == ['Bo>Anna>Cem>Dana', 'Bo>Cem>Anna>Dana'] || array_keys($orders) == ['Bo>Cem>Anna>Dana', 'Bo>Anna>Cem>Dana'],
    implode(' | ', array_keys($orders)));

// Kartenziehen: immer genug Bauteile.
$badHands = 0;
$withPower = 0;
for ($i = 0; $i < 500; $i++) {
    $hand = Cards::deal(4);
    $blocks = count(array_filter($hand, static fn ($c) => Cards::exists($c)));
    $badHands += (count($hand) !== 4 || $blocks < 3) ? 1 : 0;
    $withPower += $blocks === 3 ? 1 : 0;
}
$serverCheck('Jede Hand hat vier Karten, davon mindestens drei Bauteile',
    $badHands === 0 && $withPower > 100 && $withPower < 320,
    '500 Hände, Power-up in ' . round($withPower / 5) . ' %');

// Power-ups: Hilfen fuer die eigene Figur, die Abrissbirne loescht gezielt.
$room = $makeRoom(['Anna', 'Bo']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$builder = Game::currentBuilder($room);
$room['players'][$builder]['hand'] = ['stone', 'pu_djump', 'pu_remove'];
$room['players'][$builder]['buffs'] = [];
$room['blocks'] = [
    ['id' => 50, 'type' => 'stone', 'x' => 12, 'y' => 14, 'rot' => 0, 'ownerSlot' => 1],
    ['id' => 51, 'type' => 'beam', 'x' => 13, 'y' => 15, 'rot' => 0, 'ownerSlot' => 1],
];
Game::usePower($room, $builder, 1, -1, -1);
$serverCheck('Doppelsprung wirkt auf die eigene Figur und kostet keinen Bauzug',
    $room['players'][$builder]['buffs'] === ['pu_djump'] && $room['players'][$builder]['places'] === 1
    && $room['players'][$builder]['hand'] === ['stone', 'pu_remove'] && Game::currentBuilder($room) === $builder,
    'Buffs ' . json_encode($room['players'][$builder]['buffs']) . ', Hand ' . json_encode($room['players'][$builder]['hand']));
$emptyRemove = '';
try {
    Game::usePower($room, $builder, 1, 2, 2);
} catch (RuntimeException $e) {
    $emptyRemove = $e->getMessage();
}
// Rechtes Ende des Balkens (13..15) trifft den ganzen Balken.
Game::usePower($room, $builder, 1, 15, 15);
$serverCheck('Abrissbirne entfernt genau das getroffene Bauteil und hinterlässt einen Grabstein',
    $emptyRemove !== '' && array_column($room['blocks'], 'id') === [50] && count($room['graves']) === 1
    && $room['players'][$builder]['hand'] === ['stone'],
    'übrig ' . json_encode(array_column($room['blocks'], 'id')) . ', Grabsteine ' . count($room['graves']));
$graveError = '';
$room['players'][$builder]['hand'] = ['beam'];
try {
    Game::place($room, $builder, 0, 13, 15, 0);
} catch (RuntimeException $e) {
    $graveError = $e->getMessage();
}
$serverCheck('Auf einem frischen Grabstein darf derselbe Typ nicht wieder hin',
    strpos($graveError, 'eben erst') !== false, $graveError);
$serverCheck('Ohne Power-up kann niemand selbst löschen',
    !method_exists(Game::class, 'removeBlock') && !array_key_exists('removes', $room['players'][$builder]),
    'removeBlock ' . (method_exists(Game::class, 'removeBlock') ? 'vorhanden' : 'weg'));
Game::beginRound($room);
// Neu gezogene Power-ups der neuen Runde (bonus) sind erlaubt, das alte nicht.
$fresh = $room['players'][$builder]['bonus'] ?? null;
$serverCheck('Power-ups gelten nur für die folgende Partyphase',
    $room['players'][$builder]['buffs'] === ($fresh !== null ? [$fresh] : []),
    json_encode($room['players'][$builder]['buffs']));

// Power-ups setzen sich zu Beginn des eigenen Zugs selbst ein - nur die
// Abrissbirne bleibt auf der Hand.
$room = $makeRoom(['Anna', 'Bo']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$first = Game::currentBuilder($room);
$second = $first === $tokenOf($room, 'Anna') ? $tokenOf($room, 'Bo') : $tokenOf($room, 'Anna');
$room['players'][$second]['hand'] = ['stone', 'spike', 'ice', 'pu_speed'];
$room['players'][$second]['buffs'] = [];
$room['players'][$second]['bonus'] = null;
$beforeTurn = $room['players'][$second]['buffs'];
Game::skipBuild($room, $first);
$ownView = null;
$otherView = null;
foreach (Game::publicState($room, $second)['players'] as $p) {
    if ($p['you']) {
        $ownView = $p;
    }
}
foreach (Game::publicState($room, $first)['players'] as $p) {
    if (!$p['you']) {
        $otherView = $p;
    }
}
$autoOk = $beforeTurn === [] && $room['players'][$second]['buffs'] === ['pu_speed']
    && $room['players'][$second]['hand'] === ['stone', 'spike', 'ice']
    && $ownView['bonus'] === 'pu_speed' && $otherView['bonus'] === null;
// Die Abrissbirne dagegen bleibt als Karte.
$room['players'][$second]['hand'] = ['stone', 'pu_remove'];
Game::startTurn($room);
$serverCheck('Power-ups setzen sich zu Beginn des eigenen Zugs selbst ein, die Abrissbirne bleibt Karte',
    $autoOk && $room['players'][$second]['hand'] === ['stone', 'pu_remove'],
    'Buffs ' . json_encode($room['players'][$second]['buffs']) . ', Hand ' . json_encode($room['players'][$second]['hand']));

// Abrissbirne: zwei Felder, waagerecht oder senkrecht.
$room = $makeRoom(['Anna', 'Bo']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$builder = Game::currentBuilder($room);
$room['blocks'] = [
    ['id' => 60, 'type' => 'stone', 'x' => 20, 'y' => 10, 'rot' => 0, 'ownerSlot' => 1],
    ['id' => 61, 'type' => 'spike', 'x' => 21, 'y' => 10, 'rot' => 0, 'ownerSlot' => 1],
    ['id' => 62, 'type' => 'stone', 'x' => 20, 'y' => 11, 'rot' => 0, 'ownerSlot' => 0],
    ['id' => 63, 'type' => 'saw', 'x' => 25, 'y' => 10, 'rot' => 0, 'ownerSlot' => 0],
];
$room['players'][$builder]['hand'] = ['stone', 'pu_remove'];
Game::usePower($room, $builder, 1, 20, 10, 0);
$afterFlat = array_column($room['blocks'], 'id');
$room['players'][$builder]['hand'] = ['stone', 'pu_remove'];
$room['blocks'][] = ['id' => 64, 'type' => 'stone', 'x' => 25, 'y' => 11, 'rot' => 0, 'ownerSlot' => 0];
Game::usePower($room, $builder, 1, 25, 10, 1);
$serverCheck('Abrissbirne räumt zwei Felder – waagerecht oder senkrecht',
    $afterFlat === [62, 63] && array_column($room['blocks'], 'id') === [62],
    'nach waagerecht ' . json_encode($afterFlat) . ', nach senkrecht ' . json_encode(array_column($room['blocks'], 'id')));

// Handkarten sieht nur ihr Besitzer - auch vom Bauenden sehen die anderen nichts.
$other = $builder === $tokenOf($room, 'Anna') ? $tokenOf($room, 'Bo') : $tokenOf($room, 'Anna');
$seenByOther = [];
$seenBySelf = [];
foreach (Game::publicState($room, $other)['players'] as $p) {
    $seenByOther[$p['name']] = $p['hand'];
}
foreach (Game::publicState($room, $builder)['players'] as $p) {
    $seenBySelf[$p['name']] = $p['hand'];
}
$builderName = $room['players'][$builder]['name'];
$serverCheck('Handkarten sieht nur ihr Besitzer',
    $seenByOther[$builderName] === [] && $seenBySelf[$builderName] === ['stone'],
    'Zuschauer sieht ' . json_encode($seenByOther[$builderName]) . ', Bauender sieht ' . json_encode($seenBySelf[$builderName]));

// Farbwahl in der Lobby: jede Farbe nur einmal.
$room = $makeRoom(['Anna', 'Bo', 'Cem']);
$defaults = array_map(static fn ($p) => $p['color'], array_values($room['players']));
$taken = '';
try {
    Game::setColor($room, $tokenOf($room, 'Bo'), $defaults[0]);
} catch (RuntimeException $e) {
    $taken = $e->getMessage();
}
Game::setColor($room, $tokenOf($room, 'Bo'), '#b18cff');
$state = Game::publicState($room, $tokenOf($room, 'Anna'));
Game::startMatch($room, $tokenOf($room, 'Anna'));
$late = '';
try {
    Game::setColor($room, $tokenOf($room, 'Cem'), '#ff9f43');
} catch (RuntimeException $e) {
    $late = $e->getMessage();
}
$serverCheck('Farbwahl: freie Farbe geht, belegte nicht, nur in der Lobby',
    count(array_unique($defaults)) === 3 && strpos($taken, 'Anna') !== false
    && $state['players'][1]['color'] === '#b18cff' && $late !== '',
    'Standard ' . implode(' ', $defaults) . ' | ' . $taken . ' | ' . $late);

// Tier in der Lobby wechseln - doppelt erlaubt, nach dem Start nicht mehr.
$room = $makeRoom(['Anna', 'Bo']);
Game::setChar($room, $tokenOf($room, 'Bo'), 'frog');
Game::setChar($room, $tokenOf($room, 'Anna'), 'frog');
$badChar = '';
try {
    Game::setChar($room, $tokenOf($room, 'Anna'), 'dragon');
} catch (RuntimeException $e) {
    $badChar = $e->getMessage();
}
Game::startMatch($room, $tokenOf($room, 'Anna'));
$lateChar = '';
try {
    Game::setChar($room, $tokenOf($room, 'Bo'), 'duck');
} catch (RuntimeException $e) {
    $lateChar = $e->getMessage();
}
$serverCheck('Tier wechseln: in der Lobby frei wählbar, danach nicht mehr',
    $room['players'][$tokenOf($room, 'Anna')]['char'] === 'frog' && $room['players'][$tokenOf($room, 'Bo')]['char'] === 'frog'
    && $badChar !== '' && $lateChar !== '',
    $badChar . ' | ' . $lateChar);

// "Nachgeholfen" nur, wenn wirklich jemand gestorben ist.
$room = $makeRoom(['Anna', 'Bo', 'Cem']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
Game::beginParty($room);
$annaSlot = $room['players'][$tokenOf($room, 'Anna')]['slot'];
// Bo streift Annas Öl und kommt trotzdem ins Ziel, Cem gibt nach einem Schubs auf.
Game::reportResult($room, $tokenOf($room, 'Bo'), ['finished' => true, 'time' => 9.0, 'cause' => 'ziel',
    'assistSlot' => $annaSlot, 'assistBlock' => 5]);
Game::reportResult($room, $tokenOf($room, 'Cem'), ['finished' => false, 'time' => 4.0, 'cause' => 'aufgabe',
    'killerSlot' => $annaSlot, 'killerBlock' => 5, 'assistSlot' => $annaSlot]);
Game::reportResult($room, $tokenOf($room, 'Anna'), ['finished' => false, 'time' => 3.0, 'cause' => 'zeit',
    'assistSlot' => 1]);
$annaEntry = null;
foreach ($room['lastRound']['entries'] as $entry) {
    if ($entry['name'] === 'Anna') {
        $annaEntry = $entry;
    }
}
$serverCheck('Nachgeholfen und Fallenpunkte nur bei einem echten Tod',
    $annaEntry !== null && $annaEntry['delta'] === 0 && $annaEntry['reasons'] === [],
    'Anna: ' . json_encode($annaEntry['reasons'] ?? null));
$room['phase'] = 'party';
foreach ($room['players'] as &$player) {
    $player['result'] = null;
}
unset($player);
Game::reportResult($room, $tokenOf($room, 'Bo'), ['finished' => true, 'time' => 9.0, 'cause' => 'ziel']);
Game::reportResult($room, $tokenOf($room, 'Cem'), ['finished' => false, 'time' => 4.0, 'cause' => 'stachel',
    'killerSlot' => 1, 'killerBlock' => 6, 'assistSlot' => $annaSlot, 'assistBlock' => 5]);
Game::reportResult($room, $tokenOf($room, 'Anna'), ['finished' => false, 'time' => 3.0, 'cause' => 'sturz']);
$texts = [];
foreach ($room['lastRound']['entries'] as $entry) {
    if ($entry['name'] === 'Anna') {
        $texts = array_column($entry['reasons'], 'text');
    }
}
$serverCheck('Echter Tod durch Schubs in eine Falle zählt weiterhin als Nachgeholfen',
    $texts === ['Nachgeholfen'], json_encode($texts));

// Ohne eigenen Namen heisst man wie sein Tier.
$room = Game::newRoom('TEST', 8, 'wiese');
$t1 = Game::addPlayer($room, '', 'duck');
$t2 = Game::addPlayer($room, '   ', 'duck');
$t3 = Game::addPlayer($room, 'Max', 'frog');
$namesBefore = [$room['players'][$t1]['name'], $room['players'][$t2]['name'], $room['players'][$t3]['name']];
Game::setChar($room, $t2, 'racoon');
Game::setChar($room, $t3, 'mule');
$serverCheck('Ohne Namen heißt man wie sein Tier – auch nach dem Tierwechsel',
    $namesBefore === ['Ente', 'Ente 2', 'Max'] && $room['players'][$t2]['name'] === 'Waschbär'
    && $room['players'][$t3]['name'] === 'Max',
    implode(', ', $namesBefore) . ' → ' . $room['players'][$t2]['name'] . ', ' . $room['players'][$t3]['name']);

// 15 Sekunden Bauzeit pro Spieler, gestartet nach dem Spielautomaten.
$room = $makeRoom(['Anna', 'Bo']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$first = Game::currentBuilder($room);
$clockBefore = Game::turnClock($room);
Game::turnRolled($room, $first);
$left = (float) $room['turnEnds'] - microtime(true);
$room['turnEnds'] = microtime(true) - Game::BUILD_GRACE - 0.1;
Game::tick($room);
$serverCheck('Bauzeit: 15 s nach dem Automaten, danach ist der Nächste dran',
    $clockBefore['ready'] === false && abs($left - Game::BUILD_TURN) < 0.5
    && Game::currentBuilder($room) !== $first && $room['players'][$first]['placed'] === true
    && Game::turnClock($room)['ready'] === false,
    'vorher bereit=' . var_export($clockBefore['ready'], true) . ', Restzeit ' . round($left, 2) . ' s, danach am Zug: '
    . $room['players'][Game::currentBuilder($room)]['name']);

// Partyzeit: der Server fuehrt die Uhr und beendet die Runde.
$room = $makeRoom(['Anna', 'Bo']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
Game::beginParty($room);
$clock = Game::publicState($room, $tokenOf($room, 'Anna'))['party'];
Game::reportResult($room, $tokenOf($room, 'Anna'), ['finished' => true, 'time' => 12.5, 'cause' => 'ziel']);
$left = (float) $room['partyEnds'] - microtime(true);
$room['partyEnds'] = microtime(true) - Game::PARTY_GRACE - 0.1;
Game::tick($room);
$boResult = $room['players'][$tokenOf($room, 'Bo')]['result'];
$serverCheck('Partyzeit vom Server: 10 s nach dem ersten Zieleinlauf ist für alle Schluss',
    abs($clock['remaining'] - (Game::PARTY_COUNTDOWN + Game::PARTY_LIMIT)) < 0.5
    && $left <= Game::PARTY_AFTER_FIRST + 0.05 && $left > Game::PARTY_AFTER_FIRST - 1
    && $room['phase'] === 'score' && ($boResult['cause'] ?? '') === 'zeit',
    'Start ' . $clock['remaining'] . ' s, nach Zieleinlauf ' . round($left, 2) . ' s, danach Phase ' . $room['phase']
    . ', Bo: ' . ($boResult['cause'] ?? '-'));

// Bauteile verschwinden nur, wenn sie alle erwischt haben.
$room = $makeRoom(['Anna', 'Bo', 'Cem']);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$room['phase'] = 'party';
$room['blocks'] = [
    ['id' => 7, 'type' => 'spike', 'x' => 10, 'y' => 17, 'rot' => 0, 'ownerSlot' => 0],
    ['id' => 8, 'type' => 'saw', 'x' => 20, 'y' => 12, 'rot' => 0, 'ownerSlot' => 1],
];
$results = [
    'Anna' => ['killerSlot' => 0, 'killerBlock' => 7],
    'Bo' => ['killerSlot' => 0, 'killerBlock' => 7],
    'Cem' => ['killerSlot' => 0, 'killerBlock' => 7],
];
foreach ($results as $name => $result) {
    $room['players'][$tokenOf($room, $name)]['result'] = $result + ['finished' => false, 'time' => 3.0, 'cause' => 'stachel'];
}
Game::finishRound($room);
$allKilled = array_column($room['blocks'], 'id');
$room['phase'] = 'party';
foreach (['Anna' => 8, 'Bo' => 8, 'Cem' => null] as $name => $block) {
    $room['players'][$tokenOf($room, $name)]['result'] = $block === null
        ? ['finished' => true, 'time' => 9.0, 'killerSlot' => null, 'killerBlock' => null, 'cause' => 'ziel']
        : ['finished' => false, 'time' => 3.0, 'killerSlot' => 1, 'killerBlock' => $block, 'cause' => 'saege'];
}
Game::finishRound($room);
$serverCheck('Bauteile verschwinden nur, wenn sie alle Spieler erwischt haben',
    $allKilled === [8] && array_column($room['blocks'], 'id') === [8],
    'nach Runde 1: ' . json_encode($allKilled) . ', nach Runde 2: ' . json_encode(array_column($room['blocks'], 'id')));

// Spiellaenge in Runden: Sieger erst nach der letzten Runde, Gleichstand teilt.
$room = Game::newRoom('TEST', 3, 'wiese');
foreach (['Anna', 'Bo', 'Cem'] as $name) {
    Game::addPlayer($room, $name, '');
}
foreach ($room['players'] as &$player) {
    $player['lastSeen'] = time();
}
unset($player);
Game::startMatch($room, $tokenOf($room, 'Anna'));
$phases = [];
for ($r = 1; $r <= 3; $r++) {
    $room['phase'] = 'party';
    foreach (['Anna', 'Bo', 'Cem'] as $name) {
        $finished = $name !== 'Cem';
        $room['players'][$tokenOf($room, $name)]['result'] = [
            'finished' => $finished, 'time' => $name === 'Anna' ? 5.0 : 6.0, 'killerSlot' => null,
            'killerBlock' => null, 'cause' => $finished ? 'ziel' : 'sturz',
        ];
    }
    Game::finishRound($room);
    $phases[] = $room['phase'];
    if ($room['phase'] === 'score') {
        Game::beginRound($room);
    }
}
$serverCheck('Match endet nach der eingestellten Rundenzahl',
    $phases === ['score', 'score', 'over'] && $room['winner']['players'][0]['name'] === 'Anna'
    && count($room['winner']['players']) === 1,
    implode(' → ', $phases) . ', Sieger ' . json_encode($room['winner']));
$room['players'][$tokenOf($room, 'Bo')]['score'] = $room['players'][$tokenOf($room, 'Anna')]['score'];
$room['phase'] = 'party';
$room['round'] = 2;
Game::beginRound($room);
$room['phase'] = 'party';
foreach (['Anna', 'Bo', 'Cem'] as $name) {
    $room['players'][$tokenOf($room, $name)]['result'] = [
        'finished' => false, 'time' => 3.0, 'killerSlot' => null, 'killerBlock' => null, 'cause' => 'sturz',
    ];
}
Game::finishRound($room);
$tied = array_column($room['winner']['players'] ?? [], 'name');
sort($tied);
$serverCheck('Gleichstand nach der letzten Runde: beide gewinnen',
    $room['phase'] === 'over' && $tied === ['Anna', 'Bo'], json_encode($tied));

// Nach dem Match zurueck in die Lobby.
$room = $makeRoom(['Anna', 'Bo']);
$host = $tokenOf($room, 'Anna');
Game::startMatch($room, $host);
$room['phase'] = 'over';
$room['blocks'] = [['id' => 1, 'type' => 'stone', 'x' => 10, 'y' => 10, 'rot' => 0, 'ownerSlot' => 0]];
foreach ($room['players'] as &$player) {
    $player['score'] = 9;
}
unset($player);
$notHost = '';
try {
    Game::backToLobby($room, $tokenOf($room, 'Bo'));
} catch (RuntimeException $e) {
    $notHost = $e->getMessage();
}
Game::backToLobby($room, $host);
Game::updateSettings($room, $host, 'vulkan', 12);
$scoresNow = array_sum(array_column($room['players'], 'score'));
$serverCheck('Nochmal spielen: Lobby mit neuer Welt und Rundenzahl, Punkte und Bauteile zurückgesetzt',
    $notHost !== '' && $room['phase'] === 'lobby' && $room['blocks'] === [] && $scoresNow === 0
    && $room['levelId'] === 'vulkan' && $room['rounds'] === 12 && count($room['order']) === 2
    && Game::publicState($room, $host)['rounds'] === 12,
    'Phase ' . $room['phase'] . ', Welt ' . $room['levelId'] . ', Runden ' . $room['rounds']);

// Karten-Parser lehnt kaputte Karten ab.
$broken = 0;
$rows = array_fill(0, Levels::ROWS, str_repeat('.', Levels::COLS));
$rows[20] = str_repeat('#', Levels::COLS);
$cases = [
    'zu kurz' => array_replace($rows, [3 => '....']),
    'ohne Ziel' => array_replace($rows, [19 => 'S' . str_repeat('.', Levels::COLS - 1)]),
    'zwei Starts' => array_replace($rows, [19 => 'S.S' . str_repeat('.', Levels::COLS - 4) . 'G']),
    'fremdes Zeichen' => array_replace($rows, [19 => 'S?' . str_repeat('.', Levels::COLS - 3) . 'G']),
];
foreach ($cases as $label => $map) {
    try {
        Levels::parseMap(['id' => 'x', 'name' => 'x', 'theme' => 'day', 'desc' => '', 'map' => $map]);
    } catch (LogicException $e) {
        $broken++;
    }
}
$serverCheck('Karten-Parser lehnt fehlerhafte Welten ab', $broken === count($cases), $broken . ' von ' . count($cases) . ' Fehlern erkannt');

// Grabsteine: der Server entscheidet fuer ein Beispiel, der Client muss zustimmen.
$graveRoom = ['levelId' => 'wiese', 'round' => 3, 'blocks' => [], 'graves' => [
    ['type' => 'spike', 'x' => 12, 'y' => 14, 'until' => 4],
    ['type' => 'beam', 'x' => 20, 'y' => 10, 'until' => 3],
    ['type' => 'saw', 'x' => 30, 'y' => 10, 'until' => 2],
]];
$graveProbes = [];
foreach ([
    ['spike', 12, 14], ['stone', 12, 14], ['spike', 13, 14],
    ['beam', 18, 10], ['beam', 22, 10], ['beam', 23, 10], ['beam', 20, 11],
    ['saw', 30, 10],
] as [$type, $x, $y]) {
    $graveProbes[] = ['type' => $type, 'x' => $x, 'y' => $y,
        'blocked' => Game::blockedByGrave($graveRoom, $x, $y, $type)];
}
$graveActive = Game::activeGraves($graveRoom);

// Vom Server berechnete Sperrflaechen - der Client muss zum selben Ergebnis kommen.
$blocked = [];
$bigOk = [];
foreach (Levels::all() as $level) {
    $blocked[$level['id']] = array_keys(Levels::blockedTiles($level['id']));

    // Und fuer die mehrkacheligen Bauteile: wo darf ihr Ursprung liegen?
    $room = ['levelId' => $level['id'], 'blocks' => []];
    foreach (['beam', 'wall', 'slab'] as $type) {
        $okTiles = [];
        for ($x = 0; $x < Levels::COLS; $x++) {
            for ($y = 0; $y < Levels::ROWS; $y++) {
                if (Game::canPlaceAt($room, $x, $y, $type)) {
                    $okTiles[] = $x . ',' . $y;
                }
            }
        }
        $bigOk[$level['id']][$type] = $okTiles;
    }
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Selbsttest – Ultimate Duck Mule</title>
<?= View::favicon() ?>
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

<script>
window.UDM_BLOCKED = <?= json_encode($blocked) ?>;
window.UDM_BIG_OK = <?= json_encode($bigOk) ?>;
window.UDM_GRAVES = <?= json_encode(['active' => $graveActive, 'probes' => $graveProbes]) ?>;
window.UDM_SERVER_CHECKS = <?= json_encode($serverChecks, JSON_UNESCAPED_UNICODE) ?>;
</script>
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

  (function testOil() {
    // Oelpfuetze ist nicht solide, macht den Boden darunter aber spiegelglatt.
    var blocks = [];
    for (var x = 8; x < 22; x++) { blocks.push(block('oil', x, 17)); }
    var level = makeLevel(FLAT, blocks);
    var p = makePlayer(9, 17);
    simulate(p, level, 1.2, keys({ right: true }), { keepGoing: true });
    var x0 = p.x;
    simulate(p, level, 1.5, NONE, { keepGoing: true });
    var slide = p.x - x0;

    var dry = makeLevel(FLAT);
    var q = makePlayer(9, 17);
    simulate(q, dry, 1.2, keys({ right: true }), { keepGoing: true });
    var qx = q.x;
    simulate(q, dry, 1.5, NONE, { keepGoing: true });

    check('Ölpfütze lässt die Figur weiterrutschen',
      slide > (q.x - qx) + 50 && p.alive,
      'Öl=' + slide.toFixed(0) + 'px, trocken=' + (q.x - qx).toFixed(0) + 'px');
  }());

  (function testOilNotSolid() {
    // Auf einer Pfuetze kann man nicht stehen - sie ist keine Plattform.
    var level = makeLevel(FLAT, [block('oil', 10, 14)]);
    var p = makePlayer(10, 12);
    simulate(p, level, 2, NONE, { keepGoing: true });
    check('Ölpfütze trägt nicht - man fällt hindurch',
      Math.abs(p.y - (18 * TILE - UDM.PHYS.playerH)) < 2,
      'y=' + p.y.toFixed(0));
  }());

  (function testWrecker() {
    var level = makeLevel(FLAT, [block('wrecker', 10, 14, 0, 2)]);
    var p = makePlayer(10, 17);
    simulate(p, level, 3, NONE);
    check('Pendel tötet und wird dem Besitzer zugeordnet',
      !p.alive && p.cause === 'pendel' && p.killerSlot === 2,
      'cause=' + p.cause + ', killerSlot=' + p.killerSlot);
  }());

  (function testWreckerSwings() {
    var level = makeLevel(FLAT, [block('wrecker', 10, 12, 0, 1)]);
    var w = level.wreckers[0];
    level.update(1 / 120, 0);
    var x0 = w.x;
    level.update(1 / 120, w.period / 4);
    check('Pendel schwingt an seiner Kette',
      level.wreckers.length === 1 && w.length >= TILE && Math.abs(w.x - x0) > 15,
      'Kette=' + w.length + 'px, Ausschlag=' + (w.x - x0).toFixed(0) + 'px');
  }());

  (function testNoClimbingHelpers() {
    // Kein Bauteil darf eine Aufstiegshilfe sein.
    var helpers = [];
    Object.keys(UDM.BLOCKS).forEach(function (id) {
      var spec = UDM.BLOCKS[id];
      if (spec.climb || spec.climbWall || spec.oneWay) { helpers.push(id); }
    });
    check('Kein Bauteil ist eine Kletterhilfe',
      helpers.length === 0,
      helpers.length ? helpers.join(', ') : Object.keys(UDM.BLOCKS).length + ' Bauteile geprüft');
  }());

  (function testOneWayTerrain() {
    // Einweg-Plattformen gibt es weiterhin als Gelaende, nur nicht als Bauteil.
    var def = {
      id: 'test-oneway', name: 'Test', theme: 'day',
      spawn: { x: 2, y: 17 }, goal: { x: 35, y: 17 },
      rects: [
        { x: 0, y: 18, w: 40, h: 5, t: 'ground' },
        { x: 9, y: 15, w: 4, h: 1, t: 'oneway' }
      ]
    };
    var level = makeLevel(def);
    var p = makePlayer(10, 17);
    simulate(p, level, 1.6, function (t) {
      return keys({ jump: t < 0.6, jumpPressed: t < 1 / 60 });
    }, { keepGoing: true });
    check('Einweg-Gelände ist von unten durchspringbar',
      Math.abs(p.y - (15 * TILE - UDM.PHYS.playerH)) < 2 && p.onGround,
      'y=' + p.y.toFixed(1) + ' erwartet ' + (15 * TILE - UDM.PHYS.playerH));
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

  /* ------------------------------------------- Grosse Bauteile & Assists */

  (function testMultiTileFootprint() {
    var level = makeLevel(FLAT, [block('beam', 10, 15)]);
    var covered = level.cell(10, 15) && level.cell(11, 15) && level.cell(12, 15);
    var beyond = level.cell(13, 15);
    var oneEntry = level.blocks.length === 1;
    check('Balken belegt drei Kacheln als ein Bauteil',
      !!covered && !beyond && oneEntry,
      'belegt=' + !!covered + ', daneben frei=' + !beyond + ', Bauteile=' + level.blocks.length);
  }());

  (function testMultiTileBlocksPlacement() {
    var level = makeLevel(FLAT, [block('wall', 10, 12)]);
    check('Mauer sperrt ihre ganze Grundfläche fürs Bauen',
      !level.canPlaceAt(10, 12, 'stone') &&
      !level.canPlaceAt(10, 13, 'stone') &&
      !level.canPlaceAt(10, 14, 'stone') &&
      level.canPlaceAt(11, 13, 'stone'),
      'Kachel 10/13 belegt=' + !level.canPlaceAt(10, 13, 'stone'));
  }());

  (function testMultiTileNeedsRoom() {
    var level = makeLevel(FLAT, [block('stone', 12, 15)]);
    check('Großes Bauteil passt nicht in eine zu kleine Lücke',
      !level.canPlaceAt(10, 15, 'beam') && level.canPlaceAt(13, 15, 'beam'),
      'in Lücke=' + level.canPlaceAt(10, 15, 'beam') + ', daneben=' + level.canPlaceAt(13, 15, 'beam'));
  }());

  (function testMultiTileRemoval() {
    var level = makeLevel(FLAT, [block('slab', 10, 14)]);
    level.removeBlockAt(11, 15);
    check('Großes Bauteil verschwindet komplett beim Entfernen',
      !level.cell(10, 14) && !level.cell(11, 14) && !level.cell(10, 15) && !level.cell(11, 15) &&
      level.blocks.length === 0,
      'Restkacheln=' + [level.cell(10,14), level.cell(11,14), level.cell(10,15), level.cell(11,15)].filter(Boolean).length);
  }());

  (function testMultiTileIsSolid() {
    var level = makeLevel(FLAT, [block('beam', 9, 16)]);
    var p = makePlayer(11, 13);
    simulate(p, level, 2, NONE, { keepGoing: true });
    check('Man landet auf jeder Kachel eines Balkens',
      Math.abs(p.y - (16 * TILE - UDM.PHYS.playerH)) < 2 && p.onGround,
      'y=' + p.y.toFixed(1) + ' erwartet ' + (16 * TILE - UDM.PHYS.playerH));
  }());

  (function testOilAssistCountsAsKill() {
    // Oel schiebt ueber die Kante: ohne fremde Falle zaehlt der Sturz dem
    // Besitzer der Pfuetze.
    var def = {
      id: 'test-ledge', name: 'Kante', theme: 'day',
      spawn: { x: 2, y: 17 }, goal: { x: 35, y: 17 },
      rects: [{ x: 0, y: 18, w: 12, h: 5, t: 'ground' }]
    };
    var blocks = [];
    for (var x = 8; x < 12; x++) { blocks.push(block('oil', x, 17, 0, 2)); }
    var level = makeLevel(def, blocks);
    var p = makePlayer(8, 17);
    p.vx = 240;
    simulate(p, level, 4, keys({ right: true }));
    check('Ölpfütze zählt als Kill, wenn man darüber abstürzt',
      !p.alive && p.cause === 'sturz' && p.killerSlot === 2,
      'cause=' + p.cause + ', killerSlot=' + p.killerSlot);
  }());

  (function testOilIntoForeignTrap() {
    // Oel von Spieler 2, Stacheln von Spieler 1 -> beide bekommen etwas.
    var level = makeLevel(FLAT, [
      block('oil', 10, 17, 0, 2), block('oil', 11, 17, 0, 2), block('oil', 12, 17, 0, 2),
      block('spike', 14, 17, 0, 1)
    ]);
    var p = makePlayer(10, 17);
    simulate(p, level, 4, keys({ right: true }));
    check('Durch Öl in eine fremde Falle: Falle tötet, Öl half nach',
      !p.alive && p.cause === 'stachel' && p.killerSlot === 1 && p.assistSlot === 2,
      'cause=' + p.cause + ', killer=' + p.killerSlot + ', assist=' + p.assistSlot);
  }());

  (function testFanAssist() {
    var def = {
      id: 'test-fan', name: 'Fan', theme: 'day',
      spawn: { x: 2, y: 17 }, goal: { x: 35, y: 17 },
      rects: [{ x: 0, y: 18, w: 40, h: 5, t: 'ground' }]
    };
    var level = makeLevel(def, [block('fan', 12, 17, 1, 2), block('spike', 16, 17, 0, 0)]);
    var p = makePlayer(13, 17);
    simulate(p, level, 4, NONE);
    check('Ventilator pustet in eine fremde Falle und hilft mit',
      !p.alive && p.killerSlot === 0 && p.assistSlot === 2,
      'cause=' + p.cause + ', killer=' + p.killerSlot + ', assist=' + p.assistSlot);
  }());

  (function testOwnOilOwnTrap() {
    // Eigenes Oel, eigene Stacheln: nur ein Eigentor, kein doppelter Eintrag.
    var level = makeLevel(FLAT, [
      block('oil', 10, 17, 0, 1), block('oil', 11, 17, 0, 1),
      block('spike', 13, 17, 0, 1)
    ]);
    var p = makePlayer(10, 17);
    simulate(p, level, 4, keys({ right: true }));
    check('Eigenes Öl plus eigene Falle zählt nur einmal',
      !p.alive && p.killerSlot === 1 && p.assistSlot === null,
      'killer=' + p.killerSlot + ', assist=' + p.assistSlot);
  }());

  (function testKillBlockIsReported() {
    var level = makeLevel(FLAT, [block('spike', 10, 17, 0, 2)]);
    var id = level.blocks[0].id;
    var p = makePlayer(10, 17);
    simulate(p, level, 1, NONE);
    var removed = level.removeBlocksById([p.killerBlock]);
    check('Tödliches Bauteil meldet seine Kennung und lässt sich räumen',
      p.killerBlock === id && removed === 1 && level.blocks.length === 0,
      'gemeldet=' + p.killerBlock + ', erwartet=' + id + ', entfernt=' + removed);
  }());

  (function testNoAssistWithoutDeath() {
    // Oel streifen und trotzdem ankommen: kein Schuldiger.
    var level = makeLevel(FLAT);
    var p = makePlayer(10, 17);
    p.noteAssist(2, 7);
    p.finish(level);
    var q = makePlayer(12, 17);
    q.noteAssist(2, 7);
    q.kill('aufgabe', null, level);
    var r = makePlayer(14, 17);
    r.noteAssist(2, 7);
    r.kill('sturz', null, level);
    check('Schubs zählt nur, wenn man daran stirbt – nicht im Ziel, nicht beim Aufgeben',
      p.assistSlot === null && p.killerSlot === null && q.killerSlot === null && q.assistSlot === null &&
      r.killerSlot === 2,
      'Ziel=' + p.assistSlot + ', Aufgabe=' + q.killerSlot + '/' + q.assistSlot + ', Sturz=' + r.killerSlot);
  }());

  (function testGiveUp() {
    var level = makeLevel(FLAT);
    var p = makePlayer(10, 17);
    simulate(p, level, 0.3, NONE, { keepGoing: true });
    p.kill('aufgabe', null, level);
    check('Aufgeben beendet die eigene Runde ohne Schuldigen',
      !p.alive && p.cause === 'aufgabe' && p.killerSlot === null && p.isDone(),
      'cause=' + p.cause + ', killer=' + p.killerSlot);
  }());

  /* ---------------------------------------------------------- Power-ups */

  function buffed(tx, ty, buffs) {
    var p = makePlayer(tx, ty);
    p.applyBuffs(buffs);
    return p;
  }

  (function testDoubleJump() {
    var jumpTwice = function (t) {
      return keys({ jump: t < 0.9, jumpPressed: t < 1 / 60 || (t >= 0.35 && t < 0.35 + 1 / 60) });
    };
    var level = makeLevel(FLAT);
    var plain = makePlayer(10, 17);
    var normal = plain.y - simulate(plain, level, 1.6, jumpTwice).minY;
    var p = buffed(10, 17, ['pu_djump']);
    var high = p.y - simulate(p, makeLevel(FLAT), 1.6, jumpTwice).minY;
    check('Doppelsprung: zweiter Sprung in der Luft trägt deutlich höher',
      high > normal + 2 * TILE && p.airJumps === p.airJumpsMax,
      'ohne ' + (normal / TILE).toFixed(1) + ' Kacheln, mit ' + (high / TILE).toFixed(1) + ' Kacheln');
  }());

  (function testShieldAbsorbsOneHit() {
    var level = makeLevel(FLAT, [block('spike', 10, 17, 0, 2)]);
    var p = buffed(10, 17, ['pu_shield']);
    var run = simulate(p, level, 4, NONE);
    var first = run.events[0] || {};
    check('Schutzschild fängt einen Treffer ab, der zweite zählt',
      first.type === 'shield' && !p.alive && p.cause === 'stachel' && p.killerSlot === 2 &&
      run.time > UDM.PHYS.shieldGrace,
      'Ereignisse=' + run.events.map(function (e) { return e.type; }).join(',') +
      ', tot nach ' + run.time.toFixed(2) + ' s');
  }());

  (function testShieldNoFallProtection() {
    var p = buffed(10, 10, ['pu_shield']);
    simulate(p, makeLevel(VOID), 3, NONE);
    check('Schutzschild hilft nicht gegen Abstürze',
      !p.alive && p.cause === 'sturz' && p.shield === 1, 'cause=' + p.cause + ', Schild=' + p.shield);
  }());

  (function testGlide() {
    var level = makeLevel(FLAT);
    var p = buffed(10, 2, ['pu_glide']);
    var y0 = p.y;
    simulate(p, level, 1, keys({ jump: true }), { keepGoing: true });
    var drop = p.y - y0;
    var q = makePlayer(10, 2);
    simulate(q, makeLevel(FLAT), 1, keys({ jump: true }), { keepGoing: true });
    check('Gleitschirm: Sprungtaste halten bremst den Fall',
      p.anim === 'glide' && p.vy <= UDM.PHYS.glideFall + 0.01 && drop < (q.y - y0) / 2,
      'mit Schirm ' + drop.toFixed(0) + ' px, ohne ' + (q.y - y0).toFixed(0) + ' px in 1 s');
  }());

  (function testTurbo() {
    var plain = makePlayer(3, 17);
    var x0 = plain.x;
    simulate(plain, makeLevel(FLAT), 0.8, keys({ right: true }), { keepGoing: true });
    var fast = buffed(3, 17, ['pu_speed']);
    simulate(fast, makeLevel(FLAT), 0.8, keys({ right: true }), { keepGoing: true });
    var a = plain.x - x0;
    var b = fast.x - x0;
    check('Turbo: deutlich schneller unterwegs', b > a * 1.2,
      'ohne ' + a.toFixed(0) + ' px, mit ' + b.toFixed(0) + ' px');
  }());

  (function testBuffsResetEachParty() {
    var p = buffed(10, 17, ['pu_djump', 'pu_shield']);
    p.reset(p.x, p.y);
    p.applyBuffs([]);
    check('Ohne Power-up keine Sonderfähigkeiten',
      p.airJumpsMax === 0 && p.shield === 0 && p.speedMul === 1 && !p.canGlide,
      'Luftsprünge=' + p.airJumpsMax + ', Schild=' + p.shield);
  }());

  (function testPowerupCatalogMatches() {
    var server = <?= json_encode(array_map(static fn (array $c): string => $c['kind'], Cards::POWERUPS)) ?>;
    var problems = [];
    Object.keys(server).forEach(function (id) {
      if (server[id] === 'buff' && !UDM.BUFF_BADGES[id]) { problems.push('kein Kurzzeichen: ' + id); }
    });
    Object.keys(UDM.BUFF_BADGES).forEach(function (id) {
      if (server[id] !== 'buff') { problems.push('nur im Client: ' + id); }
    });
    check('Power-up-Katalog stimmt zwischen PHP und JavaScript',
      problems.length === 0, problems.join(' | ') || Object.keys(server).join(', '));
  }());

  /* ---------------------------------------------------- Sichere Startzone */
  // FLAT: Start bei 2/17 -> Zone Kacheln 1..4 x 15..17

  (function testSafeZoneVsPendulum() {
    var level = makeLevel(FLAT, [block('wrecker', 3, 13, 0, 1)]);
    var p = new UDM.Player(0, { name: 'T', char: 'duck' });
    var spawn = level.spawnPoint(1);
    p.reset(spawn.x, spawn.y);
    var run = simulate(p, level, 4, NONE, { keepGoing: true });
    var swungThrough = level.wreckers[0].length >= 3 * TILE;
    check('Pendel schwingt durch die Startzone, trifft dort aber niemanden',
      p.alive && swungThrough,
      'am Leben=' + p.alive + ', Kette=' + level.wreckers[0].length + 'px');
  }());

  (function testSafeZoneStopsArrows() {
    var level = makeLevel(FLAT, [block('arrow', 9, 17, 3, 1)]);
    var p = new UDM.Player(0, { name: 'T', char: 'duck' });
    var spawn = level.spawnPoint(0);
    p.reset(spawn.x, spawn.y);
    var deepest = 999;
    for (var i = 0; i < 120 * 4; i++) {
      level.update(1 / 120, i / 120);
      p.update(1 / 120, NONE, level);
      p.checkFate(level);
      level.projectiles.forEach(function (arrow) { deepest = Math.min(deepest, arrow.x); });
    }
    check('Pfeile zerfallen am Rand der Startzone',
      p.alive && deepest >= 5 * TILE - 20,
      'am Leben=' + p.alive + ', weitester Pfeil bei x=' + Math.round(deepest) + ' (Zone endet bei ' + (5 * TILE) + ')');
  }());

  (function testSafeZoneStopsSaw() {
    var level = makeLevel(FLAT, [block('saw', 6, 16, 1, 1)]);
    var saw = level.saws[0];
    var leftmost = saw.mid - saw.amp;
    check('Sägeschiene endet vor der Startzone',
      leftmost >= 5 * TILE,
      'linkes Ende bei x=' + leftmost + ' (Zone endet bei ' + (5 * TILE) + ')');
  }());

  (function testSafeZoneStopsFan() {
    var level = makeLevel(FLAT, [block('fan', 6, 17, 3, 1)]);
    var intoZone = level.streams.filter(function (st) { return level.isSafeTile(st.x / TILE, st.y / TILE); });
    check('Luftstrom bläst nicht in die Startzone',
      intoZone.length === 0 && level.streams.length === 1,
      'Stromkacheln=' + level.streams.length + ', davon in der Zone=' + intoZone.length);
  }());

  (function testOutsideZoneStillDeadly() {
    var level = makeLevel(FLAT, [block('arrow', 12, 17, 3, 1)]);
    var p = makePlayer(8, 17);
    simulate(p, level, 4, NONE);
    check('Außerhalb der Startzone treffen Pfeile weiterhin',
      !p.alive && p.cause === 'pfeil', 'cause=' + p.cause);
  }());

  /* --------------------------------------------------- Spielfeldgrenzen */

  (function testLeftBoundary() {
    var level = makeLevel(FLAT);
    var p = makePlayer(1, 17);
    simulate(p, level, 3, keys({ left: true }), { keepGoing: true });
    check('Linke Bande stoppt die Figur am Spielfeldrand',
      p.alive && p.x >= 0 && p.x < 4,
      'x=' + p.x.toFixed(1) + ' (muss zwischen 0 und 4 liegen)');
  }());

  (function testRightBoundary() {
    var level = makeLevel(FLAT);
    var p = makePlayer(38, 17);
    simulate(p, level, 3, keys({ right: true }), { keepGoing: true });
    var maxX = UDM.COLS * TILE - UDM.PHYS.playerW;
    check('Rechte Bande stoppt die Figur am Spielfeldrand',
      p.alive && p.x <= maxX + 0.5 && p.x > maxX - 4,
      'x=' + p.x.toFixed(1) + ' (Rand bei ' + maxX + ')');
  }());

  (function testRemoveBlock() {
    var level = makeLevel(FLAT, [block('saw', 10, 17, 1, 1), block('stone', 12, 17)]);
    var sawsBefore = level.saws.length;
    var removed = level.removeBlockAt(10, 17);
    var missed = level.removeBlockAt(5, 5);
    var terrain = level.removeBlockAt(10, 18);
    check('Bauteile lassen sich wieder entfernen',
      removed && !missed && !terrain &&
      level.blocks.length === 1 && sawsBefore === 1 && level.saws.length === 0,
      'entfernt=' + removed + ', leere Kachel=' + missed + ', Gelände=' + terrain +
      ', Sägen danach=' + level.saws.length);
  }());

  (function testRemovedBlockIsHarmless() {
    var level = makeLevel(FLAT, [block('spike', 10, 17, 0, 2)]);
    var victim = makePlayer(10, 17);
    simulate(victim, level, 0.5, NONE);
    var died = !victim.alive;

    level.removeBlockAt(10, 17);
    var survivor = makePlayer(10, 17);
    simulate(survivor, level, 1, NONE, { keepGoing: true });
    check('Nach dem Entfernen ist die Falle wirkungslos',
      died && survivor.alive,
      'vorher gestorben=' + died + ', danach am Leben=' + survivor.alive);
  }());

  /* ------------------------------------ Level ohne Bauteile schaffbar */

  /**
   * Alle Kacheln, auf denen die Figur stehen kann: fester Boden darunter,
   * zwei Kacheln Kopffreiheit darueber.
   */
  function standingTiles(level) {
    var nodes = {};
    for (var tx = 0; tx < level.cols; tx++) {
      for (var ty = 1; ty < level.rows; ty++) {
        var support = level.isSolid(tx, ty + 1) || level.isOneWay(tx, ty + 1);
        if (!support) { continue; }
        if (level.isSolid(tx, ty) || level.isSolid(tx, ty - 1)) { continue; }
        nodes[tx + ',' + ty] = { tx: tx, ty: ty };
      }
    }
    return nodes;
  }

  /**
   * Kommt man von a nach b? Bewusst knapper angesetzt als die Figur wirklich
   * kann (3,3 Kacheln hoch, 5,2 weit), damit der Weg auch mit Gegenwind haelt.
   */
  function reachable(a, b) {
    var dx = Math.abs(b.tx - a.tx);
    var up = a.ty - b.ty;
    if (up > 0) { return up <= 3 && dx <= 4 && dx > 0; }
    if (up === 0) { return dx >= 1 && dx <= 4; }
    return dx <= 5;
  }

  /** Breitensuche vom Start zum Ziel ueber die Standflaechen. */
  function findPath(level) {
    var nodes = standingTiles(level);
    var startKey = level.def.spawn.x + ',' + level.def.spawn.y;
    var goalKey = level.def.goal.x + ',' + level.def.goal.y;
    if (!nodes[startKey] || !nodes[goalKey]) {
      return { error: (!nodes[startKey] ? 'Startkachel' : 'Zielkachel') + ' ist keine Standfläche' };
    }

    var list = Object.keys(nodes).map(function (key) { return nodes[key]; });
    var queue = [nodes[startKey]];
    var from = {};
    from[startKey] = null;

    while (queue.length) {
      var current = queue.shift();
      var currentKey = current.tx + ',' + current.ty;
      if (currentKey === goalKey) {
        var path = [];
        var key = goalKey;
        while (key) {
          var parts = key.split(',');
          path.unshift({ tx: parseInt(parts[0], 10), ty: parseInt(parts[1], 10) });
          key = from[key];
        }
        return { path: path };
      }
      for (var i = 0; i < list.length; i++) {
        var next = list[i];
        var nextKey = next.tx + ',' + next.ty;
        if (from.hasOwnProperty(nextKey) || !reachable(current, next)) { continue; }
        from[nextKey] = currentKey;
        queue.push(next);
      }
    }
    return { error: 'kein Weg vom Start zum Ziel gefunden' };
  }

  /**
   * Laesst eine echte Figur den gefundenen Weg mit der echten Physik
   * ablaufen: nach rechts/links zum naechsten Wegpunkt, springen, wenn er
   * hoeher liegt oder eine Luecke dazwischen ist.
   */
  function runPath(level, path, seconds) {
    var p = new UDM.Player(0, { name: 'Bot', char: 'duck' });
    var spawn = level.spawnPoint(0);
    p.reset(spawn.x, spawn.y);

    var dt = 1 / 120;
    var steps = Math.round(seconds / dt);
    var index = 0;
    var jumpTimer = 0;
    var jumpStart = false;
    var stuck = 0;
    var lastProgress = 0;
    var t = 0;

    for (var i = 0; i < steps; i++) {
      var feetRow = Math.floor((p.y + p.h) / TILE);
      var centerTile = Math.floor(p.centerX() / TILE);

      // Wegpunkt abhaken, sobald wir dort stehen.
      while (index < path.length - 1) {
        var here = path[index];
        var atTile = Math.abs(p.centerX() - (here.tx * TILE + TILE / 2)) < 14;
        if (p.onGround && atTile && feetRow === here.ty + 1) {
          index++;
          lastProgress = t;
        } else {
          break;
        }
      }

      var wp = path[index];
      var targetX = wp.tx * TILE + TILE / 2;
      var delta = targetX - p.centerX();
      var dir = delta > 6 ? 1 : (delta < -6 ? -1 : 0);

      if (p.onGround && jumpTimer <= 0) {
        var ahead = dir !== 0 ? centerTile + dir : centerTile;
        // An der Plattformkante: gleich springen, der Anlauf ist da.
        var gapAhead = dir !== 0 &&
          !level.isSolid(ahead, feetRow) && !level.isOneWay(ahead, feetRow);
        // Wand direkt voraus.
        var wallAhead = dir !== 0 &&
          (level.isSolid(ahead, feetRow - 1) || level.isSolid(ahead, feetRow - 2));
        // Hoeher gelegenes Ziel erst aus der Naehe anspringen - wer schon in
        // der Plattformmitte abhebt, landet in der Luecke davor.
        var higher = wp.ty < feetRow - 1 && Math.abs(delta) <= TILE * 3.5;
        if (gapAhead || wallAhead || higher) {
          jumpTimer = 0.3;
          jumpStart = true;
        }
      }

      var input = {
        left: dir < 0,
        right: dir > 0,
        jump: jumpTimer > 0,
        down: false,
        jumpPressed: jumpStart
      };
      jumpStart = false;
      if (jumpTimer > 0) { jumpTimer -= dt; }

      level.update(dt, t);
      p.update(dt, input, level);
      p.checkFate(level);
      t += dt;

      if (p.finished) { return { ok: true, time: t, player: p }; }
      if (!p.alive) { return { ok: false, time: t, player: p, reason: 'gestorben (' + p.cause + ')' }; }

      if (t - lastProgress > 6) {
        stuck = 1;
        break;
      }
    }

    return {
      ok: false,
      time: t,
      player: p,
      reason: stuck ? 'steckt bei Wegpunkt ' + index + '/' + path.length + ' fest'
        : 'Zeit abgelaufen bei Wegpunkt ' + index + '/' + path.length
    };
  }

  (function testLevelsWithoutBlocks() {
    var levels = <?= json_encode(Levels::all()) ?>;
    levels.forEach(function (def) {
      var level = makeLevel(def);
      var found = findPath(level);
      if (found.error) {
        check('„' + def.name + '" ist ohne Bauteile schaffbar', false, found.error);
        return;
      }
      var run = runPath(level, found.path, 45);
      check('„' + def.name + '" ist ohne Bauteile schaffbar',
        run.ok,
        run.ok
          ? 'Ziel nach ' + run.time.toFixed(1) + 's über ' + found.path.length + ' Wegpunkte'
          : run.reason + ' (x=' + run.player.x.toFixed(0) + ', y=' + run.player.y.toFixed(0) + ')');
    });
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
      mismatches.length ? mismatches.slice(0, 6).join(' | ')
        : 'alle ' + levels.length + ' Level, ' + (levels.length * UDM.COLS * UDM.ROWS) + ' Kacheln geprüft');
  }());

  (function testBigBlockRulesMatch() {
    var levels = <?= json_encode(Levels::all()) ?>;
    var expected = window.UDM_BIG_OK;
    var mismatches = [];
    var checked = 0;

    levels.forEach(function (def) {
      var level = new UDM.Level(def);
      Object.keys(expected[def.id]).forEach(function (type) {
        var serverSet = {};
        expected[def.id][type].forEach(function (key) { serverSet[key] = true; });
        for (var x = 0; x < UDM.COLS; x++) {
          for (var y = 0; y < UDM.ROWS; y++) {
            checked++;
            if (level.canPlaceAt(x, y, type) !== !!serverSet[x + ',' + y]) {
              mismatches.push(def.id + '/' + type + ' ' + x + ',' + y);
            }
          }
        }
      });
    });

    check('Auch für große Bauteile sind Client und Server einig',
      mismatches.length === 0,
      mismatches.length ? mismatches.slice(0, 5).join(' | ') : checked + ' Kacheln geprüft');
  }());

  (function testGravesMatchServer() {
    var data = window.UDM_GRAVES;
    var level = makeLevel(FLAT);
    level.graves = data.active;
    var wrong = data.probes.filter(function (probe) {
      return level.blockedByGrave(probe.x, probe.y, probe.type) !== probe.blocked;
    }).map(function (probe) { return probe.type + '@' + probe.x + '/' + probe.y; });
    check('Grabsteine: Client und Server sperren dieselben Felder',
      wrong.length === 0 && data.active.length === 2,
      wrong.length ? 'abweichend: ' + wrong.join(', ') : data.probes.length + ' Proben, ' +
        data.active.length + ' aktive Grabsteine (abgelaufener ignoriert)');
  }());

  (function testGraveOnlySameType() {
    var level = makeLevel(FLAT);
    level.graves = [{ type: 'spike', x: 10, y: 14 }];
    check('Gelöschtes Feld sperrt nur denselben Typ',
      !level.canPlaceAt(10, 14, 'spike') && level.canPlaceAt(10, 14, 'saw') && level.canPlaceAt(11, 14, 'spike'),
      'Stacheln=' + level.canPlaceAt(10, 14, 'spike') + ', Säge=' + level.canPlaceAt(10, 14, 'saw') +
      ', daneben=' + level.canPlaceAt(11, 14, 'spike'));
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
      for (var i = 0; i < 4; i++) {
        var spawn = level.spawnPoint(i);
        var p = new UDM.Player(i, { name: 'T', char: 'duck' });
        p.reset(spawn.x, spawn.y);
        simulate(p, level, 1.5, NONE, { keepGoing: true });
        if (!p.alive) { problems.push(def.name + ': Spieler ' + (i + 1) + ' stirbt am Start'); }
        if (!p.onGround) { problems.push(def.name + ': Spieler ' + (i + 1) + ' steht nicht auf Boden'); }
      }
    });
    check('Alle vier Startplätze sind in jedem Level sicher',
      problems.length === 0, problems.join(' | ') || levels.length + ' Level x 4 Startplätze');
  }());

  /* ------------------------------------------------ Serverregeln (PHP) */
  (window.UDM_SERVER_CHECKS || []).forEach(function (c) {
    check('Server: ' + c.name, c.ok, c.detail);
  });

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
