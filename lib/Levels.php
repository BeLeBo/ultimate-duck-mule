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

    /** @return list<array<string, mixed>> */
    public static function all(): array
    {
        return [
            [
                'id' => 'wiese',
                'name' => 'Wiesenweg',
                'theme' => 'day',
                'spawn' => ['x' => 3, 'y' => 17],
                'goal' => ['x' => 35, 'y' => 17],
                'rects' => [
                    ['x' => 0, 'y' => 18, 'w' => 8, 'h' => 5, 't' => 'ground'],
                    ['x' => 15, 'y' => 16, 'w' => 4, 'h' => 7, 't' => 'ground'],
                    ['x' => 24, 'y' => 13, 'w' => 4, 'h' => 1, 't' => 'oneway'],
                    ['x' => 32, 'y' => 18, 'w' => 8, 'h' => 5, 't' => 'ground'],
                    ['x' => 38, 'y' => 12, 'w' => 2, 'h' => 6, 't' => 'rock'],
                ],
            ],
            [
                'id' => 'turm',
                'name' => 'Turmklettern',
                'theme' => 'dusk',
                'spawn' => ['x' => 2, 'y' => 20],
                'goal' => ['x' => 32, 'y' => 4],
                'rects' => [
                    ['x' => 0, 'y' => 21, 'w' => 40, 'h' => 2, 't' => 'ground'],
                    ['x' => 9, 'y' => 17, 'w' => 5, 'h' => 1, 't' => 'ground'],
                    ['x' => 2, 'y' => 13, 'w' => 5, 'h' => 1, 't' => 'ground'],
                    ['x' => 12, 'y' => 9, 'w' => 6, 'h' => 1, 't' => 'ground'],
                    ['x' => 36, 'y' => 6, 'w' => 4, 'h' => 15, 't' => 'rock'],
                    ['x' => 29, 'y' => 5, 'w' => 7, 'h' => 1, 't' => 'ground'],
                    ['x' => 22, 'y' => 12, 'w' => 3, 'h' => 1, 't' => 'oneway'],
                ],
            ],
            [
                'id' => 'kluft',
                'name' => 'Die Kluft',
                'theme' => 'night',
                'spawn' => ['x' => 3, 'y' => 13],
                'goal' => ['x' => 35, 'y' => 13],
                'rects' => [
                    ['x' => 0, 'y' => 14, 'w' => 10, 'h' => 9, 't' => 'rock'],
                    ['x' => 30, 'y' => 14, 'w' => 10, 'h' => 9, 't' => 'rock'],
                    ['x' => 18, 'y' => 10, 'w' => 4, 'h' => 1, 't' => 'ground'],
                    ['x' => 8, 'y' => 6, 'w' => 4, 'h' => 1, 't' => 'oneway'],
                    ['x' => 27, 'y' => 6, 'w' => 4, 'h' => 1, 't' => 'oneway'],
                    ['x' => 0, 'y' => 7, 'w' => 2, 'h' => 7, 't' => 'rock'],
                    ['x' => 38, 'y' => 7, 'w' => 2, 'h' => 7, 't' => 'rock'],
                ],
            ],
            [
                'id' => 'doppeldecker',
                'name' => 'Doppeldecker',
                'theme' => 'sunset',
                'spawn' => ['x' => 3, 'y' => 20],
                'goal' => ['x' => 35, 'y' => 11],
                'rects' => [
                    ['x' => 0, 'y' => 21, 'w' => 40, 'h' => 2, 't' => 'ground'],
                    ['x' => 0, 'y' => 13, 'w' => 14, 'h' => 2, 't' => 'ground'],
                    ['x' => 26, 'y' => 13, 'w' => 14, 'h' => 2, 't' => 'ground'],
                    ['x' => 0, 'y' => 15, 'w' => 2, 'h' => 6, 't' => 'rock'],
                    ['x' => 38, 'y' => 15, 'w' => 2, 'h' => 6, 't' => 'rock'],
                    ['x' => 19, 'y' => 17, 'w' => 3, 'h' => 1, 't' => 'oneway'],
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
