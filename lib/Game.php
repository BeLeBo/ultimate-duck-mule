<?php
declare(strict_types=1);

require_once __DIR__ . '/Cards.php';
require_once __DIR__ . '/Levels.php';
require_once __DIR__ . '/Rooms.php';

/**
 * Die Spielregeln fuer den Online-Modus.
 *
 * Der Server ist die Wahrheit fuer alles Diskrete: Phasen, Reihenfolge,
 * gesetzte Bauteile und Punkte. Die Physik der Partyphase laeuft im Browser;
 * jeder Client meldet nur das Ergebnis seiner eigenen Figur zurueck.
 */
final class Game
{
    public const MAX_PLAYERS = 3;
    public const MIN_PLAYERS = 2;
    public const HAND_SIZE = 4;
    public const MAX_BLOCKS = 320;
    public const DEFAULT_TARGET = 10;

    /** Nach dieser Zeit wird eine haengende Partyphase notfalls beendet (Sek.). */
    public const PARTY_HARD_LIMIT = 100;

    /** Nach dieser Zeit geht es aus der Punkteansicht automatisch weiter (Sek.). */
    public const SCORE_AUTO_NEXT = 20;

    /** Nach dieser Zeit wird ein untaetiger Baumeister uebersprungen (Sek.). */
    public const BUILD_TIMEOUT = 120;

    /**
     * So viele Runden ohne einen einzigen Zieleinlauf, dann wird das Level
     * geraeumt. Bauteile sind reine Hindernisse und bleiben liegen - ohne
     * dieses Ventil koennte ein Match in einem zugebauten Level feststecken.
     */
    public const DEAD_ROUND_LIMIT = 3;

    /** @var list<string> */
    public const CHARACTERS = ['duck', 'mule', 'racoon'];

    /** @return array<string, mixed> */
    public static function newRoom(string $code, int $targetScore, ?string $levelId): array
    {
        return [
            'code' => $code,
            'created' => time(),
            'updated' => time(),
            'version' => 1,
            'phase' => 'lobby',
            'round' => 0,
            'levelId' => $levelId !== null && Levels::byId($levelId) !== null ? $levelId : Levels::randomId(),
            'targetScore' => max(3, min(30, $targetScore)),
            'hostToken' => null,
            'order' => [],
            'turn' => 0,
            'firstBuilder' => 0,
            'nextBlockId' => 1,
            'blocks' => [],
            'deadRounds' => 0,
            'players' => [],
            'phaseStarted' => time(),
            'lastRound' => null,
            'winner' => null,
            'log' => [],
        ];
    }

    /**
     * @param array<string, mixed> $room
     * @return string Token des neuen Spielers
     */
    public static function addPlayer(array &$room, string $name, string $char): string
    {
        if ($room['phase'] !== 'lobby') {
            throw new RuntimeException('Das Spiel laeuft schon.');
        }
        if (count($room['order']) >= self::MAX_PLAYERS) {
            throw new RuntimeException('Der Raum ist voll (max. ' . self::MAX_PLAYERS . ' Spieler).');
        }

        $token = Rooms::newToken();
        $slot = count($room['order']);

        $room['players'][$token] = [
            'slot' => $slot,
            'name' => self::cleanName($name, $slot),
            'char' => self::cleanChar($char, $slot),
            'score' => 0,
            'hand' => [],
            'placed' => false,
            'ready' => false,
            'result' => null,
            'pos' => null,
            'lastSeen' => time(),
        ];
        $room['order'][] = $token;

        if ($room['hostToken'] === null) {
            $room['hostToken'] = $token;
        }

        self::log($room, self::nameOf($room, $token) . ' ist dem Raum beigetreten.');

        return $token;
    }

    /** @param array<string, mixed> $room */
    public static function startMatch(array &$room, string $token): void
    {
        if ($room['hostToken'] !== $token) {
            throw new RuntimeException('Nur der Gastgeber kann starten.');
        }
        if ($room['phase'] !== 'lobby') {
            throw new RuntimeException('Das Spiel laeuft schon.');
        }
        self::resetMatch($room);
    }

    /** Revanche nach dem Matchende - nur der Gastgeber, nur aus 'over'. */
    public static function restartMatch(array &$room, string $token): void
    {
        if ($room['hostToken'] !== $token) {
            throw new RuntimeException('Nur der Gastgeber kann ein neues Match starten.');
        }
        if ($room['phase'] !== 'over') {
            throw new RuntimeException('Das Match laeuft noch.');
        }
        self::log($room, 'Neues Match!');
        self::resetMatch($room);
    }

    /**
     * Setzt Punkte, Bauteile und Runden zurueck und startet die erste Runde.
     *
     * @param array<string, mixed> $room
     */
    private static function resetMatch(array &$room): void
    {
        if (count(self::connectedTokens($room)) < self::MIN_PLAYERS) {
            throw new RuntimeException('Es braucht mindestens ' . self::MIN_PLAYERS . ' Spieler.');
        }

        foreach ($room['players'] as &$player) {
            $player['score'] = 0;
        }
        unset($player);

        $room['blocks'] = [];
        $room['nextBlockId'] = 1;
        $room['round'] = 0;
        $room['deadRounds'] = 0;
        $room['winner'] = null;
        $room['lastRound'] = null;
        self::beginRound($room);
    }

    /** @param array<string, mixed> $room */
    public static function beginRound(array &$room): void
    {
        $room['round']++;
        $active = self::connectedTokens($room);
        $count = max(1, count($room['order']));
        $room['firstBuilder'] = ($room['round'] - 1) % $count;

        foreach ($room['players'] as $token => &$player) {
            $player['hand'] = Cards::deal(self::HAND_SIZE);
            $player['placed'] = !in_array($token, $active, true);
            $player['ready'] = false;
            $player['result'] = null;
            $player['pos'] = null;
        }
        unset($player);

        $room['phase'] = 'build';
        $room['turn'] = $room['firstBuilder'];
        $room['phaseStarted'] = time();
        self::skipUnavailableBuilders($room);
        self::touch($room);
    }

    /**
     * Setzt ein Bauteil aus der Hand des aktiven Spielers.
     *
     * @param array<string, mixed> $room
     */
    public static function place(array &$room, string $token, int $cardIndex, int $x, int $y, int $rot): void
    {
        if ($room['phase'] !== 'build') {
            throw new RuntimeException('Gerade ist keine Bauphase.');
        }
        if (self::currentBuilder($room) !== $token) {
            throw new RuntimeException('Du bist nicht am Zug.');
        }

        $player = &$room['players'][$token];
        $hand = $player['hand'];
        if (!isset($hand[$cardIndex])) {
            throw new RuntimeException('Diese Karte hast du nicht.');
        }
        $type = $hand[$cardIndex];
        if (!Cards::exists($type)) {
            throw new RuntimeException('Unbekanntes Bauteil.');
        }
        if (count($room['blocks']) >= self::MAX_BLOCKS) {
            throw new RuntimeException('Das Level ist voll.');
        }
        if (!self::canPlaceAt($room, $x, $y)) {
            throw new RuntimeException('Hier ist kein Platz.');
        }

        $room['blocks'][] = [
            'id' => $room['nextBlockId']++,
            'type' => $type,
            'x' => $x,
            'y' => $y,
            'rot' => Cards::isRotatable($type) ? (($rot % 4) + 4) % 4 : 0,
            'ownerSlot' => $player['slot'],
        ];
        $player['placed'] = true;
        $player['hand'] = [];
        unset($player);

        self::log($room, self::nameOf($room, $token) . ' setzt ' . Cards::CATALOG[$type]['name'] . '.');
        self::advanceBuild($room);
        self::touch($room);
    }

    /** @param array<string, mixed> $room */
    public static function skipBuild(array &$room, string $token): void
    {
        if ($room['phase'] !== 'build' || self::currentBuilder($room) !== $token) {
            return;
        }
        $room['players'][$token]['placed'] = true;
        $room['players'][$token]['hand'] = [];
        self::log($room, self::nameOf($room, $token) . ' setzt nichts.');
        self::advanceBuild($room);
        self::touch($room);
    }

    /** @param array<string, mixed> $room */
    private static function advanceBuild(array &$room): void
    {
        $order = $room['order'];
        $count = count($order);
        for ($step = 1; $step <= $count; $step++) {
            $idx = ($room['turn'] + $step) % $count;
            $candidate = $order[$idx];
            $player = $room['players'][$candidate] ?? null;
            if ($player !== null && !$player['placed'] && self::isConnected($player)) {
                $room['turn'] = $idx;
                $room['phaseStarted'] = time();

                return;
            }
        }

        self::beginParty($room);
    }

    /** @param array<string, mixed> $room */
    private static function skipUnavailableBuilders(array &$room): void
    {
        $order = $room['order'];
        $count = count($order);
        for ($step = 0; $step < $count; $step++) {
            $idx = ($room['firstBuilder'] + $step) % $count;
            $player = $room['players'][$order[$idx]] ?? null;
            if ($player !== null && !$player['placed'] && self::isConnected($player)) {
                $room['turn'] = $idx;

                return;
            }
        }

        self::beginParty($room);
    }

    /** @param array<string, mixed> $room */
    public static function beginParty(array &$room): void
    {
        $room['phase'] = 'party';
        $room['phaseStarted'] = time();
        foreach ($room['players'] as &$player) {
            $player['result'] = null;
            $player['ready'] = false;
            $player['pos'] = null;
        }
        unset($player);
    }

    /**
     * Ergebnismeldung eines Clients fuer die eigene Figur.
     *
     * @param array<string, mixed> $room
     * @param array<string, mixed> $result
     */
    public static function reportResult(array &$room, string $token, array $result): void
    {
        if ($room['phase'] !== 'party' || !isset($room['players'][$token])) {
            return;
        }
        if ($room['players'][$token]['result'] !== null) {
            return;
        }

        $killer = $result['killerSlot'] ?? null;
        $killerSlot = is_numeric($killer) ? (int) $killer : null;
        if ($killerSlot !== null && ($killerSlot < 0 || $killerSlot >= self::MAX_PLAYERS)) {
            $killerSlot = null;
        }

        $room['players'][$token]['result'] = [
            'finished' => (bool) ($result['finished'] ?? false),
            'time' => round(max(0.0, min(999.0, (float) ($result['time'] ?? 0))), 2),
            'killerSlot' => $killerSlot,
            'cause' => self::cleanCause((string) ($result['cause'] ?? '')),
        ];

        self::maybeFinishRound($room);
        self::touch($room);
    }

    /** @param array<string, mixed> $room */
    public static function maybeFinishRound(array &$room): void
    {
        if ($room['phase'] !== 'party') {
            return;
        }

        $pending = 0;
        foreach (self::connectedTokens($room) as $token) {
            if ($room['players'][$token]['result'] === null) {
                $pending++;
            }
        }

        if ($pending === 0) {
            self::finishRound($room);
        }
    }

    /**
     * Wertet die Runde aus.
     *
     * Punktetabelle:
     *   +1  Ziel erreicht
     *   +2  Bonus, wenn nur eine Figur das Ziel erreicht hat
     *   +1  je Gegner, der an einem eigenen Bauteil gestorben ist
     *   -1  am eigenen Bauteil gestorben
     * Punkte werden nie unter 0 gedrueckt.
     *
     * @param array<string, mixed> $room
     */
    public static function finishRound(array &$room): void
    {
        $participants = self::connectedTokens($room);
        $finishers = [];
        foreach ($participants as $token) {
            $result = $room['players'][$token]['result'];
            if ($result !== null && $result['finished']) {
                $finishers[] = $token;
            }
        }

        $entries = [];
        foreach ($participants as $token) {
            $player = &$room['players'][$token];
            $result = $player['result'] ?? null;
            $delta = 0;
            $reasons = [];

            if ($result !== null && $result['finished']) {
                $delta += 1;
                $reasons[] = ['text' => 'Ziel erreicht', 'points' => 1];
                if (count($finishers) === 1 && count($participants) > 1) {
                    $delta += 2;
                    $reasons[] = ['text' => 'Einziger im Ziel', 'points' => 2];
                }
            }

            $victims = 0;
            foreach ($participants as $other) {
                if ($other === $token) {
                    continue;
                }
                $otherResult = $room['players'][$other]['result'] ?? null;
                if ($otherResult !== null && $otherResult['killerSlot'] === $player['slot']) {
                    $victims++;
                }
            }
            if ($victims > 0) {
                $delta += $victims;
                $reasons[] = ['text' => $victims > 1 ? "Fallensteller (x$victims)" : 'Fallensteller', 'points' => $victims];
            }

            if ($result !== null && $result['killerSlot'] === $player['slot']) {
                $delta -= 1;
                $reasons[] = ['text' => 'Eigengoal', 'points' => -1];
            }

            $before = (int) $player['score'];
            $after = max(0, $before + $delta);
            $player['score'] = $after;

            $entries[] = [
                'slot' => $player['slot'],
                'name' => $player['name'],
                'char' => $player['char'],
                'delta' => $after - $before,
                'total' => $after,
                'finished' => $result !== null && $result['finished'],
                'time' => $result['time'] ?? null,
                'cause' => $result['cause'] ?? '',
                'reasons' => $reasons,
            ];
            unset($player);
        }

        // Kommt drei Runden lang niemand an, ist das Level zugebaut.
        $cleared = false;
        if (count($finishers) === 0) {
            $room['deadRounds'] = (int) ($room['deadRounds'] ?? 0) + 1;
            if ($room['deadRounds'] >= self::DEAD_ROUND_LIMIT) {
                $room['blocks'] = [];
                $room['deadRounds'] = 0;
                $cleared = true;
                self::log($room, 'Drei Runden ohne Zieleinlauf - das Level wird geraeumt.');
            }
        } else {
            $room['deadRounds'] = 0;
        }

        $room['lastRound'] = [
            'round' => $room['round'],
            'entries' => $entries,
            'anyFinisher' => count($finishers) > 0,
            'cleared' => $cleared,
        ];

        $room['phase'] = 'score';
        $room['phaseStarted'] = time();

        $winner = self::findWinner($room);
        if ($winner !== null) {
            $room['phase'] = 'over';
            $room['winner'] = $winner;
            self::log($room, $winner['name'] . ' gewinnt das Match!');
        }
    }

    /**
     * @param array<string, mixed> $room
     * @return array<string, mixed>|null
     */
    private static function findWinner(array $room): ?array
    {
        $best = -1;
        $bestTokens = [];
        foreach (self::connectedTokens($room) as $token) {
            $score = (int) $room['players'][$token]['score'];
            if ($score > $best) {
                $best = $score;
                $bestTokens = [$token];
            } elseif ($score === $best) {
                $bestTokens[] = $token;
            }
        }

        if ($best >= (int) $room['targetScore'] && count($bestTokens) === 1) {
            $token = $bestTokens[0];

            return [
                'slot' => $room['players'][$token]['slot'],
                'name' => $room['players'][$token]['name'],
                'char' => $room['players'][$token]['char'],
                'score' => (int) $room['players'][$token]['score'],
            ];
        }

        return null;
    }

    /** @param array<string, mixed> $room */
    public static function ready(array &$room, string $token): void
    {
        if (!isset($room['players'][$token])) {
            return;
        }
        if ($room['phase'] === 'score') {
            $room['players'][$token]['ready'] = true;
            $allReady = true;
            foreach (self::connectedTokens($room) as $other) {
                if (!$room['players'][$other]['ready']) {
                    $allReady = false;
                    break;
                }
            }
            if ($allReady) {
                self::beginRound($room);
            }
            self::touch($room);
        } elseif ($room['phase'] === 'over' && $room['hostToken'] === $token) {
            self::restartMatch($room, $token);
            self::touch($room);
        }
    }

    /**
     * Wird bei jedem Request aufgerufen und haelt den Raum am Leben:
     * Timeouts, uebersprungene Zuege, automatischer Rundenwechsel.
     *
     * @param array<string, mixed> $room
     */
    public static function tick(array &$room): bool
    {
        $before = $room['version'];
        $now = time();

        if ($room['phase'] === 'build') {
            $builder = self::currentBuilder($room);
            $builderPlayer = $builder !== null ? $room['players'][$builder] : null;
            $timedOut = $now - (int) $room['phaseStarted'] > self::BUILD_TIMEOUT;
            if ($builderPlayer === null || !self::isConnected($builderPlayer) || $timedOut) {
                if ($builder !== null) {
                    $room['players'][$builder]['placed'] = true;
                    $room['players'][$builder]['hand'] = [];
                }
                self::advanceBuild($room);
                self::touch($room);
            }
        } elseif ($room['phase'] === 'party') {
            foreach ($room['order'] as $token) {
                $player = $room['players'][$token] ?? null;
                if ($player === null || $player['result'] !== null) {
                    continue;
                }
                if (!self::isConnected($player)) {
                    $room['players'][$token]['result'] = [
                        'finished' => false,
                        'time' => 0.0,
                        'killerSlot' => null,
                        'cause' => 'verbindung',
                    ];
                    self::touch($room);
                }
            }
            if ($now - (int) $room['phaseStarted'] > self::PARTY_HARD_LIMIT) {
                foreach ($room['order'] as $token) {
                    if (($room['players'][$token]['result'] ?? null) === null) {
                        $room['players'][$token]['result'] = [
                            'finished' => false,
                            'time' => 0.0,
                            'killerSlot' => null,
                            'cause' => 'zeit',
                        ];
                    }
                }
                self::finishRound($room);
                self::touch($room);
            } else {
                self::maybeFinishRound($room);
            }
        } elseif ($room['phase'] === 'score') {
            if ($now - (int) $room['phaseStarted'] > self::SCORE_AUTO_NEXT) {
                self::beginRound($room);
                self::touch($room);
            }
        }

        // Gastgeberrolle weitergeben, wenn der Gastgeber weg ist.
        $host = $room['hostToken'];
        if ($host === null || !isset($room['players'][$host]) || !self::isConnected($room['players'][$host])) {
            foreach (self::connectedTokens($room) as $token) {
                if ($token !== $host) {
                    $room['hostToken'] = $token;
                    self::touch($room);
                    break;
                }
            }
        }

        return $room['version'] !== $before;
    }

    /** @param array<string, mixed> $room */
    public static function canPlaceAt(array $room, int $x, int $y): bool
    {
        if (!Levels::inBounds($x, $y)) {
            return false;
        }
        $blocked = Levels::blockedTiles((string) $room['levelId']);
        if (isset($blocked[$x . ',' . $y])) {
            return false;
        }
        foreach ($room['blocks'] as $block) {
            if ((int) $block['x'] === $x && (int) $block['y'] === $y) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $room */
    public static function currentBuilder(array $room): ?string
    {
        $order = $room['order'];
        if ($order === []) {
            return null;
        }
        $idx = (int) $room['turn'] % count($order);

        return $order[$idx] ?? null;
    }

    /**
     * @param array<string, mixed> $room
     * @return list<string>
     */
    public static function connectedTokens(array $room): array
    {
        $tokens = [];
        foreach ($room['order'] as $token) {
            $player = $room['players'][$token] ?? null;
            if ($player !== null && self::isConnected($player)) {
                $tokens[] = $token;
            }
        }

        return $tokens;
    }

    /** @param array<string, mixed> $player */
    public static function isConnected(array $player): bool
    {
        return time() - (int) $player['lastSeen'] <= Rooms::PLAYER_TIMEOUT;
    }

    /**
     * Baut die Sicht, die ein Client bekommt. Tokens anderer Spieler und
     * fremde Handkarten bleiben verborgen.
     *
     * @param array<string, mixed> $room
     * @return array<string, mixed>
     */
    public static function publicState(array $room, ?string $viewer): array
    {
        $players = [];
        foreach ($room['order'] as $token) {
            $player = $room['players'][$token] ?? null;
            if ($player === null) {
                continue;
            }
            $isYou = $viewer !== null && $token === $viewer;
            $players[] = [
                'slot' => (int) $player['slot'],
                'name' => $player['name'],
                'char' => $player['char'],
                'score' => (int) $player['score'],
                'connected' => self::isConnected($player),
                'placed' => (bool) $player['placed'],
                'ready' => (bool) $player['ready'],
                'you' => $isYou,
                'host' => $token === $room['hostToken'],
                'handSize' => count($player['hand']),
                'hand' => $isYou ? array_values($player['hand']) : [],
                'pos' => $player['pos'],
                'result' => $player['result'],
            ];
        }

        $builder = self::currentBuilder($room);

        return [
            'code' => $room['code'],
            'phase' => $room['phase'],
            'round' => (int) $room['round'],
            'levelId' => $room['levelId'],
            'targetScore' => (int) $room['targetScore'],
            'turnSlot' => $builder !== null && isset($room['players'][$builder])
                ? (int) $room['players'][$builder]['slot']
                : null,
            'youSlot' => $viewer !== null && isset($room['players'][$viewer])
                ? (int) $room['players'][$viewer]['slot']
                : null,
            'isHost' => $viewer !== null && $viewer === $room['hostToken'],
            'players' => $players,
            'blocks' => array_values($room['blocks']),
            'lastRound' => $room['lastRound'],
            'winner' => $room['winner'],
            'version' => (int) $room['version'],
            'phaseElapsed' => max(0, time() - (int) $room['phaseStarted']),
            'log' => array_slice($room['log'], -8),
        ];
    }

    /** @param array<string, mixed> $room */
    public static function touch(array &$room): void
    {
        $room['version'] = (int) $room['version'] + 1;
    }

    /** @param array<string, mixed> $room */
    public static function log(array &$room, string $message): void
    {
        $room['log'][] = $message;
        if (count($room['log']) > 30) {
            $room['log'] = array_slice($room['log'], -30);
        }
    }

    /** @param array<string, mixed> $room */
    public static function nameOf(array $room, string $token): string
    {
        return (string) ($room['players'][$token]['name'] ?? 'Jemand');
    }

    public static function cleanName(string $name, int $slot): string
    {
        // Mehrfache Leerzeichen zusammenfassen. Bei kaputtem UTF-8 liefert
        // der /u-Modifier null - dann ohne Unicode-Modus nachfassen.
        $clean = preg_replace('/\s+/u', ' ', $name);
        if ($clean === null) {
            $clean = preg_replace('/\s+/', ' ', $name);
        }

        $name = self::truncate(trim((string) $clean), 14);
        if ($name === '') {
            $name = 'Spieler ' . ($slot + 1);
        }

        return $name;
    }

    /**
     * Kuerzt einen Text auf eine Zeichenzahl - ohne die Erweiterung mbstring
     * vorauszusetzen. Die ist auf Debian/Ubuntu/Mint ein eigenes Paket und
     * bei einer schlanken php-cli-Installation oft nicht dabei.
     */
    public static function truncate(string $text, int $limit): string
    {
        if (function_exists('mb_substr')) {
            return mb_substr($text, 0, $limit, 'UTF-8');
        }

        // PCRE kann UTF-8 von Haus aus: "." zaehlt hier ganze Zeichen.
        $cut = preg_replace('/^(.{0,' . $limit . '}).*$/us', '$1', $text);
        if ($cut !== null) {
            return $cut;
        }

        return substr($text, 0, $limit);
    }

    public static function cleanChar(string $char, int $slot): string
    {
        return in_array($char, self::CHARACTERS, true)
            ? $char
            : self::CHARACTERS[$slot % count(self::CHARACTERS)];
    }

    private static function cleanCause(string $cause): string
    {
        $allowed = ['ziel', 'sturz', 'stachel', 'saege', 'pendel', 'pfeil', 'zeit', 'verbindung', ''];

        return in_array($cause, $allowed, true) ? $cause : '';
    }
}
