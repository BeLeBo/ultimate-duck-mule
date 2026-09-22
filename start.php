<?php
/**
 * Startet Ultimate Duck Mule.
 *
 *   php start.php            Server auf http://localhost:8000
 *   php start.php 8080       anderer Port
 *   php start.php --lan      auch fuer andere Geraete im WLAN erreichbar
 *   php start.php --check    nur pruefen, nicht starten
 *
 * Der Server bekommt sein Wurzelverzeichnis immer aus __DIR__. Egal, aus
 * welchem Ordner dieses Skript aufgerufen wird - "No such file or directory"
 * kann damit nicht mehr passieren.
 *
 * Diese Datei benutzt absichtlich sehr alte PHP-Syntax, damit auch eine
 * veraltete PHP-Version noch bis zur Versionspruefung kommt.
 */

define('UDM_MIN_PHP', '7.4.0');

// Nur fuer das Terminal gedacht. Im Browser aufgerufen (etwa ueber einen
// bereits laufenden Webserver) gibt es hier nichts zu holen.
if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><meta charset="utf-8"><title>Ultimate Duck Mule</title>'
        . '<body style="font-family:system-ui;padding:40px;line-height:1.6">'
        . '<h1>Hier geht es nicht weiter</h1>'
        . '<p><code>start.php</code> ist nur fuer den Start im Terminal gedacht.</p>'
        . '<p>Das Spiel liegt unter <a href="index.php">index.php</a>.</p>';
    exit;
}

$root = __DIR__;
$argv = isset($argv) ? $argv : [];
$argc = isset($argc) ? $argc : count($argv);
$port = 8000;
$lan = false;
$checkOnly = false;

for ($i = 1; $i < $argc; $i++) {
    $arg = $argv[$i];
    if ($arg === '--lan') {
        $lan = true;
    } elseif ($arg === '--check') {
        $checkOnly = true;
    } elseif ($arg === '--help' || $arg === '-h') {
        echo "Aufruf: php start.php [port] [--lan] [--check]\n";
        exit(0);
    } elseif (preg_match('/^\d+$/', $arg)) {
        $port = (int) $arg;
    } else {
        echo "Unbekannte Option: " . $arg . "\n";
        exit(1);
    }
}

echo "\n  Ultimate Duck Mule\n";
echo "  ------------------\n\n";

$problems = [];
$notes = [];

/* ------------------------------------------------------------ PHP-Version */

if (version_compare(PHP_VERSION, UDM_MIN_PHP, '<')) {
    $problems[] = "PHP " . PHP_VERSION . " ist zu alt, gebraucht wird mindestens " . UDM_MIN_PHP . ".\n"
        . "       Unter Linux Mint / Ubuntu:  sudo apt install php-cli";
} else {
    $notes[] = "PHP " . PHP_VERSION . " (" . PHP_BINARY . ")";
}

/* --------------------------------------------------------- Dateien da? */

$required = [
    'index.php', 'game.php', 'api/index.php',
    'lib/Cards.php', 'lib/Game.php', 'lib/Levels.php', 'lib/Rooms.php', 'lib/View.php',
    'assets/css/style.css',
    'assets/js/core.js', 'assets/js/level.js', 'assets/js/player.js',
    'assets/js/render.js', 'assets/js/input.js', 'assets/js/net.js', 'assets/js/game.js',
];

$missing = [];
foreach ($required as $file) {
    if (!is_file($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $file))) {
        $missing[] = $file;
    }
}
if ($missing) {
    $problems[] = "Diese Dateien fehlen im Ordner " . $root . ":\n       - " . implode("\n       - ", $missing)
        . "\n       Ist das Projekt vollstaendig heruntergeladen?";
} else {
    $notes[] = count($required) . " Projektdateien gefunden";
}

/* ------------------------------------------------- Raumordner beschreibbar */

$roomDir = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'rooms';
if (!is_dir($roomDir)) {
    @mkdir($roomDir, 0775, true);
}
if (!is_dir($roomDir)) {
    $problems[] = "Der Ordner data/rooms laesst sich nicht anlegen.";
} elseif (!is_writable($roomDir)) {
    $problems[] = "Der Ordner data/rooms ist nicht beschreibbar - der Online-Modus wuerde scheitern.\n"
        . "       Reparieren mit:  chmod -R u+w " . $roomDir;
} else {
    $notes[] = "data/rooms ist beschreibbar";
}

if (!extension_loaded('json')) {
    $problems[] = "Die PHP-Erweiterung 'json' fehlt (sudo apt install php-json).";
}

// mbstring ist nicht noetig, aber gut zu wissen - falls doch mal etwas
// danach fragt, steht es direkt in der Startausgabe.
$optional = [];
foreach (['mbstring', 'intl'] as $ext) {
    $optional[] = $ext . ': ' . (extension_loaded($ext) ? 'da' : 'fehlt (wird nicht gebraucht)');
}
$notes[] = "Erweiterungen - " . implode(', ', $optional);

/* -------------------------------------------------------------- Ausgabe */

foreach ($notes as $note) {
    echo "  [ok] " . $note . "\n";
}
if ($problems) {
    echo "\n";
    foreach ($problems as $problem) {
        echo "  [!!] " . $problem . "\n";
    }
    echo "\n";
    exit(1);
}

if ($checkOnly) {
    echo "\n  Alles in Ordnung. Starten mit:  php start.php\n\n";
    exit(0);
}

/* ------------------------------------------------------- Freien Port suchen */

function udm_port_frei($host, $port)
{
    $socket = @stream_socket_server("tcp://" . $host . ":" . $port, $errno, $errstr);
    if ($socket === false) {
        return false;
    }
    fclose($socket);
    return true;
}

$host = $lan ? '0.0.0.0' : '127.0.0.1';
$wunschPort = $port;
$gefunden = false;
for ($try = 0; $try < 12; $try++) {
    if (udm_port_frei($host, $port)) {
        $gefunden = true;
        break;
    }
    $port++;
}
if (!$gefunden) {
    echo "  [!!] Kein freier Port zwischen " . $wunschPort . " und " . $port . " gefunden.\n\n";
    exit(1);
}
if ($port !== $wunschPort) {
    echo "  [ok] Port " . $wunschPort . " ist belegt, benutze " . $port . "\n";
}

/* -------------------------------------------------------- LAN-Adresse */

function udm_lan_ip()
{
    $socket = @stream_socket_client('udp://8.8.8.8:53', $errno, $errstr, 1);
    if ($socket) {
        $name = @stream_socket_get_name($socket, false);
        fclose($socket);
        if ($name && strrpos($name, ':') !== false) {
            return substr($name, 0, strrpos($name, ':'));
        }
    }
    $ip = @gethostbyname(@gethostname());
    return ($ip && $ip !== gethostname()) ? $ip : null;
}

echo "\n  Spiel laeuft:   http://localhost:" . $port . "/\n";
if ($lan) {
    $ip = udm_lan_ip();
    if ($ip) {
        echo "  Im WLAN:        http://" . $ip . ":" . $port . "/   (fuer Mitspieler am selben Router)\n";
    }
} else {
    echo "  Selbsttest:     http://localhost:" . $port . "/tests.php\n";
    echo "  Tipp: 'php start.php --lan' macht das Spiel fuer Mitspieler im WLAN erreichbar.\n";
}
echo "\n  Beenden mit Strg+C\n\n";

/* ------------------------------------------------------------- Starten */

// display_errors: ein PHP-Fehler soll im Browser lesbar stehen statt als
// nackte "500 Internal Server Error"-Seite des Browsers zu enden.
$command = escapeshellarg(PHP_BINARY)
    . ' -d display_errors=1 -d error_reporting=-1'
    . ' -S ' . $host . ':' . $port
    . ' -t ' . escapeshellarg($root);

if (!function_exists('passthru') || in_array('passthru', array_map('trim', explode(',', (string) ini_get('disable_functions'))), true)) {
    echo "  passthru() ist deaktiviert. Bitte diesen Befehl von Hand ausfuehren:\n\n";
    echo "  " . $command . "\n\n";
    exit(1);
}

passthru($command, $exitCode);
exit((int) $exitCode);
