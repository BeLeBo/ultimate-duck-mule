<?php
declare(strict_types=1);

/**
 * Katalog aller Bauteile ("Karten"), die ein Spieler in der Bauphase setzen kann.
 *
 * Die Datei ist die serverseitige Wahrheit fuer Namen, Gewichte und Drehbarkeit.
 * Das Verhalten (Physik + Grafik) lebt in assets/js/blocks.js unter denselben IDs.
 */
final class Cards
{
    /** @var array<string, array{name:string, desc:string, weight:int, rotatable:bool}> */
    public const CATALOG = [
        'stone' => [
            'name' => 'Steinblock',
            'desc' => 'Solider Block. Langweilig, aber zuverlaessig.',
            'weight' => 10,
            'rotatable' => false,
        ],
        'ice' => [
            'name' => 'Eisblock',
            'desc' => 'Solide, aber spiegelglatt.',
            'weight' => 7,
            'rotatable' => false,
        ],
        'bounce' => [
            'name' => 'Sprungblock',
            'desc' => 'Katapultiert alles, was darauf landet.',
            'weight' => 7,
            'rotatable' => false,
        ],
        'crumble' => [
            'name' => 'Bruchblock',
            'desc' => 'Bricht kurz nach der Beruehrung weg.',
            'weight' => 6,
            'rotatable' => false,
        ],
        'cloud' => [
            'name' => 'Wolke',
            'desc' => 'Einweg-Plattform: von unten durchspringbar.',
            'weight' => 6,
            'rotatable' => false,
        ],
        'conveyor' => [
            'name' => 'Foerderband',
            'desc' => 'Schiebt alles in Pfeilrichtung.',
            'weight' => 6,
            'rotatable' => true,
        ],
        'honey' => [
            'name' => 'Klebeblock',
            'desc' => 'Bremst gnadenlos, laesst sich aber beklettern.',
            'weight' => 5,
            'rotatable' => false,
        ],
        'ladder' => [
            'name' => 'Leiter',
            'desc' => 'Zum Hochklettern. Nicht solide.',
            'weight' => 5,
            'rotatable' => false,
        ],
        'fan' => [
            'name' => 'Ventilator',
            'desc' => 'Blaest einen Luftstrom ueber 5 Felder.',
            'weight' => 5,
            'rotatable' => true,
        ],
        'spike' => [
            'name' => 'Stacheln',
            'desc' => 'Toedlich. Zeigen in die gewaehlte Richtung.',
            'weight' => 8,
            'rotatable' => true,
        ],
        'saw' => [
            'name' => 'Kreissaege',
            'desc' => 'Pendelt toedlich hin und her.',
            'weight' => 6,
            'rotatable' => true,
        ],
        'arrow' => [
            'name' => 'Pfeilfalle',
            'desc' => 'Schiesst alle 1,7 Sekunden einen Pfeil.',
            'weight' => 5,
            'rotatable' => true,
        ],
    ];

    /** @return list<string> */
    public static function ids(): array
    {
        return array_keys(self::CATALOG);
    }

    public static function exists(string $id): bool
    {
        return isset(self::CATALOG[$id]);
    }

    public static function isRotatable(string $id): bool
    {
        return self::CATALOG[$id]['rotatable'] ?? false;
    }

    /**
     * Zieht eine Hand aus gewichteten Karten - ohne Doubletten, solange genug
     * verschiedene Karten existieren.
     *
     * @return list<string>
     */
    public static function deal(int $size = 4): array
    {
        $pool = [];
        foreach (self::CATALOG as $id => $card) {
            for ($i = 0; $i < $card['weight']; $i++) {
                $pool[] = $id;
            }
        }

        $hand = [];
        $guard = 0;
        while (count($hand) < $size && $guard < 500) {
            $guard++;
            $pick = $pool[random_int(0, count($pool) - 1)];
            if (!in_array($pick, $hand, true)) {
                $hand[] = $pick;
            }
        }

        return $hand;
    }
}
