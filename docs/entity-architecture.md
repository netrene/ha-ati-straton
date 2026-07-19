# Schicht A — Entity-Architektur (Umsetzungsplan Schreib-Steuerung)

Status: **Entwurf**, Stand 2026-07-16. Fundament für die Schreib-Steuerung der ATI Straton Flex
in Home Assistant. Schicht B (Panel-Cockpit-Redesign) baut hierauf auf und ist separat.

## Leitprinzipien

1. **Native HA-Entities statt UI-Klon.** Alles Steuerbare wird als `light` / `number` / `select` /
   `switch` / `button` exponiert, damit Automationen, Voice, Presence, Dashboards und `ha-reef-card`
   es ohne Umweg nutzen können. Vorbild: `ha-reefbeat-component` (Red Sea).
2. **Read-Model bleibt die Wahrheit.** Der Coordinator pollt weiter; Writes sind optimistisch mit
   sofortigem `async_request_refresh()` zur Bestätigung.
3. **Sicherheit vor Funktion.** Kein Write ohne verifiziertes Payload. Globaler Write-Guard
   (Options-Flow, Default AUS). Payloads werden am Wochenende an der echten Leuchte mitgeschnitten,
   nicht geraten (Korallen-Risiko).
4. **Modell-agnostisch.** Kanal-Set (Flex: UV/V/RB/B/LC/W/R) und optionale Capabilities (PAR, Power)
   als Metadaten, damit Straton X später ohne Umbau andockt.

## OFFENE FRAGEN — am Wochenende live zu klären (Blocker für Write-Code)

Diese bestimmen die Semantik der Entities. Erst danach wird geschrieben.

> **Update 2026-07-17 (2×):** Durch Backup (`config-schema.md`), Web-UI-Rundgang **und Quellcode-Analyse
> von `js/ati.min.js`** (`api-write.md`) ist die Schreib-API jetzt **verifiziert**. Fast alle Fragen geklärt.

**Geklärt:**
- **O1 (Vollprogramm):** ✅ **`PUT /api/data`** mit Body `{timelines, spots, colors}` → **Read-Modify-Write** des Vollprogramms. Response `{lines, spots, colors}`.
- **O3 (dauerhaft speichern):** ✅ `PUT /api/data` **ist** die Persistenz — kein getrennter Endpoint. Toast `MODAL_SUCCESS_SAVE_MESSAGE`.
- **O7 (Header/CSRF):** ✅ Standard AngularJS `$http` — JSON-Body, Session-Cookie `connect.sid`, **kein** CSRF. Kein WebSocket.
- **O6 (Gesamtintensität):** ✅ Kein Extra-Feld — Intensität = `nodes[].value` (%). Skalieren + `PUT /api/data`.
- **O5 (Preset-Ebene):** ✅ `timeline.presetting:{id,title}` = Programm-Profil; Paletten = `colors[]` per Node.
- **O2 (Live-Override):** ✅ **Beantwortet — es gibt einen, über Socket.IO** (Korrektur: die App lädt `socket.io`, der Chart macht `io.connect()` + `emit("update-node", …)`). Zwei Wege für HA: **(a) persistent** = Node-`value` ändern + `PUT /api/data` (HTTP, einfach, Flash-Write → **Debounce**); **(b) transient/live** = Socket.IO `update-node` (kein Flash-Verschleiß, braucht `python-socketio`). Manual-Override mit Auto-Return + Mondlicht-Modulation ideal über (b). Details in `api-write.md`.

**Noch offen (klein):**

| # | Frage | Warum kritisch |
|---|---|---|
| O4 | „Live Mode" / „Demo Mode" — eigener Handler/Endpoint? (in `ati.min.js` **nicht** gefunden; nur `GET /api/demo` liest `demoModel`) | Nur relevant, falls Demo/Live in HA gewünscht. Separat prüfen (Button + Netzwerk/anderes Bundle). |
| O8 | **Master/Slave**: immer an den lokalen Master (192.168.0.22) schreiben, der verteilt? | An welche URL gehen Writes (vermutlich Master). |

> **⚠️ Session-Limit (Fallstrick):** Die Straton erlaubt nur **eine** aktive Anmeldung. Vor jedem
> Capture die **HA-Integration deaktivieren** (`ha_set_integration enabled=false`), sonst stiehlt HAs
> Re-Auth die Web-Session mitten im Mitschnitt. Danach wieder aktivieren.

Capture-Vorgehen: HA-Integration deaktivieren → Straton-Web-UI (http://192.168.0.22) im lokalen Chrome
öffnen → Netzwerk-Log mitschneiden → je Aktion (Live Mode, SPEICHERN, Demo start/stop, Profil laden,
Gruppe aus/ein) genau **einen** Request provozieren und Methode/URL/Header/Body festhalten →
`docs/api-write.md`. Datenmodell-Referenz für den Body: `docs/config-schema.md`.

## Device-Modell (unverändert)

- Ein HA-Device je physischer Lampe (`identifiers = (DOMAIN, lamp_id)`), verlinkte Lampen via
  `via_device` auf den lokalen Master. Bereits in `entity.py` umgesetzt.
- **Program-Gruppen (Timelines)** sind logisch, keine eigenen Devices. Gruppen-Entities hängen am
  Master-Device und tragen die Gruppe im Namen (z.B. „Links", „Mitte", „rechts").

## Entity-Landkarte

| Platform | Entity (Vorschlag) | Quelle (read) | Write-Endpoint | Semantik / Notizen |
|---|---|---|---|---|
| `light` | `light.straton_<gruppe>` | timeline.current_intensity, active | `PUT /api/data` bzw. Gesamtintensität | ON/OFF = Gruppe ein/aus; brightness = aktuelle Intensität der Gruppe. Kern-Control. Semantik hängt an O2/O6. |
| `light` | `light.straton_master` *(optional)* | min/max über Gruppen | s.o. | Alle aktiven Gruppen gemeinsam (Gesamtintensitäts-Regler). Nur wenn O6 = globales Feld. |
| `number` | `number.straton_<gruppe>_<kanal>` *(Phase 3)* | color.values[kanal] 0-255 | `PUT /api/data` | Nur sinnvoll im Manual/Now-Kontext. 7 Kanäle Flex. Erst nach Dimmer. |
| `switch` | `switch.straton_demo` | `/api/demo` | `POST /api/demo` | **Phase 1 — sicherster Write.** Reversibel, isoliert. |
| `switch` | `switch.straton_<gruppe>` *(optional)* | timeline.active | `PUT /api/data` | Gruppe aktivieren/deaktivieren. Kann in `light` ON/OFF aufgehen. |
| `select` | `select.straton_preset` *(Phase 3)* | current preset | (O5) | Voreinstellung wählen. |
| `button` | `button.straton_save_program` *(Phase 2)* | — | (O3) | „Dauerhaft in Leuchte speichern", falls getrennt. |
| `switch`+`number` | Acclimation (`switch.straton_acclimation`, `number.straton_acclimation_days`, `..._target`) *(Phase 4)* | HA-Helfer | nutzt Dimmer-Write | **HA-emuliert**, keine Firmware-Funktion. Rampe skaliert Master-Intensität täglich. |
| `sensor`/`binary_sensor` | bestehend | Coordinator | — | Power, Temp, PAR, Connection etc. bleiben. Straton X: PAR/Power erweitern. |

## API-Client — neue Schreibmethoden (`api.py`)

Alle Writes über eine zentrale, validierende Schicht. Skelett mit `NotImplementedError` bis Capture:

```python
# Konstanten
ENDPOINT_DATA = "/api/data"        # PUT — Programm schreiben
# ENDPOINT_DEMO existiert bereits (GET) → für POST wiederverwenden

async def set_demo(self, *, enable: bool, ...) -> None:   # POST /api/demo   (O4)
async def put_data(self, payload: dict) -> None:          # PUT  /api/data   (O1, O7)
async def save_program(self) -> None:                     # (O3) — falls getrennter Endpoint
```

- Gemeinsame `_write(method, endpoint, json)` analog zu `_get`, inkl. `retry_auth` (401→login→retry)
  und derselben Fehler-Taxonomie (`ATIStratonCannotConnect/AuthError/ResponseError`).
- **Write-Guard:** `put_data`/`set_demo` prüfen ein `self._write_enabled`-Flag; ist es False,
  wird `ATIStratonWriteDisabled` geworfen (Entities werden dann gar nicht erst als steuerbar
  angelegt — siehe Options-Flow).
- **Payload-Validierung:** Intensität 0–100 geklemmt, Kanäle 0–255 geklemmt, Zeit 0–86400.
  Kein ungeprüftes Weiterreichen von UI-Werten an die Hardware.

## Coordinator & Write-Flow (`coordinator.py`)

- Neue Methode `async_write(coro)`: führt Write aus, danach `await self.async_request_refresh()`.
  Optimistisches UI-Update in der Entity (`_attr_is_on`/brightness sofort setzen, dann bestätigen).
- **Read-Modify-Write** (falls O1 = Vollprogramm): Helper `build_data_payload(current, patch)` baut
  aus `coordinator.data.timelines` + Änderung das vollständige Payload. Nie blind ein Teil-Objekt
  senden.
- **Debounce** für Slider (`number`/`light` brightness): letzte Änderung nach ~400 ms schreiben,
  um Flash-Verschleiß und Request-Fluten zu vermeiden.
- „Save"-Politik (O3): Option `auto_save` (Default an) — nach Write automatisch speichern, oder
  manuell über `button.straton_save_program`.

## Config-/Options-Flow (`config_flow.py`)

- **Neuer Options-Flow** mit:
  - `write_enabled` (bool, Default **False**) — Master-Schalter. Solange False: Integration bleibt
    read-only wie heute, keine steuerbaren Entities. Verhindert, dass ein Versions-Update
    ungewollt Writes freischaltet.
  - `scan_interval` (optional, Default 30 s).
  - `auto_save` (bool, Default True).
  - optional: Auswahl, welche Gruppen als Light-Entities erscheinen.
- Kein neues Pflichtfeld im Setup — Bestandsinstallationen laufen unverändert weiter.

## `__init__.py`

- `PLATFORMS` erweitern: `LIGHT`, `SWITCH`, `NUMBER`, `SELECT`, `BUTTON` — jeweils nur aktiv, wenn
  `write_enabled`. (Platforms werden immer geforwardet; die Plattform-`async_setup_entry` legt bei
  `write_enabled=False` schlicht keine Entities an.)
- Client bekommt `write_enabled` aus den Options.

## Rollout-Phasen (nach Risiko)

| Phase | Inhalt | Voraussetzung |
|---|---|---|
| **0** | Options-Flow + `write_enabled`-Guard + Write-Skelett in `api.py` (NotImplementedError). Keine reale Steuerung. | — |
| **1** | `switch.straton_demo` (POST /api/demo). Erster echter Write, reversibel. | O4, O7 |
| **2** | `light.straton_<gruppe>` Dimmer + ON/OFF + ggf. `button.save`. | O1, O2, O3, O6 |
| **3** | Kanäle (`number`), Presets (`select`). | O5, Kanal-Write bestätigt |
| **4** | Acclimation (HA-emuliert), Effekte-Vorbereitung für Schicht B. | Phase 2 stabil |

## Straton X — Vorwärtskompatibilität (nicht jetzt implementieren)

- Kanal-Set und Vorhandensein von LIVE PAR / LIVE ENERGY als Device-Capability-Metadaten führen,
  nicht hart auf Flex verdrahten.
- Prüfen, ob X dieselbe lokale `/api/*`-Struktur oder nur die Reef-Pilot-Cloud/App spricht. Falls
  nur App/Cloud: eigener API-Zweig, aber gleiche Entity-Landkarte.

## Definition of Done (Schicht A)

- [ ] `docs/api-write.md` mit verifizierten Payloads (Wochenende).
- [ ] Options-Flow mit `write_enabled` (Default False) — Bestand bleibt read-only.
- [ ] `switch.straton_demo` steuerbar und getestet (Phase 1).
- [ ] `light.straton_<gruppe>` dimmt + schaltet, mit Save-Politik (Phase 2).
- [ ] `py_compile` grün; manifest-Version erhöht.
```
