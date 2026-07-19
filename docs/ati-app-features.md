# ATI Straton App — vollständige Funktions-Inventur

Grundlagen-Spec für Funktionsparität. Quelle: Bedienungsanleitung Straton Flex (Kap. 5) +
Release Notes 2024.2-beta. Ziel: **alle** Funktionen der ATI-Weboberfläche abbilden — als Basis
für die HA-Integration und eine spätere eigene App. Stand 2026-07-16.

Legende Risiko/Write: 🟢 read-only · 🟡 Write reversibel · 🔴 Write greift ins Programm/Netz/System.
Legende Parität: ✅ heute vorhanden · ❌ Lücke (fehlt) · ⛔ bewusst nicht in HA.

## Live verifiziert (2026-07-17) — Ergänzungen zum Modell

Aus Web-UI-Rundgang + echtem `ati.settings.json`-Backup (siehe `docs/config-schema.md`):

- **Drei getrennte Preset-Ebenen** (nicht vermischen):
  1. **Farbpalette** (per Stützstelle) = `colors[]`, benanntes Spektrum. **13 Paletten** vorhanden
     (`Natural Spectrum 10 Meter, SPS Plakativ, SPS Plakativ+, Shallow Reef, LPS/SPS+, LPS+, Deep Sea,
     Toms Korallen, Fluorescent+, Rene Fluorescent, Toms Daylight G2, Toms Korallen G1, TomsStraton V2`).
     Werk = `disabled:true`, eigene = `disabled:false`.
  2. **Programm-Profil / Voreinstellung** (ganze Gruppe) = ⭐-Dialog „Voreinstellungen": Werk-Profile
     **Laden** (mit Spektrum-Vorschau) + „eigene Voreinstellung speichern". Referenz in `timeline.presetting`.
  3. **Datei** = Backup/Restore des ganzen Programms (Export/Import).
- **7 Kanäle:** UV/V/RB/B/**LC**/W/R — Web-UI zeigt Cyan als **„C"**, JSON/HA nennt ihn **„LC"**. id-Map
  UV1/V2/RB3/B4/LC5/**W0**/R6 (W hat id 0!).
- **„Live Mode"-Button existiert** → sehr wahrscheinlich Live-Override (relevant für Dimmen/Mondlicht, O2).
- **Sensorik live:** Leistung (W) **und PAR pro Tiefe** (@30/45/60/75 cm) — als HA-Sensoren ergänzen.
- **Toolbar-Zuordnung:** ⚙=Werkzeuge (Datei/Raster) · ⭐=Voreinstellungen-Dialog · 📈=Punkte-Werkzeuge
  (einfügen/entfernen/„Übertragen auf Alle"). Temperatur-48h = **„Temperaturen"-Button** unten (pro Spot).
- Gruppen-Verwaltung („Bearbeiten"): Gruppen (Profil in [Klammern]) + Lampen (114619 Master, 147335 Slave).

## A) Registerkarte „Diagramm" — Programmierung

Kernmodell: pro **Gruppe** eine Tageskurve aus **Stützstellen** (Zeit + Intensität + Farbe/Spektrum).

### A1 Statuszeile
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Aktuelle Leistungsaufnahme anzeigen | 🟢 | ✅ | schon als Sensor + im Cockpit |

### A2 Diagramm-Werkzeuge
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Diagramm als Datei speichern (Export/Backup) | 🟢 | ❌ | Programm als Datei sichern |
| Backup aus Datei wiederherstellen (Import) | 🔴 | ❌ | Programm aus Datei laden → schreibt Programm |
| Aktuelle Einstellungen als **Voreinstellung** in Lampe speichern | 🔴 | ❌ | Preset anlegen |
| **Rasterauflösung** ändern | 🟢 | ❌ | Zeit-Granularität des Editors |

### A3 Stützstellen (Support Points)
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Stützstelle **vor** der gewählten einfügen | 🔴 | ❌ | |
| Gewählte Stützstelle **entfernen** | 🔴 | ❌ | |
| Stützstelle **nach** der gewählten einfügen | 🔴 | ❌ | |
| Stützstelle horizontal verschieben (**Tageszeit**) | 🔴 | ❌ | Drag im Editor |
| Stützstelle vertikal verschieben (**Intensität**) | 🔴 | ❌ | Drag im Editor |
| Anzeige aller Stützstellen (Zeit, %, Farbe) | 🟢 | ✅ | im read-only Panel vorhanden |

### A4 Gruppen
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Gruppe **ein-/ausschalten** | 🟡 | ❌ | Cockpit-Toggle vorbereitet |
| Gruppen **bearbeiten** (welche Spots gehören zur Gruppe) | 🔴 | ❌ | Gruppen-Zuordnung |
| Einstellungen einer Gruppe **auf andere Gruppen übertragen** | 🔴 | ❌ | „copy to groups" |
| Anzeige aktuell gewählte **Voreinstellung** je Gruppe (2024.2) | 🟢 | ❌ | |
| Gruppe/Timeline auswählen | 🟢 | ✅ | Panel-Selector |

### A5 Farben / Spektrum
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Farbe auswählen** (Preset-Farbe einer Stützstelle) | 🔴 | ❌ | |
| **Farbe konfigurieren** — Kanalwerte 0–255 (UV/V/RB/B/LC/W/R) per Schieberegler | 🔴 | ❌ | 7 Kanäle Flex |
| Farbwerte **direkt numerisch** eingeben (2024.2) | 🔴 | ❌ | Klick auf Wert neben Regler |
| Anzeige aktuelles Spektrum | 🟢 | ✅ | Balken im Panel |

### A6 Gesamtintensität (2024.2)
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Gesamtintensitäts-Regler** — skaliert alle aktiven Linien | 🔴 | ❌ | = Master-Regler im Cockpit |
| Gesamtintensität **direkt numerisch** eingeben | 🔴 | ❌ | |

### A7 Diagramm sperren (2024.2)
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Sperrmodus** aktivieren | 🟡 | ❌ | Editier-Sperre |
| Mehrere Stützstellen selektieren | 🟢 | ❌ | Multi-Select |
| Farbe mehreren Punkten **gemeinsam** zuweisen | 🔴 | ❌ | Batch-Farbe |

### A8 Vorschau (Preview)
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Vorschau **aktivieren/deaktivieren** | 🟡 | ❌ | zeigt Farbe live, ohne Programm zu ändern |
| **Zeit** für Vorschau wählen | 🟡 | ❌ | „wie sieht 14:00 aus" |
| **Tagesvorschau** starten (Zeitraffer) | 🟡 | ❌ | |
| Vorschaumodus beenden | 🟡 | ❌ | |
| Intensität einzelner Kanäle in Vorschau ändern | 🟡 | ❌ | |
| Helligkeit der Farbe in Vorschau ändern | 🟡 | ❌ | |

### A9 Demomodus
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Demo **Start / Stop** | 🟡 | ❌ | **erster geplanter Write** (Phase 1) |
| Farbe für Demo wählen | 🟡 | ❌ | |
| Gruppen für Demo wählen | 🟡 | ❌ | |
| Intensität für Demo | 🟡 | ❌ | |
| Zeitintervall für Demo | 🟡 | ❌ | |

### A10 Temperatur
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Temperaturdiagramm 48 h** | 🟢 | ❌ | Spots liefern Temp; History in HA möglich |
| Aktuelle Spot-Temperatur | 🟢 | ✅ | Sensor vorhanden |

### A11 Speichern
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Dauerhaftes Speichern** des Programms in der Leuchte | 🔴 | ❌ | flüchtig vs. persistent (siehe API-Frage O3) |

## B) Registerkarte „Einstellungen"

| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Zeitzone** + welche Zeit nach Neustart gewählt wird | 🔴 | ❌ | |
| **Support-Informationen** herunterladen | 🟢 | ❌ | Diagnose-Bundle (HA hat eigenes `diagnostics.py`) |
| **Nutzername/Passwort** ändern | 🔴 | ⛔ | Sicherheitskritisch — HA: NICHT umsetzen (Prohibited: Credential-Änderung) |
| **Netzwerkeinstellungen** ändern (WLAN/SSID) | 🔴 | ⛔ | HA: NICHT umsetzen (Prohibited: Netz/Systemeinstellungen) |
| **Firmware-Update** ausführen | 🔴 | ⛔ | HA: höchstens Verfügbarkeit anzeigen, nicht auslösen |
| **Einrichtungsassistent** erneut ausführen | 🔴 | ⛔ | HA: nicht nötig |

## C) Registerkarte „Sprache"
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Deutsch / Englisch | 🟢 | — | In HA über HA-Sprache/Übersetzungen gelöst |

## D) Setup-Assistent / Inbetriebnahme (einmalig)
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| **Modus** der Leuchte (Standalone / Master / Slave) | 🔴 | ⛔ | Einmal-Setup, in ATI-UI belassen |
| Nutzer/Passwort/Zeitzone festlegen | 🔴 | ⛔ | s.o. |
| Netzwerk (Heimnetz / Master-Straton / AP) | 🔴 | ⛔ | s.o. |
| Systemzeit vom Endgerät übertragen | 🟡 | ❌ | evtl. Zeit-Sync-Button |

## E) Hardware
| Funktion | Risiko | Parität | Notiz |
|---|---|---|---|
| Hardware-Reset (Microtaster 10 s) | 🔴 | ⛔ | physisch, nicht per API |

## F) Über ATI hinaus — Mehrwert der eigenen App (nicht in ATI-UI)

Diese fehlen der ATI-App und sind das eigentliche Argument für die eigene App
(vgl. ReefBeat/Mobius, [[reference-reef-led-control-apps]]):

| Funktion | Notiz |
|---|---|
| **Acclimation-Rampe** | Intensität über X Tage hochfahren (neue Korallen/Umstieg) |
| **Mond / Lunar** | echte 28-Tage-Mondphase oder manuell |
| **Clouds / Storm** | zufällige Wolken/Gewitter-Effekte, Stufen |
| **Sunrise/Sunset**-Weichzeichnung | sanfte Rampen an den Kurvenenden |
| **Manual-Override mit Auto-Return** | „jetzt X %", kehrt automatisch zum Plan zurück |
| **Presets von Profis / Community** | teilbare Programm-Vorlagen |
| **Smart-Home-Verzahnung** | Füttern-Pause, Anwesenheit, Wetter-gekoppelte Wolken, Voice |
| **Multi-Device / Zonen** | mehrere Lampen gruppieren |
| **PAR/Energie-Historie** | (Straton X liefert LIVE PAR / LIVE ENERGY nativ) |

## Priorisierung für die Umsetzung (Vorschlag)

1. **Phase 1** — Demo (A9), Gruppe ein/aus (A4), Gesamtintensität (A6). Kleine, sichere Writes.
2. **Phase 2** — Voreinstellungen anwenden/speichern (A2/A4), Vorschau (A8).
3. **Phase 3** — voller Stützstellen-Editor (A3), Farben/Kanäle (A5), Sperr-/Batch-Modus (A7),
   Gruppen-Copy (A4), Rasterauflösung (A2).
4. **Phase 4** — Import/Export (A2), Temp-48h (A10).
5. **Parallel Mehrwert (F)** — Acclimation, Mond, Clouds, Auto-Return.
6. **Bewusst NICHT in HA (⛔)** — Credentials, Netzwerk, Firmware-Auslösung, Setup-Wizard,
   Hardware-Reset. Diese bleiben in der ATI-UI bzw. Hardware (Sicherheits-/Guard-Grenzen).

> Alle 🔴/🟡-Writes hängen an den offenen API-Fragen aus `docs/entity-architecture.md` (O1–O8),
> die am Wochenende live mitgeschnitten werden.
