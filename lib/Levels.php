<?php
declare(strict_types=1);

/**
 * Die Welten des Spiels.
 *
 * Jede Welt ist als ASCII-Karte gezeichnet - 40 Zeichen breit, 23 Zeilen
 * hoch, eine Kachel pro Zeichen. So sieht man beim Bearbeiten direkt, wie
 * das Level aussieht:
 *
 *   .  Luft
 *   #  Boden (bekommt je nach Welt Gras, Schnee, Sand ... obendrauf)
 *   R  Fels
 *   -  Einweg-Plattform: von unten durchspringbar
 *   S  Startplatz (Luftkachel, darunter muss Boden sein)
 *   G  Ziel (Luftkachel, die Fahne steht darauf)
 *
 * Alle Welten sind ohne ein einziges Bauteil zu schaffen: Luecken hoechstens
 * 3 Kacheln, Stufen hoechstens 2 Kacheln, Kopffreiheit an jeder Absprung-
 * stelle. Ein Sprung schafft rund 3,3 Kacheln Hoehe und gut 5 Kacheln Weite.
 * tests.php laesst in jeder Welt eine echte Figur den Weg ablaufen.
 *
 * game.php reicht die fertig ausgewerteten Welten als JSON an den Browser,
 * damit Server und Client garantiert dieselbe Geometrie benutzen.
 */
final class Levels
{
    public const TILE = 32;
    public const COLS = 40;
    public const ROWS = 23;

    private const TERRAIN = ['#' => 'ground', 'R' => 'rock', '-' => 'oneway'];

    /** @var list<array<string, mixed>>|null */
    private static ?array $cache = null;

    /**
     * Rohdaten der Welten. Neue Welt = neuer Eintrag hier.
     *
     * @return list<array{id:string, name:string, theme:string, desc:string, map:list<string>}>
     */
    private static function definitions(): array
    {
        return [
            [
                'id' => 'wiese',
                'name' => 'Wiesenweg',
                'theme' => 'day',
                'desc' => 'Flacher Einstieg mit drei kurzen Lücken.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '......................-----.............',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '...................######...####........',
                    '...S...............######...####....G...',
                    '##########...############...####..######',
                    '##########...############...####..######',
                    '##########...############...####..######',
                    '##########...############...####..######',
                    '##########...############...####..######',
                ],
            ],
            [
                'id' => 'turm',
                'name' => 'Turmklettern',
                'theme' => 'dusk',
                'desc' => 'Eine lange Treppe hinauf zum Felsen.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '.............-----......................',
                    '.....................................G..',
                    '...................................RRRRR',
                    '...................................RRRRR',
                    '..............................####.RRRRR',
                    '..............................####.RRRRR',
                    '........................####..####.RRRRR',
                    '........................####..####.RRRRR',
                    '.................####...####..####.RRRRR',
                    '.................####...####..####.RRRRR',
                    '...........####..####...####..####.RRRRR',
                    '...........####..####...####..####.RRRRR',
                    '.....####..####..####...####..####.RRRRR',
                    '..S..####..####..####...####..####.RRRRR',
                    '########################################',
                    '########################################',
                ],
            ],
            [
                'id' => 'kluft',
                'name' => 'Die Kluft',
                'theme' => 'night',
                'desc' => 'Trittsteine über dem Abgrund.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '................----....................',
                    'RR....................................RR',
                    'RR....................................RR',
                    'RR....................................RR',
                    'RR....................................RR',
                    'RR............###..###................RR',
                    'RR.S..............................G...RR',
                    'RRRRRRR..###............###..RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                    'RRRRRRR......................RRRRRRRRRRR',
                ],
            ],
            [
                'id' => 'doppeldecker',
                'name' => 'Doppeldecker',
                'theme' => 'sunset',
                'desc' => 'Enger Gang unten, Treppe hinauf aufs Oberdeck.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '..................................G.....',
                    '............................############',
                    '############................############',
                    '############...........###............RR',
                    'RR....................................RR',
                    'RR.................###................RR',
                    'RR....................................RR',
                    'RR.............###....................RR',
                    'RR.S..................................RR',
                    '########################################',
                    '########################################',
                ],
            ],
            [
                'id' => 'gletscher',
                'name' => 'Gletscher',
                'theme' => 'ice',
                'desc' => 'Über den Eisberg und die treibenden Schollen.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '.........-----..........................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '....................####................',
                    '....................####................',
                    '...............#############............',
                    '...............#############............',
                    '.........####..#############.###........',
                    '..S......................####.......G...',
                    '#######..................####.....######',
                    '#######..................####.....######',
                    '#######.............................####',
                    '#######.............................####',
                ],
            ],
            [
                'id' => 'pyramide',
                'name' => 'Wüstenpyramide',
                'theme' => 'desert',
                'desc' => 'Stufe um Stufe über die Pyramide.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '..................RRRR..................',
                    '..................RRRR..................',
                    '................RRRRRRRR................',
                    '................RRRRRRRR................',
                    '..............RRRRRRRRRRRR..............',
                    '..............RRRRRRRRRRRR..............',
                    '............RRRRRRRRRRRRRRRR............',
                    '............RRRRRRRRRRRRRRRR............',
                    '...S......RRRRRRRRRRRRRRRRRRRR......G...',
                    '########..RRRRRRRRRRRRRRRRRRRR..########',
                    '########..RRRRRRRRRRRRRRRRRRRR..########',
                    '########..RRRRRRRRRRRRRRRRRRRR..########',
                    '########..RRRRRRRRRRRRRRRRRRRR..########',
                ],
            ],
            [
                'id' => 'vulkan',
                'name' => 'Vulkankrater',
                'theme' => 'lava',
                'desc' => 'Trittsteine über glühender Lava.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '.......................RRR..............',
                    '.............RRR............RRR.........',
                    '..S...............RRR...................',
                    'RRRRRR..RRR..........................G..',
                    'RRRRRR...........................RRRRRRR',
                    'RRRRRR...........................RRRRRRR',
                    'RRRRRR...........................RRRRRRR',
                    'RRRRRR...........................RRRRRRR',
                    'RRRRRR...........................RRRRRRR',
                    'RRRRRR...........................RRRRRRR',
                ],
            ],
            [
                'id' => 'burg',
                'name' => 'Burgmauer',
                'theme' => 'castle',
                'desc' => 'Durch das Tor oder über die Zinnen zum Turm.',
                'map' => [
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '........................................',
                    '......................................G.',
                    '.....................................RRR',
                    '................R..R..R..............RRR',
                    '..............RRRRRRRRRRRR........RRRRRR',
                    '..............RRRRRRRRRRRR........RRRRRR',
                    '...........---RRRRRRRRRRRR....RRR.RRRRRR',
                    '..............RRRRRRRRRRRR....RRR.RRRRRR',
                    '........RRR................RR.RRR.RRRRRR',
                    '..S.....RRR................RR.RRR.RRRRRR',
                    '########################################',
                    '########################################',
                    '########################################',
                ],
            ],
        ];
    }

    /** @return list<array<string, mixed>> */
    public static function all(): array
    {
        if (self::$cache === null) {
            self::$cache = array_map([self::class, 'parseMap'], self::definitions());
        }

        return self::$cache;
    }

    /**
     * Wertet eine ASCII-Karte aus: Startplatz, Ziel und die Gelaendeflaechen
     * als moeglichst grosse Rechtecke (spart JSON beim Ausliefern).
     *
     * @param array{id:string, name:string, theme:string, desc:string, map:list<string>} $def
     * @return array<string, mixed>
     */
    public static function parseMap(array $def): array
    {
        $map = $def['map'];
        $id = $def['id'];
        if (count($map) !== self::ROWS) {
            throw new LogicException("Welt '$id': " . count($map) . ' Zeilen statt ' . self::ROWS . '.');
        }

        $spawn = null;
        $goal = null;
        $runs = [];
        foreach ($map as $y => $row) {
            if (strlen($row) !== self::COLS) {
                throw new LogicException("Welt '$id', Zeile $y: " . strlen($row) . ' Zeichen statt ' . self::COLS . '.');
            }
            $x = 0;
            while ($x < self::COLS) {
                $char = $row[$x];
                if ($char === 'S' || $char === 'G') {
                    if (($char === 'S' ? $spawn : $goal) !== null) {
                        throw new LogicException("Welt '$id': mehr als ein '$char'.");
                    }
                    if ($char === 'S') {
                        $spawn = ['x' => $x, 'y' => $y];
                    } else {
                        $goal = ['x' => $x, 'y' => $y];
                    }
                    $x++;
                    continue;
                }
                if (!isset(self::TERRAIN[$char])) {
                    if ($char !== '.') {
                        throw new LogicException("Welt '$id', Zeile $y: unbekanntes Zeichen '$char'.");
                    }
                    $x++;
                    continue;
                }
                $start = $x;
                while ($x < self::COLS && $row[$x] === $char) {
                    $x++;
                }
                $runs[] = ['x' => $start, 'y' => $y, 'w' => $x - $start, 'h' => 1, 't' => self::TERRAIN[$char]];
            }
        }

        if ($spawn === null || $goal === null) {
            throw new LogicException("Welt '$id': Startplatz (S) und Ziel (G) muessen gesetzt sein.");
        }

        return [
            'id' => $id,
            'name' => $def['name'],
            'theme' => $def['theme'],
            'desc' => $def['desc'],
            'spawn' => $spawn,
            'goal' => $goal,
            'rects' => self::mergeRuns($runs),
        ];
    }

    /**
     * Fasst gleich breite, uebereinanderliegende Streifen zu Rechtecken
     * zusammen.
     *
     * @param list<array{x:int, y:int, w:int, h:int, t:string}> $runs
     * @return list<array{x:int, y:int, w:int, h:int, t:string}>
     */
    private static function mergeRuns(array $runs): array
    {
        $open = [];
        $done = [];
        foreach ($runs as $run) {
            $key = $run['x'] . ':' . $run['w'] . ':' . $run['t'];
            if (isset($open[$key]) && $open[$key]['y'] + $open[$key]['h'] === $run['y']) {
                $open[$key]['h']++;
                continue;
            }
            if (isset($open[$key])) {
                $done[] = $open[$key];
            }
            $open[$key] = $run;
        }

        return array_merge($done, array_values($open));
    }

    /** @return array<string, mixed>|null */
    public static function byId(string $id): ?array
    {
        foreach (self::all() as $level) {
            if ($level['id'] === $id) {
                return $level;
            }
        }

        return null;
    }

    public static function randomId(): string
    {
        $levels = self::all();

        return $levels[random_int(0, count($levels) - 1)]['id'];
    }

    /**
     * Alle Kacheln, auf die kein Bauteil gesetzt werden darf: Gelaende,
     * Startbereich und Zielbereich.
     *
     * @return array<string, true> Schluessel im Format "x,y"
     */
    public static function blockedTiles(string $levelId): array
    {
        $level = self::byId($levelId);
        if ($level === null) {
            return [];
        }

        $blocked = [];
        foreach ($level['rects'] as $rect) {
            for ($x = $rect['x']; $x < $rect['x'] + $rect['w']; $x++) {
                for ($y = $rect['y']; $y < $rect['y'] + $rect['h']; $y++) {
                    $blocked[$x . ',' . $y] = true;
                }
            }
        }

        foreach (self::safeZone($level) as $key => $_) {
            $blocked[$key] = true;
        }

        // Zielbereich freihalten (Fahne ist 1x2 Kacheln hoch, plus Rand).
        for ($dx = -1; $dx <= 1; $dx++) {
            for ($dy = -2; $dy <= 1; $dy++) {
                $blocked[($level['goal']['x'] + $dx) . ',' . ($level['goal']['y'] + $dy)] = true;
            }
        }

        return $blocked;
    }

    /**
     * Die Startzone: 4 Kacheln breit, 3 hoch. Hier darf nicht gebaut werden,
     * und wer darin steht, ist unverwundbar.
     *
     * @param array<string, mixed> $level
     * @return array<string, true>
     */
    public static function safeZone(array $level): array
    {
        $zone = [];
        for ($dx = -1; $dx <= 2; $dx++) {
            for ($dy = -2; $dy <= 0; $dy++) {
                $zone[($level['spawn']['x'] + $dx) . ',' . ($level['spawn']['y'] + $dy)] = true;
            }
        }

        return $zone;
    }

    public static function inBounds(int $x, int $y): bool
    {
        return $x >= 0 && $y >= 0 && $x < self::COLS && $y < self::ROWS;
    }
}
