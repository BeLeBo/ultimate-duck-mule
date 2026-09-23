<?php
declare(strict_types=1);

/**
 * JSON-Schnittstelle fuer den Online-Modus.
 *
 * Aufruf: POST api/index.php mit {"action": "...", ...} als JSON-Body.
 * Antwort: {"ok": true, ...} oder {"ok": false, "error": "..."}.
 */

require_once __DIR__ . '/../lib/Rooms.php';
require_once __DIR__ . '/../lib/Game.php';
require_once __DIR__ . '/../lib/Cards.php';
require_once __DIR__ . '/../lib/Levels.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/**
 * Beendet den Request mit einer JSON-Antwort.
 *
 * Bewusst ohne "never"-Rueckgabetyp, damit die Datei auch auf PHP 7.4 laeuft.
 *
 * @param array<string, mixed> $payload
 * @return void Kehrt nie zurueck.
 */
function respond(array $payload, int $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** @return void Kehrt nie zurueck. */
function fail(string $message, int $status = 400)
{
    respond(['ok' => false, 'error' => $message], $status);
}

/** @return array<string, mixed> */
function input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return $_POST;
    }
    $data = json_decode($raw, true);

    return is_array($data) ? $data : [];
}

function str_field(array $data, string $key, string $default = ''): string
{
    $value = $data[$key] ?? $default;

    return is_scalar($value) ? (string) $value : $default;
}

function int_field(array $data, string $key, int $default = 0): int
{
    $value = $data[$key] ?? $default;

    return is_numeric($value) ? (int) $value : $default;
}

/**
 * Holt Raumcode und Token aus der Anfrage und prueft beide.
 *
 * @param array<string, mixed> $data
 * @return array{0:string,1:string}
 */
function credentials(array $data): array
{
    $code = strtoupper(trim(str_field($data, 'code')));
    $token = trim(str_field($data, 'token'));
    if (!Rooms::isValidCode($code)) {
        fail('Ungueltiger Raumcode.', 404);
    }
    if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
        fail('Ungueltiges Spieler-Token.', 403);
    }
    if (!Rooms::exists($code)) {
        fail('Diesen Raum gibt es nicht (mehr).', 404);
    }

    return [$code, $token];
}

/**
 * Aktualisiert Lebenszeichen und Position und laesst den Raum weiterlaufen.
 *
 * @param array<string, mixed> $room
 * @param array<string, mixed> $data
 */
function heartbeat(array &$room, string $token, array $data): void
{
    if (!isset($room['players'][$token])) {
        return;
    }
    $room['players'][$token]['lastSeen'] = time();

    $pos = $data['pos'] ?? null;
    if (is_array($pos) && $room['phase'] === 'party') {
        $room['players'][$token]['pos'] = [
            'x' => round((float) ($pos['x'] ?? 0), 1),
            'y' => round((float) ($pos['y'] ?? 0), 1),
            'vx' => round((float) ($pos['vx'] ?? 0), 1),
            'vy' => round((float) ($pos['vy'] ?? 0), 1),
            'face' => ((float) ($pos['face'] ?? 1)) < 0 ? -1 : 1,
            'anim' => in_array($pos['anim'] ?? '', ['idle', 'run', 'jump', 'fall', 'wall', 'glide', 'dead', 'done'], true)
                ? (string) $pos['anim']
                : 'idle',
            // Schutzschild noch da? Die anderen sehen dann die Blase.
            'shield' => (bool) ($pos['shield'] ?? false),
            't' => microtime(true),
        ];
    }

    // Der Bauende meldet, was er gerade vorhat - die anderen sehen zu.
    $build = $data['build'] ?? null;
    if (is_array($build) && $room['phase'] === 'build' && Game::currentBuilder($room) === $token) {
        $room['buildView'] = [
            'slot' => (int) $room['players'][$token]['slot'],
            'card' => max(-1, min(8, (int) ($build['card'] ?? -1))),
            'rot' => (((int) ($build['rot'] ?? 0)) % 4 + 4) % 4,
            // Zielt gerade mit der Abrissbirne.
            'deleting' => (bool) ($build['deleting'] ?? false),
            'tx' => max(-1, min(Levels::COLS - 1, (int) ($build['tx'] ?? -1))),
            'ty' => max(-1, min(Levels::ROWS - 1, (int) ($build['ty'] ?? -1))),
        ];
    }

    Game::tick($room);
}

$data = input();
$action = str_field($data, 'action');

try {
    switch ($action) {
        case 'create':
            Rooms::sweep();
            $code = Rooms::newCode();
            $room = Game::newRoom($code, int_field($data, 'rounds', Game::DEFAULT_ROUNDS), str_field($data, 'level') ?: null);
            $token = Game::addPlayer($room, str_field($data, 'name'), str_field($data, 'char'));
            Rooms::create($room);
            respond([
                'ok' => true,
                'code' => $code,
                'token' => $token,
                'state' => Game::publicState($room, $token),
            ]);
            // no break

        case 'join':
            $code = strtoupper(trim(str_field($data, 'code')));
            if (!Rooms::isValidCode($code) || !Rooms::exists($code)) {
                fail('Diesen Raum gibt es nicht.', 404);
            }
            $token = null;
            $room = Rooms::mutate($code, function (array $room) use ($data, &$token): array {
                $token = Game::addPlayer($room, str_field($data, 'name'), str_field($data, 'char'));
                Game::touch($room);

                return $room;
            });
            respond([
                'ok' => true,
                'code' => $code,
                'token' => $token,
                'state' => Game::publicState($room, $token),
            ]);
            // no break

        case 'state':
            [$code, $token] = credentials($data);
            $room = Rooms::mutate($code, function (array $room) use ($token, $data): ?array {
                if (!isset($room['players'][$token])) {
                    return null;
                }
                heartbeat($room, $token, $data);

                return $room;
            });
            if (!isset($room['players'][$token])) {
                fail('Du bist nicht (mehr) in diesem Raum.', 403);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'start':
            [$code, $token] = credentials($data);
            $error = null;
            $room = Rooms::mutate($code, function (array $room) use ($token, $data, &$error): array {
                heartbeat($room, $token, $data);
                try {
                    Game::startMatch($room, $token);
                } catch (Throwable $e) {
                    $error = $e->getMessage();
                }

                return $room;
            });
            if ($error !== null) {
                fail($error, 409);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'place':
            [$code, $token] = credentials($data);
            $error = null;
            $room = Rooms::mutate($code, function (array $room) use ($token, $data, &$error): array {
                heartbeat($room, $token, $data);
                try {
                    Game::place(
                        $room,
                        $token,
                        int_field($data, 'card', -1),
                        int_field($data, 'x', -1),
                        int_field($data, 'y', -1),
                        int_field($data, 'rot', 0)
                    );
                } catch (Throwable $e) {
                    $error = $e->getMessage();
                }

                return $room;
            });
            if ($error !== null) {
                respond(['ok' => false, 'error' => $error, 'state' => Game::publicState($room, $token)], 409);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'power':
            [$code, $token] = credentials($data);
            $error = null;
            $room = Rooms::mutate($code, function (array $room) use ($token, $data, &$error): array {
                heartbeat($room, $token, $data);
                try {
                    Game::usePower(
                        $room,
                        $token,
                        int_field($data, 'card', -1),
                        int_field($data, 'x', -1),
                        int_field($data, 'y', -1)
                    );
                } catch (Throwable $e) {
                    $error = $e->getMessage();
                }

                return $room;
            });
            if ($error !== null) {
                respond(['ok' => false, 'error' => $error, 'state' => Game::publicState($room, $token)], 409);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'settings':
            [$code, $token] = credentials($data);
            $error = null;
            $room = Rooms::mutate($code, function (array $room) use ($token, $data, &$error): array {
                heartbeat($room, $token, $data);
                try {
                    Game::updateSettings(
                        $room,
                        $token,
                        str_field($data, 'level'),
                        int_field($data, 'rounds', Game::DEFAULT_ROUNDS)
                    );
                } catch (Throwable $e) {
                    $error = $e->getMessage();
                }

                return $room;
            });
            if ($error !== null) {
                respond(['ok' => false, 'error' => $error, 'state' => Game::publicState($room, $token)], 409);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'skip':
            [$code, $token] = credentials($data);
            $room = Rooms::mutate($code, function (array $room) use ($token, $data): array {
                heartbeat($room, $token, $data);
                Game::skipBuild($room, $token);

                return $room;
            });
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'result':
            [$code, $token] = credentials($data);
            $room = Rooms::mutate($code, function (array $room) use ($token, $data): array {
                heartbeat($room, $token, $data);
                Game::reportResult($room, $token, [
                    'finished' => (bool) ($data['finished'] ?? false),
                    'time' => $data['time'] ?? 0,
                    'killerSlot' => $data['killerSlot'] ?? null,
                    'assistSlot' => $data['assistSlot'] ?? null,
                    'killerBlock' => $data['killerBlock'] ?? null,
                    'assistBlock' => $data['assistBlock'] ?? null,
                    'cause' => str_field($data, 'cause'),
                ]);

                return $room;
            });
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'ready':
            [$code, $token] = credentials($data);
            $error = null;
            $room = Rooms::mutate($code, function (array $room) use ($token, $data, &$error): array {
                heartbeat($room, $token, $data);
                try {
                    Game::ready($room, $token);
                } catch (Throwable $e) {
                    $error = $e->getMessage();
                }

                return $room;
            });
            if ($error !== null) {
                respond(['ok' => false, 'error' => $error, 'state' => Game::publicState($room, $token)], 409);
            }
            respond(['ok' => true, 'state' => Game::publicState($room, $token)]);
            // no break

        case 'leave':
            [$code, $token] = credentials($data);
            $room = Rooms::mutate($code, function (array $room) use ($token): array {
                if (isset($room['players'][$token])) {
                    Game::log($room, Game::nameOf($room, $token) . ' hat den Raum verlassen.');
                    $room['players'][$token]['lastSeen'] = 0;
                    Game::touch($room);
                }
                Game::tick($room);

                return $room;
            });
            if (Game::connectedTokens($room) === []) {
                Rooms::delete($code);
            }
            respond(['ok' => true]);
            // no break

        default:
            fail('Unbekannte Aktion.', 400);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
