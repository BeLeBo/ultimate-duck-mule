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
    public const MAX_PLAYERS = 4;
    public const MIN_PLAYERS = 2;
    public const HAND_SIZE = 4;

    /**
     * Bauteile, die ein Spieler pro Runde setzen darf. Loeschen geht nur
     * noch mit der Abrissbirne (Power-up).
     */
    public const PLACES_PER_TURN = 1;
    public const MAX_BLOCKS = 320;

    /** Ein Match dauert so viele Runden - danach gewinnt, wer vorne liegt. */
    public const DEFAULT_ROUNDS = 8;
    public const MIN_ROUNDS = 3;
    public const MAX_ROUNDS = 30;

    /**
     * Zeitplan der Partyphase (Sek.). Der Server fuehrt die Uhr, damit alle
     * denselben Zeitbalken sehen und die Runde fuer alle gleichzeitig endet.
     */
    public const PARTY_COUNTDOWN = 2.2;
    public const PARTY_LIMIT = 60;
    /** Restzeit, sobald die erste Figur im Ziel ist. */
    public const PARTY_AFTER_FIRST = 10;
    /** So lange wartet der Server nach Ablauf auf die letzten Meldungen. */
    public const PARTY_GRACE = 2.0;
    /** Notbremse fuer Raeume ohne Zeitplan (aeltere Versionen). */
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
    public const CHARACTERS = ['duck', 'mule', 'racoon', 'frog'];

    /**
     * Todesursachen, fuer die es einen Schuldigen geben kann. Zeitablauf,
     * Aufgeben und Verbindungsabbruch gehoeren nicht dazu.
     *
     * @var list<string>
     */
    public const DEADLY_CAUSES = ['sturz', 'stachel', 'saege', 'pendel', 'pfeil'];

    /**
     * Waehlbare Spielerfarben. Die ersten vier sind die Standardfarben der
     * Plaetze; jede Farbe gibt es pro Raum nur einmal.
     *
     * @var list<string>
     */
    public const COLORS = ['#ffcb3d', '#3fc7f0', '#ff6f91', '#7ed957', '#ff9f43', '#b18cff', '#ff5a5a', '#2fe0c0'];

    /** @return array<string, mixed> */
    public static function newRoom(string $code, int $rounds, ?string $levelId): array
    {
        return [
            'code' => $code,
            'created' => time(),
            'updated' => time(),
            'version' => 1,
            'phase' => 'lobby',
            'round' => 0,
            'levelId' => $levelId !== null && Levels::byId($levelId) !== null ? $levelId : Levels::randomId(),
            // "Zufall" gewaehlt? Dann wird bei jedem Matchstart neu gewuerfelt.
            'randomLevel' => $levelId === null || Levels::byId($levelId) === null,
            'rounds' => self::clampRounds($rounds),
            'hostToken' => null,
            'order' => [],
            'turn' => 0,
            'buildOrder' => [],
            'nextBlockId' => 1,
            'blocks' => [],
            // Geloeschte Bauteile: gleicher Typ darf dort bis 'until' nicht wieder hin.
            'graves' => [],
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
            'color' => self::freeColor($room, $slot),
            'score' => 0,
            'hand' => [],
            'places' => 0,
            // Power-ups, die in der naechsten Partyphase wirken.
            'buffs' => [],
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

    /**
     * Erste freie Farbe - bevorzugt die Standardfarbe des Platzes.
     *
     * @param array<string, mixed> $room
     */
    private static function freeColor(array $room, int $slot): string
    {
        $taken = array_column($room['players'], 'color');
        $preferred = self::COLORS[$slot % count(self::COLORS)];
        if (!in_array($preferred, $taken, true)) {
            return $preferred;
        }
        foreach (self::COLORS as $color) {
            if (!in_array($color, $taken, true)) {
                return $color;
            }
        }

        return $preferred;
    }

    /**
     * Farbe in der Lobby waehlen - jede Farbe nur einmal pro Raum.
     *
     * @param array<string, mixed> $room
     */
    public static function setColor(array &$room, string $token, string $color): void
    {
        if (!isset($room['players'][$token])) {
            throw new RuntimeException('Du bist nicht in diesem Raum.');
        }
        if ($room['phase'] !== 'lobby') {
            throw new RuntimeException('Die Farbe lässt sich nur in der Lobby ändern.');
        }
        $color = strtolower($color);
        if (!in_array($color, self::COLORS, true)) {
            throw new RuntimeException('Diese Farbe gibt es nicht.');
        }
        foreach ($room['players'] as $other => $player) {
            if ($other !== $token && ($player['color'] ?? '') === $color) {
                throw new RuntimeException('Diese Farbe hat schon ' . $player['name'] . '.');
            }
        }
        $room['players'][$token]['color'] = $color;
        self::touch($room);
    }

    /**
     * Tier (Figur) in der Lobby wechseln. Anders als Farben darf dasselbe
     * Tier mehrfach vorkommen - die Farbe unterscheidet die Spieler.
     *
     * @param array<string, mixed> $room
     */
    public static function setChar(array &$room, string $token, string $char): void
    {
        if (!isset($room['players'][$token])) {
            throw new RuntimeException('Du bist nicht in diesem Raum.');
        }
        if ($room['phase'] !== 'lobby') {
            throw new RuntimeException('Die Figur lässt sich nur in der Lobby ändern.');
        }
        if (!in_array($char, self::CHARACTERS, true)) {
            throw new RuntimeException('Diese Figur gibt es nicht.');
        }
        $room['players'][$token]['char'] = $char;
        self::touch($room);
    }

    /**
     * Farbe eines Spielers - Raeume aus aelteren Versionen kennen noch keine.
     *
     * @param array<string, mixed> $player
     */
    public static function colorOf(array $player): string
    {
        $color = (string) ($player['color'] ?? '');

        return in_array($color, self::COLORS, true)
            ? $color
            : self::COLORS[(int) $player['slot'] % count(self::COLORS)];
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

    /**
     * Nach dem Matchende zurueck in die Lobby: dort waehlt der Gastgeber Welt
     * und Rundenzahl neu, und neue Mitspieler koennen noch beitreten.
     */
    public static function backToLobby(array &$room, string $token): void
    {
        if ($room['hostToken'] !== $token) {
            throw new RuntimeException('Nur der Gastgeber kann ein neues Match vorbereiten.');
        }
        if ($room['phase'] !== 'over') {
            throw new RuntimeException('Das Match laeuft noch.');
        }

        foreach ($room['players'] as &$player) {
            $player['score'] = 0;
            $player['hand'] = [];
            $player['buffs'] = [];
            $player['ready'] = false;
            $player['result'] = null;
            $player['pos'] = null;
        }
        unset($player);

        $room['phase'] = 'lobby';
        $room['round'] = 0;
        $room['blocks'] = [];
        $room['graves'] = [];
        $room['deadRounds'] = 0;
        $room['winner'] = null;
        $room['lastRound'] = null;
        $room['buildView'] = null;
        $room['phaseStarted'] = time();
        self::log($room, 'Zurück in der Lobby.');
    }

    /**
     * Welt und Rundenzahl in der Lobby aendern - nur der Gastgeber.
     *
     * @param array<string, mixed> $room
     */
    public static function updateSettings(array &$room, string $token, string $levelId, int $rounds): void
    {
        if ($room['hostToken'] !== $token) {
            throw new RuntimeException('Nur der Gastgeber kann die Einstellungen ändern.');
        }
        if ($room['phase'] !== 'lobby') {
            throw new RuntimeException('Einstellungen gehen nur in der Lobby.');
        }

        if ($levelId === '' || Levels::byId($levelId) === null) {
            $room['randomLevel'] = true;
            $room['levelId'] = Levels::randomId();
        } else {
            $room['randomLevel'] = false;
            $room['levelId'] = $levelId;
        }
        $room['rounds'] = self::clampRounds($rounds);
        self::touch($room);
    }

    public static function clampRounds(int $rounds): int
    {
        return max(self::MIN_ROUNDS, min(self::MAX_ROUNDS, $rounds));
    }

    /**
     * Rundenzahl des Matches. Raeume aus aelteren Versionen kennen nur
     * Zielpunkte - dann gilt der Standard.
     *
     * @param array<string, mixed> $room
     */
    public static function totalRounds(array $room): int
    {
        return self::clampRounds((int) ($room['rounds'] ?? self::DEFAULT_ROUNDS));
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

        if (!empty($room['randomLevel'])) {
            $room['levelId'] = Levels::randomId();
        }
        $room['blocks'] = [];
        $room['graves'] = [];
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
        $room['graves'] = self::activeGraves($room);

        foreach ($room['players'] as $token => &$player) {
            $player['hand'] = Cards::deal(self::HAND_SIZE);
            $player['places'] = self::PLACES_PER_TURN;
            $player['buffs'] = [];
            // Automatisch eingesetztes Power-up dieses Zugs (fuer die Anzeige).
            $player['bonus'] = null;
            $player['placed'] = !in_array($token, $active, true);
            $player['ready'] = false;
            $player['result'] = null;
            $player['pos'] = null;
        }
        unset($player);

        $room['phase'] = 'build';
        $room['buildOrder'] = self::buildOrder($room);
        $room['turn'] = 0;
        $room['phaseStarted'] = time();
        self::skipUnavailableBuilders($room);
        self::touch($room);
    }

    /**
     * Bau-Reihenfolge nach Punktestand: wer vorne liegt, baut zuerst - wer
     * hinten liegt, sieht alles und hat das letzte Wort. Gleichstand
     * entscheidet das Los.
     *
     * @param array<string, mixed> $room
     * @return list<string>
     */
    public static function buildOrder(array $room): array
    {
        $tokens = $room['order'];
        $lots = [];
        foreach ($tokens as $token) {
            $lots[$token] = random_int(0, PHP_INT_MAX);
        }
        // Eigener Vergleich statt stabiler Sortierung: PHP 7.4 sortiert nicht stabil.
        usort($tokens, static function (string $a, string $b) use ($room, $lots): int {
            $byScore = (int) $room['players'][$b]['score'] <=> (int) $room['players'][$a]['score'];

            return $byScore !== 0 ? $byScore : $lots[$a] <=> $lots[$b];
        });

        return $tokens;
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
        if (Cards::isPowerUp($type)) {
            throw new RuntimeException('Das ist ein Power-up – einfach anklicken, um es einzusetzen.');
        }
        if (!Cards::exists($type)) {
            throw new RuntimeException('Unbekanntes Bauteil.');
        }
        if ((int) $player['places'] <= 0) {
            throw new RuntimeException('Du hast schon alles gesetzt.');
        }
        if (count($room['blocks']) >= self::MAX_BLOCKS) {
            throw new RuntimeException('Das Level ist voll.');
        }
        if (self::blockedByGrave($room, $x, $y, $type)) {
            throw new RuntimeException(
                'Hier wurde eben erst ' . Cards::CATALOG[$type]['name'] . ' entfernt – nächste Runde wieder.'
            );
        }
        if (!self::canPlaceAt($room, $x, $y, $type)) {
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

        // Nur die benutzte Karte wandert aus der Hand, der Rest bleibt.
        array_splice($player['hand'], $cardIndex, 1);
        $player['places'] = (int) $player['places'] - 1;
        // Das letzte Bauteil beendet den Zug - ebenso, wenn keine
        // Bauteilkarte mehr auf der Hand ist.
        $done = $player['places'] <= 0 || !self::hasBlockCard($player['hand']);
        if ($done) {
            $player['placed'] = true;
            $player['hand'] = [];
        }
        unset($player);

        self::log($room, self::nameOf($room, $token) . ' setzt ' . Cards::CATALOG[$type]['name'] . '.');
        if ($done) {
            self::advanceBuild($room);
        }
        self::touch($room);
    }

    /** @param list<string> $hand */
    private static function hasBlockCard(array $hand): bool
    {
        foreach ($hand as $card) {
            if (Cards::exists($card)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Setzt ein Power-up aus der Hand ein. Die Abrissbirne braucht ein Ziel:
     * zwei Felder ab (x, y), waagerecht (rot gerade) oder senkrecht (rot
     * ungerade). Alle anderen wirken in der folgenden Partyphase auf die
     * eigene Figur. Ein Power-up kostet keinen Bauzug.
     *
     * @param array<string, mixed> $room
     */
    public static function usePower(array &$room, string $token, int $cardIndex, int $x, int $y, int $rot = 0): void
    {
        if ($room['phase'] !== 'build') {
            throw new RuntimeException('Gerade ist keine Bauphase.');
        }
        if (self::currentBuilder($room) !== $token) {
            throw new RuntimeException('Du bist nicht am Zug.');
        }

        $card = $room['players'][$token]['hand'][$cardIndex] ?? null;
        if ($card === null || !Cards::isPowerUp($card)) {
            throw new RuntimeException('Diese Karte ist kein Power-up.');
        }

        if ($card === 'pu_remove') {
            $removed = self::removeBlocksAt($room, self::wreckTiles($x, $y, $rot));
            $names = array_map(
                static fn (array $b): string => Cards::CATALOG[$b['type']]['name'] ?? 'ein Bauteil',
                $removed
            );
            $message = 'reißt ' . implode(' und ', $names) . ' ab';
        } else {
            $buffs = $room['players'][$token]['buffs'] ?? [];
            if (!in_array($card, $buffs, true)) {
                $buffs[] = $card;
            }
            $room['players'][$token]['buffs'] = $buffs;
            $message = 'hat diese Runde ' . Cards::POWERUPS[$card]['name'];
        }

        array_splice($room['players'][$token]['hand'], $cardIndex, 1);

        self::log($room, self::nameOf($room, $token) . ' ' . $message . '.');
        self::touch($room);
    }

    /**
     * Die zwei Felder der Abrissbirne: ab (x, y) nach rechts oder nach unten.
     *
     * @return list<array{0:int, 1:int}>
     */
    public static function wreckTiles(int $x, int $y, int $rot): array
    {
        return $rot % 2 === 0 ? [[$x, $y], [$x + 1, $y]] : [[$x, $y], [$x, $y + 1]];
    }

    /**
     * Entfernt alle Bauteile, die eines der Felder belegen - eigene wie
     * fremde. Jedes hinterlaesst einen Grabstein.
     *
     * @param array<string, mixed> $room
     * @param list<array{0:int, 1:int}> $tiles
     * @return list<array<string, mixed>> die entfernten Bauteile
     */
    private static function removeBlocksAt(array &$room, array $tiles): array
    {
        $taken = self::occupiedTiles($room);
        $ids = [];
        foreach ($tiles as [$x, $y]) {
            if (isset($taken[$x . ',' . $y])) {
                $ids[$taken[$x . ',' . $y]] = true;
            }
        }
        if ($ids === []) {
            throw new RuntimeException('Da liegt kein Bauteil.');
        }

        $removed = [];
        $kept = [];
        foreach ($room['blocks'] as $block) {
            if (isset($ids[(int) $block['id']])) {
                $removed[] = $block;
                self::addGrave($room, $block);
            } else {
                $kept[] = $block;
            }
        }
        $room['blocks'] = $kept;

        return $removed;
    }

    /** @param array<string, mixed> $room */
    public static function skipBuild(array &$room, string $token): void
    {
        if ($room['phase'] !== 'build' || self::currentBuilder($room) !== $token) {
            return;
        }
        $left = (int) $room['players'][$token]['places'];
        $room['players'][$token]['placed'] = true;
        $room['players'][$token]['places'] = 0;
        $room['players'][$token]['hand'] = [];
        self::log($room, self::nameOf($room, $token) . ($left >= self::PLACES_PER_TURN ? ' setzt nichts.' : ' ist fertig.'));
        self::advanceBuild($room);
        self::touch($room);
    }

    /** @param array<string, mixed> $room */
    private static function advanceBuild(array &$room): void
    {
        $order = self::currentOrder($room);
        for ($idx = (int) $room['turn'] + 1; $idx < count($order); $idx++) {
            $player = $room['players'][$order[$idx]] ?? null;
            if ($player !== null && !$player['placed'] && self::isConnected($player)) {
                $room['turn'] = $idx;
                $room['phaseStarted'] = time();
                $room['buildView'] = null;
                self::startTurn($room);

                return;
            }
        }

        self::beginParty($room);
    }

    /**
     * Beginn eines Bauzugs: Power-ups, die der eigenen Figur helfen, setzen
     * sich sofort selbst ein - niemand muss sie anklicken. Nur die
     * Abrissbirne bleibt auf der Hand, sie braucht ein Ziel.
     *
     * @param array<string, mixed> $room
     */
    public static function startTurn(array &$room): void
    {
        $token = self::currentBuilder($room);
        if ($token === null || !isset($room['players'][$token])) {
            return;
        }
        $player = &$room['players'][$token];
        $keep = [];
        foreach ($player['hand'] as $card) {
            if (Cards::isBuff($card)) {
                if (!in_array($card, $player['buffs'] ?? [], true)) {
                    $player['buffs'][] = $card;
                }
                $player['bonus'] = $card;
                self::log($room, self::nameOf($room, $token) . ' zieht ' . Cards::POWERUPS[$card]['name'] . '!');
            } else {
                $keep[] = $card;
            }
        }
        $player['hand'] = $keep;
        unset($player);
    }

    /** @param array<string, mixed> $room */
    private static function skipUnavailableBuilders(array &$room): void
    {
        $order = self::currentOrder($room);
        for ($idx = 0; $idx < count($order); $idx++) {
            $player = $room['players'][$order[$idx]] ?? null;
            if ($player !== null && !$player['placed'] && self::isConnected($player)) {
                $room['turn'] = $idx;
                self::startTurn($room);

                return;
            }
        }

        self::beginParty($room);
    }

    /**
     * Reihenfolge der laufenden Bauphase. Raeume von vor dieser Version
     * kennen noch keine buildOrder - dann gilt die Beitrittsreihenfolge.
     *
     * @param array<string, mixed> $room
     * @return list<string>
     */
    private static function currentOrder(array $room): array
    {
        $order = $room['buildOrder'] ?? [];

        return is_array($order) && $order !== [] ? array_values($order) : $room['order'];
    }

    /** @param array<string, mixed> $room */
    public static function beginParty(array &$room): void
    {
        $room['phase'] = 'party';
        $room['phaseStarted'] = time();
        $room['partyStart'] = microtime(true);
        $room['partyEnds'] = $room['partyStart'] + self::PARTY_COUNTDOWN + self::PARTY_LIMIT;
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

        $slot = static function ($value): ?int {
            if (!is_numeric($value)) {
                return null;
            }
            $number = (int) $value;

            return ($number >= 0 && $number < self::MAX_PLAYERS) ? $number : null;
        };
        $blockId = static function ($value): ?int {
            return is_numeric($value) && (int) $value > 0 ? (int) $value : null;
        };

        $finished = (bool) ($result['finished'] ?? false);
        $cause = self::cleanCause((string) ($result['cause'] ?? ''));
        // Schuldige gibt es nur bei einem echten Tod durch Sturz oder Falle -
        // nicht im Ziel, nicht beim Aufgeben und nicht bei Zeitablauf. Sonst
        // gaebe ein kurzer Kontakt mit Oel oder Ventilator Punkte, obwohl
        // niemand gestorben ist.
        $killed = !$finished && in_array($cause, self::DEADLY_CAUSES, true);

        $room['players'][$token]['result'] = [
            'finished' => $finished,
            'time' => round(max(0.0, min(999.0, (float) ($result['time'] ?? 0))), 2),
            'killerSlot' => $killed ? $slot($result['killerSlot'] ?? null) : null,
            // Wer mit Öl oder Ventilator nachgeholfen hat.
            'assistSlot' => $killed ? $slot($result['assistSlot'] ?? null) : null,
            'killerBlock' => $killed ? $blockId($result['killerBlock'] ?? null) : null,
            'assistBlock' => $killed ? $blockId($result['assistBlock'] ?? null) : null,
            'cause' => $finished ? 'ziel' : $cause,
        ];

        // Die erste Figur im Ziel verkuerzt die Restzeit fuer alle.
        if ($room['players'][$token]['result']['finished'] && isset($room['partyEnds'])) {
            $room['partyEnds'] = min((float) $room['partyEnds'], microtime(true) + self::PARTY_AFTER_FIRST);
        }

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
     *   +1  Bonus fuer die schnellste Zeit unter den Angekommenen
     *   +2  Bonus, wenn nur eine Figur das Ziel erreicht hat
     *   +1  je Gegner, der an einem eigenen Bauteil gestorben ist
     *   +1  je Gegner, den man mit Oel oder Ventilator hineingeschoben hat
     *   -1  am eigenen Bauteil gestorben
     *
     * Erreicht niemand das Ziel, gibt es fuer die ganze Runde nichts - auch
     * keine Fallenpunkte. Punkte werden nie unter 0 gedrueckt.
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

        // Wer war zuerst da? Bei gleicher Zeit gewinnt die Spielerreihenfolge.
        $firstToken = null;
        $bestTime = null;
        foreach ($finishers as $token) {
            $time = (float) ($room['players'][$token]['result']['time'] ?? 999);
            if ($bestTime === null || $time < $bestTime) {
                $bestTime = $time;
                $firstToken = $token;
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
                if ($token === $firstToken && count($participants) > 1) {
                    $delta += 1;
                    $reasons[] = ['text' => 'Erster im Ziel', 'points' => 1];
                }
                if (count($finishers) === 1 && count($participants) > 1) {
                    $delta += 2;
                    $reasons[] = ['text' => 'Einziger im Ziel', 'points' => 2];
                }
            }

            // Fallen- und Helferpunkte gibt es nur, wenn ueberhaupt jemand
            // ins Ziel gekommen ist.
            if (count($finishers) > 0) {
                $victims = 0;
                $assists = 0;
                foreach ($participants as $other) {
                    if ($other === $token) {
                        continue;
                    }
                    $otherResult = $room['players'][$other]['result'] ?? null;
                    if ($otherResult === null) {
                        continue;
                    }
                    if ($otherResult['killerSlot'] === $player['slot']) {
                        $victims++;
                    } elseif (($otherResult['assistSlot'] ?? null) === $player['slot']) {
                        $assists++;
                    }
                }
                if ($victims > 0) {
                    $delta += $victims;
                    $reasons[] = [
                        'text' => $victims > 1 ? "Fallensteller (x$victims)" : 'Fallensteller',
                        'points' => $victims,
                    ];
                }
                if ($assists > 0) {
                    $delta += $assists;
                    $reasons[] = [
                        'text' => $assists > 1 ? "Nachgeholfen (x$assists)" : 'Nachgeholfen',
                        'points' => $assists,
                    ];
                }

                if ($result !== null && $result['killerSlot'] === $player['slot']) {
                    $delta -= 1;
                    $reasons[] = ['text' => 'Eigentor', 'points' => -1];
                }
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

        $spent = self::spentBlocks($room, $participants);
        $spentCount = 0;
        if ($spent !== []) {
            $kept = [];
            foreach ($room['blocks'] as $block) {
                if (isset($spent[(int) $block['id']])) {
                    $spentCount++;
                    self::addGrave($room, $block);
                } else {
                    $kept[] = $block;
                }
            }
            $room['blocks'] = $kept;
            if ($spentCount > 0) {
                self::log($room, $spentCount . ' Bauteil(e) haben alle erwischt und verschwinden.');
            }
        }

        // Kommt drei Runden lang niemand an, ist das Level zugebaut.
        $cleared = false;
        if (count($finishers) === 0) {
            $room['deadRounds'] = (int) ($room['deadRounds'] ?? 0) + 1;
            if ($room['deadRounds'] >= self::DEAD_ROUND_LIMIT) {
                $room['blocks'] = [];
                $room['graves'] = [];
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
            'spent' => $spentCount,
            'firstSlot' => $firstToken !== null ? (int) $room['players'][$firstToken]['slot'] : null,
        ];

        $room['phase'] = 'score';
        $room['phaseStarted'] = time();

        // Nach der letzten Runde gewinnt, wer vorne liegt.
        if ((int) $room['round'] >= self::totalRounds($room)) {
            $winner = self::findWinner($room);
            $room['phase'] = 'over';
            $room['winner'] = $winner;
            $names = array_map(static fn (array $p): string => $p['name'], $winner['players']);
            self::log($room, count($names) > 1
                ? 'Unentschieden: ' . implode(' und ', $names) . '!'
                : $names[0] . ' gewinnt das Match!');
        }
    }

    /**
     * Ein Bauteil verschwindet nur, wenn es in dieser Runde jeden einzelnen
     * Teilnehmer erwischt hat. Sonst bleibt es liegen - abraeumen geht dann
     * nur mit der Abrissbirne.
     *
     * @param array<string, mixed> $room
     * @param list<string> $participants
     * @return array<int, true> Bauteil-Kennung => true
     */
    public static function spentBlocks(array $room, array $participants): array
    {
        $kills = [];
        foreach ($participants as $token) {
            $block = $room['players'][$token]['result']['killerBlock'] ?? null;
            if (!empty($block)) {
                $kills[(int) $block] = ($kills[(int) $block] ?? 0) + 1;
            }
        }

        $spent = [];
        foreach ($kills as $id => $victims) {
            if ($participants !== [] && $victims >= count($participants)) {
                $spent[$id] = true;
            }
        }

        return $spent;
    }

    /**
     * Wer liegt vorne? Bei Gleichstand teilen sich alle den Sieg.
     *
     * @param array<string, mixed> $room
     * @return array{score:int, players:list<array{slot:int, name:string, char:string}>}
     */
    private static function findWinner(array $room): array
    {
        $tokens = self::connectedTokens($room) ?: $room['order'];
        $best = -1;
        $bestTokens = [];
        foreach ($tokens as $token) {
            $score = (int) $room['players'][$token]['score'];
            if ($score > $best) {
                $best = $score;
                $bestTokens = [$token];
            } elseif ($score === $best) {
                $bestTokens[] = $token;
            }
        }

        return [
            'score' => max(0, $best),
            'players' => array_map(static fn (string $token): array => [
                'slot' => (int) $room['players'][$token]['slot'],
                'name' => (string) $room['players'][$token]['name'],
                'char' => (string) $room['players'][$token]['char'],
            ], $bestTokens),
        ];
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
            self::backToLobby($room, $token);
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
                    $room['players'][$builder]['places'] = 0;
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
            // Zeit abgelaufen: wer sich bis dahin nicht gemeldet hat, ist raus.
            $deadline = isset($room['partyEnds'])
                ? (float) $room['partyEnds'] + self::PARTY_GRACE
                : (float) $room['phaseStarted'] + self::PARTY_HARD_LIMIT;
            if (microtime(true) > $deadline) {
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

    /**
     * Passt ein Bauteil hierhin? Prueft die komplette Grundflaeche, denn
     * Balken, Mauer und Betonklotz belegen mehrere Kacheln.
     *
     * @param array<string, mixed> $room
     */
    public static function canPlaceAt(array $room, int $x, int $y, string $type = 'stone'): bool
    {
        if (self::blockedByGrave($room, $x, $y, $type)) {
            return false;
        }
        $size = Cards::size($type);
        $blocked = Levels::blockedTiles((string) $room['levelId']);
        $taken = self::occupiedTiles($room);

        for ($dx = 0; $dx < $size['w']; $dx++) {
            for ($dy = 0; $dy < $size['h']; $dy++) {
                $tx = $x + $dx;
                $ty = $y + $dy;
                if (!Levels::inBounds($tx, $ty)) {
                    return false;
                }
                if (isset($blocked[$tx . ',' . $ty]) || isset($taken[$tx . ',' . $ty])) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Merkt sich ein entferntes Bauteil: derselbe Typ darf bis zum Ende der
     * naechsten Runde nicht auf eine ueberlappende Flaeche.
     *
     * @param array<string, mixed> $room
     * @param array<string, mixed> $block
     */
    public static function addGrave(array &$room, array $block): void
    {
        $room['graves'][] = [
            'type' => (string) $block['type'],
            'x' => (int) $block['x'],
            'y' => (int) $block['y'],
            'until' => (int) $room['round'] + 1,
        ];
    }

    /**
     * @param array<string, mixed> $room
     * @return list<array{type:string, x:int, y:int, until:int}>
     */
    public static function activeGraves(array $room): array
    {
        $round = (int) $room['round'];

        return array_values(array_filter(
            $room['graves'] ?? [],
            static fn (array $grave): bool => (int) $grave['until'] >= $round
        ));
    }

    /**
     * Wuerde ein Bauteil dieses Typs hier einen frischen Grabstein ueberdecken?
     *
     * @param array<string, mixed> $room
     */
    public static function blockedByGrave(array $room, int $x, int $y, string $type): bool
    {
        $size = Cards::size($type);
        foreach (self::activeGraves($room) as $grave) {
            if ($grave['type'] !== $type) {
                continue;
            }
            // Gleicher Typ = gleiche Groesse: Rechtecke ueberlappen?
            if ($x < $grave['x'] + $size['w'] && $grave['x'] < $x + $size['w']
                && $y < $grave['y'] + $size['h'] && $grave['y'] < $y + $size['h']) {
                return true;
            }
        }

        return false;
    }

    /**
     * Alle von Bauteilen belegten Kacheln.
     *
     * @param array<string, mixed> $room
     * @return array<string, int> Kachel => Bauteil-Kennung
     */
    public static function occupiedTiles(array $room): array
    {
        $taken = [];
        foreach ($room['blocks'] as $block) {
            $size = Cards::size((string) $block['type']);
            for ($dx = 0; $dx < $size['w']; $dx++) {
                for ($dy = 0; $dy < $size['h']; $dy++) {
                    $taken[((int) $block['x'] + $dx) . ',' . ((int) $block['y'] + $dy)] = (int) $block['id'];
                }
            }
        }

        return $taken;
    }

    /** @param array<string, mixed> $room */
    public static function currentBuilder(array $room): ?string
    {
        $order = self::currentOrder($room);

        return $order[(int) $room['turn']] ?? null;
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
                'color' => self::colorOf($player),
                'score' => (int) $player['score'],
                'connected' => self::isConnected($player),
                'placed' => (bool) $player['placed'],
                'ready' => (bool) $player['ready'],
                'you' => $isYou,
                'host' => $token === $room['hostToken'],
                'handSize' => count($player['hand']),
                // Handkarten sieht nur ihr Besitzer - die anderen sehen beim
                // Bauen nur, wo und wie etwas gesetzt wird.
                'hand' => $isYou ? array_values($player['hand']) : [],
                'places' => (int) ($player['places'] ?? 0),
                'buffs' => array_values($player['buffs'] ?? []),
                // Welches Power-up sich diesen Zug von selbst eingesetzt hat -
                // nur fuer den Spieler selbst (fuer den Spielautomaten).
                'bonus' => $isYou ? ($player['bonus'] ?? null) : null,
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
            'randomLevel' => !empty($room['randomLevel']),
            'rounds' => self::totalRounds($room),
            'turnSlot' => $builder !== null && isset($room['players'][$builder])
                ? (int) $room['players'][$builder]['slot']
                : null,
            'buildOrder' => array_values(array_map(
                static fn (string $token): int => (int) ($room['players'][$token]['slot'] ?? -1),
                self::currentOrder($room)
            )),
            'youSlot' => $viewer !== null && isset($room['players'][$viewer])
                ? (int) $room['players'][$viewer]['slot']
                : null,
            'isHost' => $viewer !== null && $viewer === $room['hostToken'],
            'players' => $players,
            'blocks' => array_values($room['blocks']),
            'graves' => array_map(
                static fn (array $g): array => ['type' => $g['type'], 'x' => $g['x'], 'y' => $g['y']],
                self::activeGraves($room)
            ),
            'buildView' => $room['phase'] === 'build' ? ($room['buildView'] ?? null) : null,
            'party' => $room['phase'] === 'party' ? self::partyClock($room) : null,
            'lastRound' => $room['lastRound'],
            'winner' => $room['winner'],
            'version' => (int) $room['version'],
            'phaseElapsed' => max(0, time() - (int) $room['phaseStarted']),
            'log' => array_slice($room['log'], -8),
        ];
    }

    /**
     * Uhr der Partyphase: wie weit sie ist und wie viel Zeit bleibt.
     *
     * @param array<string, mixed> $room
     * @return array{countdown:float, limit:int, elapsed:float, remaining:float}
     */
    public static function partyClock(array $room): array
    {
        $now = microtime(true);
        $start = (float) ($room['partyStart'] ?? $room['phaseStarted']);
        $ends = (float) ($room['partyEnds'] ?? $start + self::PARTY_COUNTDOWN + self::PARTY_LIMIT);

        return [
            'countdown' => self::PARTY_COUNTDOWN,
            'limit' => self::PARTY_LIMIT,
            'elapsed' => round(max(0.0, $now - $start), 3),
            'remaining' => round(max(0.0, $ends - $now), 3),
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
        $allowed = [
            'ziel', 'sturz', 'stachel', 'saege', 'pendel', 'pfeil',
            'zeit', 'verbindung', 'aufgabe', '',
        ];

        return in_array($cause, $allowed, true) ? $cause : '';
    }
}
