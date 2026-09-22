<?php
declare(strict_types=1);

/** Kleine Helfer für die HTML-Seiten. */
final class View
{
    /**
     * Tab-Symbol als eingebettetes SVG.
     *
     * Ohne diese Zeile fragt der Browser /favicon.ico an; der eingebaute
     * PHP-Server liefert dafür ersatzweise die komplette index.php aus.
     */
    public static function favicon(): string
    {
        // Einfache Anführungszeichen im SVG: doppelte würden das
        // href-Attribut vorzeitig beenden. '#' muss als %23 kodiert sein.
        $svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
            . "<rect width='32' height='32' rx='7' fill='%2312142a'/>"
            . "<circle cx='14' cy='18' r='8.5' fill='%23ffcb3d'/>"
            . "<path d='M21 16h8l-2.5 4.5H21z' fill='%23ff9f1c'/>"
            . "<circle cx='16.5' cy='15.5' r='2.4' fill='%23ffffff'/>"
            . "<circle cx='17.3' cy='15.5' r='1.2' fill='%2320222b'/>"
            . "</svg>";

        return '<link rel="icon" href="data:image/svg+xml,' . $svg . '">';
    }
}
