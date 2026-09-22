<?php
declare(strict_types=1);

/**
 * Persistenz der Online-Raeume.
 *
 * Ein Raum = eine JSON-Datei unter data/rooms/<CODE>.json. Jeder schreibende
 * Zugriff laeuft ueber mutate() und haelt dabei eine exklusive Dateisperre,
 * damit parallele Requests sich nicht gegenseitig ueberschreiben.
 */
final class Rooms
{
    /** Raeume, die so lange nicht angefasst wurden, gelten als tot (Sekunden). */
    public const ROOM_TTL = 7200;

    /** Spieler, die sich so lange nicht gemeldet haben, gelten als offline. */
    public const PLAYER_TIMEOUT = 25;

    private const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function dir(): string
    {
        $dir = dirname(__DIR__) . '/data/rooms';
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Raumverzeichnis kann nicht angelegt werden.');
        }

        return $dir;
    }

    public static function isValidCode(string $code): bool
    {
        return (bool) preg_match('/^[A-Z0-9]{4,6}$/', $code);
    }

    public static function path(string $code): string
    {
        if (!self::isValidCode($code)) {
            throw new InvalidArgumentException('Ungueltiger Raumcode.');
        }

        return self::dir() . '/' . $code . '.json';
    }

    public static function exists(string $code): bool
    {
        return self::isValidCode($code) && is_file(self::path($code));
    }

    public static function newCode(): string
    {
        for ($attempt = 0; $attempt < 40; $attempt++) {
            $code = '';
            for ($i = 0; $i < 4; $i++) {
                $code .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
            }
            if (!self::exists($code)) {
                return $code;
            }
        }

        throw new RuntimeException('Es konnte kein freier Raumcode gefunden werden.');
    }

    public static function newToken(): string
    {
        return bin2hex(random_bytes(16));
    }

    /** @param array<string, mixed> $room */
    public static function create(array $room): void
    {
        $path = self::path($room['code']);
        $handle = fopen($path, 'xb');
        if ($handle === false) {
            throw new RuntimeException('Raum existiert bereits.');
        }
        try {
            fwrite($handle, self::encode($room));
        } finally {
            fclose($handle);
        }
    }

    /** @return array<string, mixed>|null */
    public static function read(string $code): ?array
    {
        $path = self::path($code);
        $raw = @file_get_contents($path);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);

        return is_array($data) ? $data : null;
    }

    /**
     * Liest den Raum, laesst ihn vom Callback veraendern und schreibt ihn zurueck.
     * Gibt der Callback null zurueck, bleibt die Datei unveraendert.
     *
     * @template T
     * @param callable(array<string, mixed>): (array<string, mixed>|null) $mutator
     * @return array<string, mixed> Der Raum nach dem Aufruf.
     */
    public static function mutate(string $code, callable $mutator): array
    {
        $path = self::path($code);
        $handle = fopen($path, 'cb+');
        if ($handle === false) {
            throw new RuntimeException('Raum nicht gefunden.');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Raum ist gerade gesperrt.');
            }

            $raw = stream_get_contents($handle);
            $room = json_decode((string) $raw, true);
            if (!is_array($room)) {
                throw new RuntimeException('Raum nicht gefunden.');
            }

            $updated = $mutator($room);
            if ($updated === null) {
                return $room;
            }

            $updated['updated'] = time();
            $encoded = self::encode($updated);

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, $encoded);
            fflush($handle);

            return $updated;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    public static function delete(string $code): void
    {
        @unlink(self::path($code));
    }

    /** Raeumt abgelaufene Raumdateien auf. */
    public static function sweep(): void
    {
        $files = glob(self::dir() . '/*.json') ?: [];
        $now = time();
        foreach ($files as $file) {
            $mtime = @filemtime($file);
            if ($mtime !== false && $now - $mtime > self::ROOM_TTL) {
                @unlink($file);
            }
        }
    }

    /** @param array<string, mixed> $room */
    private static function encode(array $room): string
    {
        $json = json_encode($room, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('Raum konnte nicht serialisiert werden.');
        }

        return $json;
    }
}
