# ATI Straton — Konfigurations-/Programm-Schema

Abgeleitet aus einem echten **Voll-Backup** `ati.settings.json` (Web-UI „Datei → **Herunterladen**",
Firmware 3.0.4, Rene Zuch, 2026-07-17). Das ist das **komplette Export-Format** (deshalb sind auch alle
Farbpaletten enthalten) — es zeigt das **Datenmodell** von Programm + Paletten.

> ⚠️ **Nicht verwechseln:** Dieses Backup ≠ zwingend der Body des inkrementellen **„SPEICHERN"**-Requests,
> den das Web-UI nach einer **Kurvenänderung** schickt. Der Save-Button-Request (Endpoint, evtl. nur ein
> Subset, dauerhaft-Flag) ist **noch zu capturen** — Plan: Rene ändert live eine Kurve und drückt Save,
> Claude schneidet den Request mit (siehe `entity-architecture.md`, O3/O7). Das Modell unten bleibt die
> Struktur-Referenz für den Payload.

## Top-Level

```jsonc
{
  "timelines": [ /* eine pro Gruppe */ ],
  "colors":    [ /* Paletten-Bibliothek, global */ ],
  "version":   "3.0.4"
}
```

Ein einziges Objekt für das **gesamte** Programm → Schreiben = **Read-Modify-Write**:
aktuelles Objekt holen, Teil ändern, komplett zurückschreiben. Nie ein Teilobjekt senden.

## `timelines[]` — eine Gruppe

```jsonc
{
  "_id": 1,                       // 1=Links, 2=Mitte, 3=rechts
  "name": "Links",
  "visible": true,
  "active": true,                 // Gruppe an/aus (A4)
  "linecolor": "#673AB7",         // Kurvenfarbe im Editor (nur UI)
  "colorEditable": true,
  "spots": [0, 4],                // Spot-Array-Indizes dieser Gruppe
  "spotAddresses": [1, 2],        // Hardware-Adressen
  "nodes": [ /* Stützstellen, s.u. */ ],
  "presetting": { "id": 8, "title": "PRESETTING_TITLE_8_1" }  // OPTIONAL
}
```

- **`presetting`** = das geladene **Programm-Profil** (Voreinstellung) der Gruppe. Im Backup nur bei
  **Mitte** und **rechts** (id 8 = „Toms Korallen"). **Links hat kein `presetting`** → Custom-Programm.
  → Ein Profil „Laden" setzt vermutlich `nodes` + `presetting`; manuelles Editieren entfernt `presetting`.
- **`active`** = Gruppe ein/aus. **`visible`** = im Editor sichtbar (UI).
- **`spots` / `spotAddresses` = die zugeordneten Lampen-„Sektionen".** Jede physische Straton hat mehrere
  **Sektionen** (Spots). Eine Gruppe aggregiert bestimmte Sektionen über *mehrere* Lampen hinweg. In der
  „Bearbeiten → Gruppen"-Oberfläche klappt man eine Gruppe auf und **kreuzt pro Lampe die Sektionen an**
  (`ATI-Straton-<id> Sektion N`). Renes Setup (2 Lampen, je 3 aktive Sektionen): **Links = Sektion 1** beider
  Lampen (`147335:0`+`114619:0`, spots [0,4]) · **Mitte = Sektion 2** (spots [5,1]) · **rechts = Sektion 3**
  (spots [6,2]). Also: Gruppenname (Links/Mitte/rechts) = geometrische Position der Sektion über die
  nebeneinander hängenden Lampen. `spots` = Spot-Array-Indizes, `spotAddresses` = Hardware-Adressen.

### `nodes[]` — Stützstelle

```jsonc
{
  "time": 39600,                  // SEKUNDEN seit Mitternacht (0..86400) → 39600 = 11:00
  "value": 60,                    // Intensität in % (Dezimale erlaubt: 37.5, 52.5, 41.25)
  "type": "node",                 // "first" (index 0) | "node" | "last" (letzter)
  "index": 3,                     // fortlaufend 0..n
  "color": { "_id": 57, "name": "Toms Korallen G1" }  // Referenz auf colors[]._id
}
```

- **`time`** in Sekunden, **`value`** in Prozent (nicht 0-255!). Umrechnung Uhrzeit→Sekunden:
  `h*3600 + m*60`.
- **`color`** referenziert eine Palette per `_id` (+ Name als Klartext). Die vollständigen
  Kanalwerte stehen in `colors[]`, nicht im Node.
- Erste Node `type:"first"` (time 0), letzte `type:"last"` (time 86400). Im Backup 11 Nodes/Gruppe.
- Beispiel-Tag (Links/Mitte): 00:00→0 % (Natural Spectrum) · 09:30 0 % / 10:00 37,5 % (Fluorescent+)
  · 11:00–14:00 60 % / 15:00–17:30 52,5 % (Toms Korallen G1) · 19:00 41,25 % / 21:00 37,5 % / 23:00 0 %
  (Rene Fluorescent) · 24:00 0 %. **rechts** = identische Zeiten, aber **alle `value` = 0** (ausgedimmt).

## `colors[]` — Palette (benanntes Spektrum)

```jsonc
{
  "_id": 57,
  "name": "Toms Korallen G1",
  "bgColor": "#FFEB3B",           // Swatch-/Dot-Farbe (UI-Kennung)
  "visible": true,
  "disabled": false,              // true = Werks-Palette (gesperrt) | false = eigene (editierbar)
  "values": [ /* 7 Kanäle */ ]
}
```

### `values[]` — Kanal

```jsonc
{ "id": 3, "label": "COLORNAME_RB", "name": "RB", "value": 255, "sort": 3,
  "factor": 1,
  "valueTemperature": { "name": "RB", "temperature": 30, "max": 254 } }
```

- **Kanal-`id`-Mapping (nicht fortlaufend!):**

  | name | id | sort | Bemerkung |
  |---|---|---|---|
  | UV | 1 | 1 | |
  | V  | 2 | 2 | |
  | RB | 3 | 3 | Royal Blue |
  | B  | 4 | 4 | |
  | **LC** | 5 | 5 | Cyan — Web-UI zeigt **„C"**, JSON/HA nennt **„LC"** |
  | **W**  | **0** | 6 | **W hat id 0** (Sonderfall!) |
  | R  | 6 | 7 | |

- **`value`** 0–255. **`sort`** = Anzeigereihenfolge (UV→R).
- **`factor`** (nur eigene Paletten): 0,8 auf UV & R, sonst 1 → Skalierungs-/Kalibrierfaktor pro Kanal.
- **`valueTemperature`** (nur eigene Paletten, nur RB & B): `{temperature:30, max:254}` → Thermoschutz-
  Kappung der Hochleistungs-Blaukanäle (bei Temp X max reduzieren). Advanced — beim Schreiben eigener
  Paletten erhalten.
- **`disabled`**: Werks-Paletten `true`, eigene `false`. `disabled:true`-Paletten werden trotzdem in
  Nodes verwendet (z.B. Natural Spectrum, Fluorescent+) — „disabled" = *nicht editier-/löschbar*, nicht *unbenutzbar*.

## Paletten-Bibliothek im Backup (13, `colors_count:13`)

| _id | Name | disabled | bgColor |
|---|---|---|---|
| 5 | Natural Spectrum 10 Meter | true | #9C27B0 |
| 1 | SPS Plakativ | true | #FFEB3B |
| 53 | SPS Plakativ+ | true | #FFEB3B |
| 6 | Shallow Reef | true | #388e3c |
| 50 | LPS/SPS+ | true | #5d4037 |
| 51 | LPS+ | true | #f44336 |
| 7 | Deep Sea | true | #FFEB3B |
| 54 | Toms Korallen | true | #303f9f |
| 52 | Fluorescent+ | true | #2196F3 |
| 55 | Rene Fluorescent | **false** | #64FFDA |
| 56 | Toms Daylight G2 | **false** | #FFC107 |
| 57 | Toms Korallen G1 | **false** | #FFEB3B |
| 58 | TomsStraton V2 | **false** | #00BCD4 |

> Achtung Doppeldeutigkeit „Toms Korallen": **Palette** `_id 54` „Toms Korallen" **und** `_id 57`
> „Toms Korallen G1" (beides Paletten) sind getrennt vom **Programm-Profil** „Toms Korallen"
> (`presetting.id 8`), das die Gruppe als Ganzes lädt. Drei verschiedene Dinge, gleicher Markenname.

## Konsequenzen für die HA-Umsetzung

1. **Write = ganzes `{timelines, colors, version}`** → Coordinator hält das Objekt, patcht, schreibt via
   `PUT /api/data` zurück, dann `SPEICHERN`-Äquivalent (dauerhaft, O3).
2. **Intensität ändern** (Master/Gruppe) = alle `nodes[].value` einer/aller aktiven Gruppe(n) skalieren
   (= „Gesamtintensität"). Kein separates Feld — es sind die Node-Werte.
3. **Spektrum an einem Punkt ändern** = `node.color._id` auf eine existierende Palette setzen.
4. **Eigene Palette anlegen/ändern** = Eintrag in `colors[]` (id ≥ 55-Bereich, `disabled:false`),
   `factor`/`valueTemperature` beibehalten.
5. **Gruppe an/aus** = `timeline.active`.
6. **Profil laden** = vermutlich eigener Endpoint, der `nodes`+`presetting` der Gruppe setzt (Weekend prüfen).
7. **Kanal-Mapping** (W=0!) und **LC≙C** in der HA-Darstellung berücksichtigen.

> Rohdaten-Backup liegt bei Rene lokal (`~/Downloads/ati.settings.json`) — **nicht** ins öffentliche
> Repo committen (persönliche Konfiguration).
