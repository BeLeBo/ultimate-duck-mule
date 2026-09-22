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
    /**
     * Alle Bauteile sind Hindernisse.
     *
     * Die Level lassen sich ohne ein einziges Bauteil schaffen - gebaut wird
     * ausschliesslich, um den anderen den Weg zu verderben. Entsprechend
     * gibt es hier nichts, womit man irgendwo hinaufklettern koennte.
     *
     * Groessere Teile tragen w/h in Kacheln; ohne Angabe ist ein Bauteil 1x1.
     *
     * @var array<string, array{name:string, desc:string, weight:int, rotatable:bool, w?:int, h?:int}>
     */
    public const CATALOG = [
        'stone' => [
            'name' => 'Steinblock',
            'desc' => 'Versperrt den Weg. Schlicht und wirkungsvoll.',
            'weight' => 9,
            'rotatable' => false,
        ],
        'beam' => [
            'name' => 'Balken',
            'desc' => 'Drei Kacheln breite Plattform. Riegelt ganze Wege ab.',
            'weight' => 6,
            'rotatable' => false,
            'w' => 3,
            'h' => 1,
        ],
        'wall' => [
            'name' => 'Mauer',
            'desc' => 'Drei Kacheln hoch. Da kommt niemand drüber.',
            'weight' => 6,
            'rotatable' => false,
            'w' => 1,
            'h' => 3,
        ],
        'slab' => [
            'name' => 'Betonklotz',
            'desc' => 'Zwei mal zwei Kacheln massiv im Weg.',
            'weight' => 5,
            'rotatable' => false,
            'w' => 2,
            'h' => 2,
        ],
        'ice' => [
            'name' => 'Eisblock',
            'desc' => 'Versperrt den Weg – und wer oben landet, rutscht weiter.',
            'weight' => 7,
            'rotatable' => false,
        ],
        'crumble' => [
            'name' => 'Bruchblock',
            'desc' => 'Sieht nach sicherem Halt aus und bricht dann weg.',
            'weight' => 6,
            'rotatable' => false,
        ],
        'honey' => [
            'name' => 'Klebeblock',
            'desc' => 'Wer hier drüber muss, kriecht nur noch.',
            'weight' => 6,
            'rotatable' => false,
        ],
        'oil' => [
            'name' => 'Ölpfütze',
            'desc' => 'Nicht solide, dafür spiegelglatt. Legt sich auf den Boden.',
            'weight' => 7,
            'rotatable' => false,
        ],
        'conveyor' => [
            'name' => 'Förderband',
            'desc' => 'Schiebt in Pfeilrichtung – am besten genau rückwärts.',
            'weight' => 6,
            'rotatable' => true,
        ],
        'fan' => [
            'name' => 'Ventilator',
            'desc' => 'Bläst über 5 Felder und wirft aus der Bahn.',
            'weight' => 5,
            'rotatable' => true,
        ],
        'bounce' => [
            'name' => 'Sprungblock',
            'desc' => 'Schleudert jeden unkontrolliert davon.',
            'weight' => 5,
            'rotatable' => false,
        ],
        'spike' => [
            'name' => 'Stacheln',
            'desc' => 'Tödlich. Zeigen in die gewählte Richtung.',
            'weight' => 9,
            'rotatable' => true,
        ],
        'saw' => [
            'name' => 'Kreissäge',
            'desc' => 'Pendelt tödlich auf ihrer Schiene hin und her.',
            'weight' => 6,
            'rotatable' => true,
        ],
        'wrecker' => [
            'name' => 'Pendel',
            'desc' => 'Tödliche Kugel an der Kette, schwingt unter dem Anker.',
            'weight' => 5,
            'rotatable' => false,
        ],
        'arrow' => [
            'name' => 'Pfeilfalle',
            'desc' => 'Schießt alle 1,7 Sekunden einen Pfeil.',
            'weight' => 6,
            'rotatable' => true,
        ],
    ];

    /**
     * Power-ups: Karten, die kein Bauteil setzen, sondern den eigenen Zug
     * verbessern. Sie liegen zusaetzlich zu den Bauteilen auf der Hand.
     *
     * @var array<string, array{name:string, desc:string, weight:int, target:bool}>
     */
    public const POWERUPS = [
        'pu_extra' => [
            'name' => 'Doppelbau',
            'desc' => 'Du darfst in diesem Zug ein Bauteil mehr setzen.',
            'weight' => 4,
            'target' => false,
        ],
        'pu_remove' => [
            'name' => 'Abrissbirne',
            'desc' => 'Eine zusätzliche Löschung: entferne ein Bauteil deiner Wahl.',
            'weight' => 4,
            'target' => false,
        ],
        'pu_bomb' => [
            'name' => 'Sprengladung',
            'desc' => 'Räumt alle Bauteile in einem 3×3-Feld deiner Wahl.',
            'weight' => 2,
            'target' => true,
        ],
        'pu_redraw' => [
            'name' => 'Neue Karten',
            'desc' => 'Wirf deine übrigen Karten ab und ziehe neue.',
            'weight' => 3,
            'target' => false,
        ],
    ];

    /** Chance (in Prozent), dass die letzte Handkarte ein Power-up ist. */
    public const POWERUP_CHANCE = 40;

    public static function isPowerUp(string $id): bool
    {
        return isset(self::POWERUPS[$id]);
    }

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
     * Groesse eines Bauteils in Kacheln.
     *
     * @return array{w:int, h:int}
     */
    public static function size(string $id): array
    {
        return [
            'w' => max(1, (int) (self::CATALOG[$id]['w'] ?? 1)),
            'h' => max(1, (int) (self::CATALOG[$id]['h'] ?? 1)),
        ];
    }

    /**
     * Zieht eine Hand: mindestens alle Karten bis auf eine sind Bauteile,
     * die letzte ist mit POWERUP_CHANCE Prozent ein Power-up. So hat jeder
     * immer etwas zum Bauen.
     *
     * @return list<string>
     */
    public static function deal(int $size = 4): array
    {
        if (random_int(1, 100) <= self::POWERUP_CHANCE) {
            $hand = self::dealBlocks($size - 1);
            $hand[] = self::weightedPick(self::POWERUPS);

            return $hand;
        }

        return self::dealBlocks($size);
    }

    /**
     * Nur Bauteile, ohne Doubletten.
     *
     * @return list<string>
     */
    public static function dealBlocks(int $size): array
    {
        $hand = [];
        $guard = 0;
        while (count($hand) < $size && $guard < 500) {
            $guard++;
            $pick = self::weightedPick(self::CATALOG);
            if (!in_array($pick, $hand, true)) {
                $hand[] = $pick;
            }
        }

        return $hand;
    }

    /** @param array<string, array{weight:int}> $catalog */
    private static function weightedPick(array $catalog): string
    {
        $total = 0;
        foreach ($catalog as $card) {
            $total += $card['weight'];
        }
        $roll = random_int(1, $total);
        foreach ($catalog as $id => $card) {
            $roll -= $card['weight'];
            if ($roll <= 0) {
                return $id;
            }
        }

        return (string) array_key_first($catalog);
    }
}
