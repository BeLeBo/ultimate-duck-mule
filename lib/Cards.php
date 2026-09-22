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
     * @var array<string, array{name:string, desc:string, weight:int, rotatable:bool}>
     */
    public const CATALOG = [
        'stone' => [
            'name' => 'Steinblock',
            'desc' => 'Versperrt den Weg. Schlicht und wirkungsvoll.',
            'weight' => 9,
            'rotatable' => false,
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
