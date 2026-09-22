<?php
declare(strict_types=1);

/**
 * Die Basis-Karten des Spiels.
 *
 * Bewusst nur hier definiert: game.php reicht die Liste als JSON an den Client
 * weiter, damit Server und Browser garantiert dieselbe Geometrie benutzen.
 *
 * Koordinaten sind Kachelkoordinaten (0/0 = oben links).
 * Rechtecke: x, y, w, h, t (ground | rock | oneway).
 */
final class Levels
{
    public const TILE = 32;
    public const COLS = 40;
    public const ROWS = 23;

    /**
     * Alle Level sind so gebaut, dass man sie **ohne ein einziges Bauteil**
     * schaffen kann: Luecken hoechstens 3 Kacheln breit, Stufen hoechstens
     * 2 Kacheln hoch. Gebaute Teile sind reine Hindernisse.
     *
     * Zum Rechnen: ein Sprung schafft rund 3,3 Kacheln Hoehe und aus vollem
     * Lauf etwa 5 Kacheln Weite. tests.php faehrt jedes Level mit einem
     * automatischen Laeufer ab und prueft genau das nach.
     *
     * @return list<array<string, mixed>>
     */
    public static function all(): array
    {
        return [
            [
                // Flacher Einstieg: immer nach rechts, drei kurze Luecken.
                'id' => 'wiese',
                'name' => 'Wiesenweg',
                'theme' => 'day',
                'spawn' => ['x' => 3, 'y' => 17],
                'goal' => ['x' => 36, 'y' => 17],
                'rects' => [
                    ['x' => 0, 'y' => 18, 'w' => 10, 'h' => 5, 't' => 'ground'],
                    ['x' => 13, 'y' => 18, 'w' => 6, 'h' => 5, 't' => 'ground'],
                    ['x' => 19, 'y' => 16, 'w' => 6, 'h' => 7, 't' => 'ground'],
                    ['x' => 28, 'y' => 16, 'w' => 4, 'h' => 7, 't' => 'ground'],
                    ['x' => 34, 'y' => 18, 'w' => 6, 'h' => 5, 't' => 'ground'],
                    ['x' => 22, 'y' => 11, 'w' => 5, 'h' => 1, 't' => 'oneway'],
                ],
            ],
            [
                // Treppe nach oben rechts. Jede Stufe steht auf dem Boden, so
                // hat niemand eine Decke ueber dem Kopf - und wer in eine
                // Luecke faellt, kommt aus ihr auch wieder heraus.
                'id' => 'turm',
                'name' => 'Turmklettern',
                'theme' => 'dusk',
                'spawn' => ['x' => 2, 'y' => 20],
                'goal' => ['x' => 37, 'y' => 8],
                'rects' => [
                    ['x' => 0, 'y' => 21, 'w' => 40, 'h' => 2, 't' => 'ground'],
                    ['x' => 5, 'y' => 19, 'w' => 4, 'h' => 2, 't' => 'ground'],
                    ['x' => 11, 'y' => 17, 'w' => 4, 'h' => 4, 't' => 'ground'],
                    ['x' => 17, 'y' => 15, 'w' => 4, 'h' => 6, 't' => 'ground'],
                    ['x' => 24, 'y' => 13, 'w' => 4, 'h' => 8, 't' => 'ground'],
                    ['x' => 30, 'y' => 11, 'w' => 4, 'h' => 10, 't' => 'ground'],
                    ['x' => 35, 'y' => 9, 'w' => 5, 'h' => 12, 't' => 'rock'],
                    ['x' => 13, 'y' => 7, 'w' => 5, 'h' => 1, 't' => 'oneway'],
                ],
            ],
            [
                // Trittsteine ueber dem Abgrund - jede Luecke 2 Kacheln.
                'id' => 'kluft',
                'name' => 'Die Kluft',
                'theme' => 'night',
                'spawn' => ['x' => 3, 'y' => 13],
                'goal' => ['x' => 34, 'y' => 13],
                'rects' => [
                    ['x' => 0, 'y' => 14, 'w' => 7, 'h' => 9, 't' => 'rock'],
                    ['x' => 9, 'y' => 14, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 14, 'y' => 12, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 19, 'y' => 12, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 24, 'y' => 14, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 29, 'y' => 14, 'w' => 11, 'h' => 9, 't' => 'rock'],
                    ['x' => 16, 'y' => 7, 'w' => 4, 'h' => 1, 't' => 'oneway'],
                    ['x' => 0, 'y' => 8, 'w' => 2, 'h' => 6, 't' => 'rock'],
                    ['x' => 38, 'y' => 8, 'w' => 2, 'h' => 6, 't' => 'rock'],
                ],
            ],
            [
                // Enger Gang unter dem Oberdeck, dann eine Treppe hinauf.
                'id' => 'doppeldecker',
                'name' => 'Doppeldecker',
                'theme' => 'sunset',
                'spawn' => ['x' => 3, 'y' => 20],
                'goal' => ['x' => 34, 'y' => 12],
                'rects' => [
                    ['x' => 0, 'y' => 21, 'w' => 40, 'h' => 2, 't' => 'ground'],
                    ['x' => 0, 'y' => 14, 'w' => 12, 'h' => 2, 't' => 'ground'],
                    ['x' => 15, 'y' => 19, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 19, 'y' => 17, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 23, 'y' => 15, 'w' => 3, 'h' => 1, 't' => 'ground'],
                    ['x' => 28, 'y' => 13, 'w' => 12, 'h' => 2, 't' => 'ground'],
                    ['x' => 0, 'y' => 16, 'w' => 2, 'h' => 5, 't' => 'rock'],
                    ['x' => 38, 'y' => 15, 'w' => 2, 'h' => 6, 't' => 'rock'],
                ],
            ],
        ];
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

        // Startbereich freihalten (3 breit, 3 hoch ueber dem Spawn).
        for ($dx = -1; $dx <= 2; $dx++) {
            for ($dy = -2; $dy <= 0; $dy++) {
                $blocked[($level['spawn']['x'] + $dx) . ',' . ($level['spawn']['y'] + $dy)] = true;
            }
        }

        // Zielbereich freihalten (Fahne ist 1x2 Kacheln hoch, plus Rand).
        for ($dx = -1; $dx <= 1; $dx++) {
            for ($dy = -2; $dy <= 1; $dy++) {
                $blocked[($level['goal']['x'] + $dx) . ',' . ($level['goal']['y'] + $dy)] = true;
            }
        }

        return $blocked;
    }

    public static function inBounds(int $x, int $y): bool
    {
        return $x >= 0 && $y >= 0 && $x < self::COLS && $y < self::ROWS;
    }
}
