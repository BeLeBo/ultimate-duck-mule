# Ultimate Duck Mule

Ein Party-Plattformer im Stil von *Ultimate Chicken Horse* für **2 bis 4 Spieler** –
gebaut ausschließlich mit **PHP, HTML, JavaScript und CSS**. Kein Build-Schritt,
keine Abhängigkeiten, keine externen Assets: Grafik und Sound werden zur Laufzeit
gezeichnet bzw. synthetisiert.

![Bauphase](docs/screenshot-bauphase.png)

## Worum geht es?

**Jedes Level ist ohne ein einziges Bauteil zu schaffen.** Alles, was gebaut
wird, ist ein Hindernis – es gibt bewusst keine Kletterhilfen. Gebaut wird
also nur, um den anderen den Weg zu verderben.

Jede Runde besteht aus zwei Phasen:

1. **Bauphase** – Der Reihe nach setzt jeder Spieler *ein* Bauteil aus seiner Hand.
   Selbst löschen kann man nichts – das geht nur mit dem Power-up *Abrissbirne*.
   Die Vorschau am Mauszeiger zeigt vorher, was das Bauteil anrichtet.
   **Wer vorne liegt, baut zuerst** – wer hinten liegt, sieht alles und hat das
   letzte Wort; Gleichstand entscheidet das Los. Die anderen sehen im Level, wo
   und wie gebaut wird – die Handkarten des Bauenden bleiben verdeckt.
2. **Partyphase** – Alle starten gleichzeitig und versuchen, die Fahne zu erreichen.
   Nach 60 Sekunden ist Schluss, sobald jemand im Ziel ist, bleiben noch 10. Wer
   stirbt, schaut den Rest der Runde zu; wer feststeckt, kann aufgeben.

**Bauteile bleiben liegen:** Ein Bauteil verschwindet nur, wenn es in einer Runde
**alle Spieler** erwischt hat – eine Falle, an der jeder scheitert, räumt sich
selbst ab. Alles andere bleibt, bis jemand die Abrissbirne darauf ansetzt.

**Kein sofortiges Zurücksetzen:** Wird ein Bauteil entfernt – durch die Abrissbirne
oder weil es alle erwischt hat –, darf bis zum Ende der nächsten Runde niemand
denselben Typ wieder auf diese Stelle setzen. Die gesperrten Stellen sind in der
Bauphase als blasser Umriss zu sehen.

**Sichere Startzone:** Im Startbereich kann niemand bauen, und wer darin steht, ist
unverwundbar. Pfeile zerfallen an ihrem Rand, Sägeschienen und Luftströme enden
davor, Pendel schwingen harmlos hindurch.

Kommt drei Runden hintereinander niemand an, gilt das Level als zugebaut und
wird komplett geräumt – so kann sich ein Match nicht festfahren.

### Punkte

| Ereignis | Punkte |
| --- | --- |
| Ziel erreicht | **+1** |
| Erster im Ziel | **+1** zusätzlich |
| Einziger im Ziel | **+2** zusätzlich |
| Ein Gegner stirbt an einem deiner Bauteile | **+1** pro Opfer |
| Du hast ihn mit Öl oder Ventilator hineingeschoben | **+1** pro Opfer |
| Du stirbst an deinem eigenen Bauteil (Eigentor) | **−1** |

**Erreicht niemand das Ziel, gibt es für die ganze Runde gar nichts** – auch keine
Fallenpunkte. Unter 0 Punkte geht es nicht.

Öl und Ventilator töten nicht selbst, zählen aber: Wer damit jemanden über die
Kante schiebt, bekommt den Kill. Rutscht das Opfer in die Falle eines Dritten,
bekommen **beide** einen Punkt – der Fallensteller und der Nachhelfer. Das gilt nur,
wenn das Opfer wirklich stirbt: Wer nach einem Schubs trotzdem ins Ziel kommt,
aufgibt oder in die Zeit läuft, bringt niemandem Punkte.

Ein Match dauert eine **feste Zahl an Runden** (wählbar 3–20, Standard 8). Wer nach
der letzten Runde die meisten Punkte hat, gewinnt – bei Gleichstand teilen sich die
Führenden den Sieg. **Nochmal spielen** führt zurück in die Lobby, wo der Gastgeber
Welt und Rundenzahl neu wählt und weitere Mitspieler noch beitreten können.

## Starten

Es genügt PHP 7.4 oder neuer – **ohne Zusatzerweiterungen**, ein nacktes
`php-cli` reicht. Empfohlener Weg:

```bash
git clone https://github.com/BeLeBo/ultimate-duck-mule.git
cd ultimate-duck-mule
php start.php
```

`start.php` prüft vorher PHP-Version, Dateien und Schreibrechte, sucht einen
freien Port und startet den Server **immer mit dem richtigen
Wurzelverzeichnis** – es ist egal, aus welchem Ordner du das Skript aufrufst.
Außerdem schaltet er Fehlermeldungen sichtbar, damit ein Problem im Browser
lesbar dasteht statt als nackte „500 Internal Server Error"-Seite.
Danach `http://localhost:8000/` im Browser öffnen.

```bash
php start.php 8080     # anderer Port
php start.php --lan    # auch für Mitspieler im selben WLAN erreichbar
php start.php --check  # nur prüfen, nicht starten
```

Ohne Starter geht es genauso, dann muss man aber selbst im Projektordner
stehen:

```bash
cd ultimate-duck-mule
php -S localhost:8000
```

Alternativ das Verzeichnis auf einen beliebigen Webspace mit PHP legen.
Damit der Online-Modus funktioniert, muss `data/rooms/` für den Webserver
beschreibbar sein (dort liegt pro Raum eine JSON-Datei).

Unter Windows funktioniert `php start.php` in der Eingabeaufforderung
genauso. Wer dort kein PHP installiert hat, kann XAMPP nehmen und den Ordner
nach `C:\xampp\htdocs\` kopieren; das Spiel liegt dann unter
`http://localhost/ultimate-duck-mule/`.

### Wenn etwas nicht läuft

`php start.php --check` prüft Version, Dateien, Schreibrechte und
Erweiterungen, ohne den Server zu starten.

**`404 ... No such file or directory`** – der Server wurde im falschen Ordner
gestartet; `php -S` liefert nur aus *seinem* Verzeichnis aus. Rootrechte
ändern daran nichts, `sudo` hilft hier nicht. Beim Start schreibt PHP die
Zeile `Document root is ...` ins Terminal, dort muss der Ordner stehen, in
dem `index.php` liegt. `php start.php` kann gar nicht im falschen Ordner
landen. Nach dem Entpacken des ZIP von GitHub liegt übrigens alles nochmal
eine Ebene tiefer in `ultimate-duck-mule-<branch>/`.

**Menü lädt, aber „Raum erstellen“ bringt 500** – ein PHP-Fehler in `game.php`.
Die genaue Meldung steht immer im Terminal, in dem der Server läuft; mit
`php start.php` erscheint sie zusätzlich im Browser. Früher passierte das,
wenn `php-mbstring` fehlte – das Spiel kommt inzwischen ohne diese
Erweiterung aus.

## Online spielen

Jeder spielt an seinem eigenen Rechner. Name und Figur trägt man im Menü ein, dann
erstellt einer einen Raum und gibt den vierstelligen Code weiter; bis zu vier
Spieler können beitreten. In der **Lobby** wählt jeder sein **Tier** (Ente,
Maultier, Waschbär, Frosch) und seine **Farbe** (jede gibt es nur einmal pro Raum),
der Gastgeber wählt Welt und Rundenzahl.

Steuerung: `A`/`D` **oder** die Pfeiltasten zum Laufen, `W`/`↑`/Leertaste zum
Springen, `S`/`↓` fällt durch Einweg-Plattformen. In der Bauphase platziert der
Spieler am Zug sein Bauteil mit der **Maus**: `1`–`4` wählt die Karte, `R` dreht
sie; Rechtsklick oder `Esc` bricht das Zielen mit der Abrissbirne ab. Die Vorschau
am Mauszeiger zeigt vorher, was das Bauteil anrichtet – Reichweite des Luftstroms,
Schussbahn, Pendelweg, Sägenschiene. Ohne Maus bewegt man den Bauzeiger mit den
Laufen-/Springen-Tasten und setzt mit `Enter`.

Zu Beginn des eigenen Bauzugs erscheint in der Bildschirmmitte ein
**Spielautomat**. Den Hebel zieht man selbst – anklicken oder Leertaste. Wie in
Las Vegas zeigt alles darauf: ein blinkendes PULL-Schild, ein Fächer aus flackernden
Neonpfeilen, Lauflicht-Bögen und funkelnde Sterne. Nach 15 Sekunden hilft der
Automat selbst nach. Dann laufen die Walzen an, bremsen ab und rasten
nacheinander auf den gezogenen Karten ein – danach geht es los. Wer aufgibt,
hört die traurige Posaune.
**Die anderen sehen nur, wo gebaut wird** – die Vorschau am Mauszeiger des
Bauenden, aber nicht seine Handkarten. Pfeilfallen und Bruchblöcke sind nur
während des Spiels zu hören; in Lobby, Punkteansicht und nach dem Match ist Ruhe.

**Die Uhr der Partyphase führt der Server:** 60 Sekunden, und sobald die erste
Figur im Ziel ist, bleiben allen noch 10. Alle sehen denselben Zeitbalken, die
letzten drei Sekunden zählen groß und rot herunter, und bei Ablauf endet die Runde
für alle gleichzeitig.

Aufteilung der Verantwortung:

* **Server (PHP)** ist die Wahrheit für alles Diskrete: Phasen, Zugreihenfolge,
  Handkarten, gesetzte Bauteile, Partyzeit, Rundenergebnisse und Punktestand.
* **Client (JavaScript)** rechnet die Physik der eigenen Figur und meldet nur das
  Ergebnis („im Ziel“ / „gestorben an Bauteil von Spieler X“) zurück. Die anderen
  Figuren werden aus den Serverpositionen interpoliert.

Synchronisiert wird per Polling – rund 11× pro Sekunde in der Partyphase, gut 5×
in der Bauphase (damit man dem Bauenden flüssig zusieht) und etwa 1× sonst. Ohne
WebSockets, weil außer PHP nichts erlaubt ist; für vier Spieler im LAN oder auf
einem normalen Webspace reicht das. Wer mit Freunden im selben WLAN spielt, startet
den Server mit `php start.php --lan`.

## Bauteile

Alles hier ist ein Hindernis. Nichts davon bringt jemanden irgendwo hinauf.

| Bauteil | Wirkung |
| --- | --- |
| Steinblock | Versperrt den Weg |
| Balken | Drei Kacheln breite Plattform, riegelt ganze Wege ab |
| Mauer | Drei Kacheln hoch – da kommt niemand drüber |
| Betonklotz | Zwei mal zwei Kacheln massiv im Weg |
| Eisblock | Versperrt den Weg, und wer oben landet, rutscht weiter |
| Bruchblock | Bricht 0,45 s nach der Berührung weg |
| Klebeblock | Bremst auf einen Kriechgang herunter |
| Ölpfütze | Nicht solide, dafür spiegelglatt – legt sich auf den Boden |
| Förderband | Schiebt in Pfeilrichtung (drehbar) |
| Ventilator | Luftstrom über 5 Felder, wirft aus der Bahn (drehbar) |
| Sprungblock | Schleudert unkontrolliert davon |
| Stacheln | Tödlich, zeigen in die gewählte Richtung (drehbar) |
| Kreissäge | Pendelt tödlich entlang ihrer Schiene (drehbar) |
| Pendel | Tödliche Kugel an der Kette, schwingt unter ihrem Anker |
| Pfeilfalle | Schießt alle 1,7 s einen Pfeil (drehbar) |

Jedes gesetzte Bauteil trägt in der Ecke einen kleinen Punkt in der Farbe seines
Besitzers – wichtig, weil Kills den Bauteil-Besitzer belohnen.

## Power-ups

In etwa jeder zweiten Hand ist die vierte Karte ein Power-up. Power-ups helfen dem,
der sie einsetzt. Anklicken setzt sie ein – sie kosten keinen Zug, müssen aber
**vor** dem eigenen Bauteil kommen, denn das beendet den Zug. Wer nicht mehr bauen
will, beendet seinen Zug mit **Zug beenden**.

| Power-up | Wirkung |
| --- | --- |
| Doppelsprung | Diese Runde ein zusätzlicher Sprung in der Luft |
| Schutzschild | Fängt einen tödlichen Treffer ab (Stacheln, Säge, Pendel, Pfeil) – gegen Abstürze hilft er nicht |
| Turbo | Diese Runde deutlich schneller laufen |
| Gleitschirm | Sprungtaste in der Luft halten und langsam hinabschweben |
| Abrissbirne | Räumt zwei nebeneinanderliegende Felder – `R` dreht zwischen waagerecht und senkrecht, Klick setzt an |

Doppelsprung, Schutzschild, Turbo und Gleitschirm wirken in der Partyphase direkt
nach dem Einsetzen. In der Spielerleiste zeigt ein kleines Zeichen, wer gerade was
hat; im Level sieht man Schildblase, Schirm und Turbo-Streifen an der Figur.

## Welten

| Welt | Thema | Charakter |
| --- | --- | --- |
| Wiesenweg | Tag | Flacher Einstieg mit drei kurzen Lücken |
| Turmklettern | Dämmerung | Lange Treppe hinauf zum Felsen |
| Die Kluft | Nacht | Trittsteine über dem Abgrund |
| Doppeldecker | Abendrot | Enger Gang unten, Treppe hinauf aufs Oberdeck |
| Gletscher | Eis | Über den Eisberg und die treibenden Schollen |
| Wüstenpyramide | Wüste | Stufe um Stufe über die Pyramide |
| Vulkankrater | Lava | Trittsteine über glühender Lava |
| Burgmauer | Burg | Durch das Tor oder über die Zinnen zum Turm |

Jede Welt steht als **ASCII-Karte** in `lib/Levels.php` – 40 Zeichen breit, 23 Zeilen
hoch, eine Kachel pro Zeichen. So sieht man beim Bearbeiten direkt, wie sie aussieht:

```
'..S.....RRR................RR.RRR.RRRRRR',
'########################################',
```

| Zeichen | Bedeutung |
| --- | --- |
| `.` | Luft |
| `#` | Boden (bekommt je nach Thema Gras, Schnee, Sand … obendrauf) |
| `R` | Fels |
| `-` | Einweg-Plattform, von unten durchspringbar |
| `S` | Startplatz – darunter muss Boden sein |
| `G` | Ziel – die Fahne steht darauf |

Eine neue Welt ist ein neuer Eintrag in `Levels::definitions()`. Der Parser prüft
Größe, Zeichen und dass es genau einen Start und ein Ziel gibt; `tests.php` prüft
danach, ob die Welt ohne Bauteile zu schaffen ist und alle vier Startplätze sicher
sind. Verfügbare Themen: `day`, `dusk`, `night`, `sunset`, `ice`, `desert`, `lava`,
`castle`.

## Bewegung

Laufen mit Beschleunigung und Reibung, variable Sprunghöhe (Taste früher loslassen
= niedriger springen), Coyote-Time und Sprungpuffer für zuverlässige Kantensprünge,
Wandrutschen und **Wandsprung**. Ein Sprung schafft rund 3,3 Kacheln Höhe und aus
vollem Lauf gut 5 Kacheln Weite – die Level halten überall reichlich Abstand
darunter. Links und rechts begrenzen unsichtbare Banden das Spielfeld;
herauslaufen geht nicht, nur nach unten fällt man.

## Selbsttest

`tests.php` im Browser öffnen. Die Seite fährt 88 Tests: gegen die echte
Spiel-Engine (Sprunghöhen, jedes Bauteil, jede Todesursache, die sichere
Startzone, Doppelsprung, Schild, Turbo, Gleitschirm), gegen die Serverregeln in PHP
(Reihenfolge, Kartenziehen, Power-ups, Abrissbirne, verdeckte Handkarten, Farb- und
Tierwahl, Partyzeit, Punkte nur bei echtem Tod, wann Bauteile verschwinden, Matchende
nach Runden samt Gleichstand, Grabsteine, Lobby, Karten-Parser) – und sie vergleicht
Bauregeln, Grabsteine sowie Bauteil- und Power-up-Katalog von JavaScript **mit denen
von PHP**, damit Server und Client nicht auseinanderlaufen.

Wichtigster Teil: für **jede Welt** sucht der Test erst einen Weg über die
erreichbaren Standflächen und lässt dann eine echte Figur diesen Weg mit der
echten Physik ablaufen – ohne ein einziges Bauteil. Geht ein Level nicht mehr
auf, fällt das sofort auf.

## Projektstruktur

```
start.php              Starter fürs Terminal: prüft alles und startet den Server
index.php              Menü: Raum erstellen oder beitreten, Regeln
game.php               Spielseite; liefert Level- und Kartendaten als JSON an den Client
tests.php              Selbsttest-Seite (Physik + Abgleich PHP/JavaScript)
api/index.php          JSON-Schnittstelle für den Online-Modus
lib/Cards.php          Katalog der Bauteile (Namen, Gewichte, Drehbarkeit)
lib/Levels.php         Die Welten als ASCII-Karten samt Parser und Bauregeln
lib/Game.php           Spielregeln des Online-Modus: Phasen, Zugfolge, Punkte
lib/Rooms.php          Raumdateien mit Dateisperre, Aufräumen alter Räume
lib/View.php           Kleine HTML-Helfer (eingebettetes Tab-Symbol)
assets/js/core.js      Konstanten, Mathe-Helfer, synthetischer Sound
assets/js/level.js     Kachelgitter, Bauteil-Physik, bewegliche Gefahren
assets/js/player.js    Steuerung und Plattformer-Physik der Figur
assets/js/render.js    Komplettes Zeichnen auf die Canvas
assets/js/input.js     Tastatur und Maus
assets/js/net.js       Polling-Transport für den Online-Modus
assets/js/game.js      Phasenmaschine, HUD, Spielschleife
data/rooms/            Laufzeitdaten der Online-Räume (wird ignoriert von git)
```

## Graphify (Wissensgraph für Claude Code)

Das Repo ist für [Graphify](https://github.com/Graphify-Labs/graphify) vorbereitet.
Graphify baut aus dem Code einen Wissensgraphen (Dateien, Klassen, Funktionen,
Aufrufe), den Claude Code abfragt, statt viele Dateien einzeln zu lesen. Für PHP
und JavaScript läuft das komplett lokal, ohne API-Key.

```
.claude/skills/graphify/        Der /graphify-Skill für Claude Code
.claude/settings.json           Hooks: erinnern Claude daran, zuerst den Graphen zu fragen
.claude/hooks/session-start.sh  Cloud-Sitzungen: installiert Graphify, baut den Graphen
CLAUDE.md                       Regeln für Claude: query/path/explain, danach graphify update
.graphifyignore                 Nur der Spielcode kommt in den Graphen
```

Der Graph selbst (`graphify-out/`) wird nicht eingecheckt, sondern neu gebaut.

**Lokal einrichten (einmalig, Python 3.10+ nötig):**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # Windows: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv tool install graphifyy                          # Paketname mit zwei y
graphify update .                                  # Graphen bauen, dauert ~2 Sekunden
graphify hook install                              # optional: nach jedem Commit neu bauen
```

Danach einfach Claude fragen, oder direkt: `graphify query "Wie wird ein Kill
gewertet?"`, `graphify explain "Levels::parseMap"`, `graphify path "A" "B"`.
`graphify-out/graph.html` zeigt den Graphen im Browser. Solange Graphify lokal
fehlt, meldet Claude Code bei Dateizugriffen einen harmlosen Hook-Fehler.

**Grenze:** Methoden in Objekt-Literalen (`var Game = { update: function () … }`)
erkennt Graphify nicht. `game.js`, `render.js`, `core.js` und `input.js`
erscheinen deshalb nur als einzelne Knoten; die PHP-Klassen, `level.js` und
`player.js` sind vollständig erfasst.

## Bewusste Abweichungen vom Original

* **Bauteile sind reine Hindernisse.** Im Original hilft man mit seinen Teilen
  auch sich selbst; hier sind alle Level von vornherein schaffbar, und gebaut
  wird ausschließlich gegen die anderen.
* **Gebaut wird der Reihe nach**, nicht gleichzeitig – so bleibt die Reihenfolge
  eindeutig, und alle sehen, wo gebaut wird.
* **Figuren kollidieren nicht miteinander** – sie laufen durcheinander hindurch.
* Online ist die Physik **clientseitig**: Wer das Spiel manipulieren will, kann das.
  Für eine Runde mit Freunden ist das kein Problem, für ein Turnier schon.
* Die Punktetabelle ist eine eigene, vereinfachte Variante (siehe oben), und ein
  Match geht über eine feste Rundenzahl statt bis zu einer Zielpunktzahl.
* **Power-ups helfen dem, der sie zieht** (Doppelsprung, Schild, Turbo, Schirm) –
  im Original gibt es so etwas nicht.
