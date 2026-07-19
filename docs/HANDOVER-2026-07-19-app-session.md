# Handover: App-Session → HA-Integration (Stand 2026-07-19)

Quelle: Schwester-Repo `../ati-straton-app` (KMP/Compose-Multiplatform-App, Branch `kmp-app`, HEAD `b5d896e`).
Diese Datei ist der **vollständige Delta-Index** dessen, was die App-Session erarbeitet hat und was die
HA-Integration übernehmen/nachziehen kann — **nicht nur** die Live-Protokoll-Erkenntnisse von heute.
Kanonische Detail-Docs liegen in `docs/` (beide Repos synchron): `api-write.md`, `discovery-and-auth.md`,
`config-schema.md`, `entity-architecture.md`, `ati-app-features.md`.

> Umfang-Hinweis: Die App-Session hat mehr gelöst als heute. Reihenfolge unten = grob nach Reifegrad
> (A–D am Gerät verifiziert & im App-Code umgesetzt; E–F Referenz/Konzept).

---

## A. Geräte-Discovery = mDNS/Bonjour  ·  Detail: `discovery-and-auth.md`

- Service `_http._tcp.local.`, Instanz `ATI-Straton-<serial>` (Master `114619`, Slave `147335`), Port 80.
- **Live verifiziert** an Renes LAN (Desktop-jmdns + Android-NsdManager finden beide Lampen sofort).
- **HA-Adoption:** `zeroconf`-Discovery im `config_flow` (Instanz-Präfix `ATI-Straton-` filtern, Serial aus
  dem Namen). Heute erwartet `config_flow.py` eine manuelle Host-Eingabe → mDNS als Komfort-Ergänzung.
- **⚠️ Netz-Caveat:** VLAN/AP-Isolation (WELTNETZ vs. IoT_2G) blockiert mDNS **und** HTTP — im Handover-Doc.

## B. Auth & Single-Session  ·  Detail: `discovery-and-auth.md`

- Login = Formular-`POST /login` (`username`/`password` urlencoded) → Cookie **`connect.sid`** (kein JSON-Login,
  kein CSRF). Danach authentifizierte `/api/*`-GETs.
- **Single-Session-Limit (hart):** Die Firmware erlaubt **nur EINE** aktive Anmeldung. HA-Polling/Re-Auth,
  ATI-Web-UI und App **konkurrieren** um dieselbe Session und werfen sich gegenseitig raus.
- **HA-Adoption:** Der Coordinator muss das bewusst handhaben (Pausier-Schalter/Handoff), sonst „klaut" HA
  die Session mitten in Renes Bedienung — und umgekehrt. (Bereits als Fallstrick bekannt, hier zentral.)

## C. Programm-Datenmodell, Speichern & Gruppen anlegen  ·  Detail: `config-schema.md` + `api-write.md`

- **Speichern (persistent):** `PUT /api/data {timelines,spots,colors}` → Resp `{lines,spots,colors}`
  (Read-Modify-Write; Flash-Write → **Debounce**). `spots` **opak durchreichen** (volle Objekte, s.u.).
- **Gruppe anlegen:** `PUT /api/timeline {timelines}` → Server vergibt `_id`/Defaults. Sektions-Zuordnung
  via `spot._timelineId`. (Setup-Aufgabe — kann in ATI-UI bleiben.)
- Node: `time`=Sek. seit Mitternacht, `value`=% (Dezimale), `color:{_id,name}`. Kanäle UV1/V2/RB3/B4/LC5/**W0**/R6.
- **App-Referenz:** `model/StratonData.kt`, `model/Channels.kt`, Schreibpfad `net/StratonClient.putData()`.

## D. Live-Protokoll, Master/Slave-Topologie & Lampentyp  ·  Detail: `api-write.md` (Abschnitt „Master/Slave…")

**(am 2026-07-19 am Gerät verifiziert — der frische Kern)**
- **Master aggregiert alle Spots beider Lampen** — eine Verbindung genügt (löst O8 in `entity-architecture.md`).
- Schlüssel überall **`externalId="<serial>:<spotIndex>"`** (0=Links/1=Mitte/2=rechts; `:3`=leer, ohne `temperature`).
  Jede Gruppe = 1 Master-Spot + 1 Slave-Spot (gleicher Index).
- **Master/Slave** an den `/api/timelines`/`/api/spots`-Spot-Objekten: **`_isLocal:true`** = Master (keine `ip`),
  gesetztes **`ip`** = Slave.
- **Lampentyp/Firmware fertig von Firmware:** `GET /api/info` (Master: `id`, `isMaster`, `deviceType:"Straton Flex 153"`,
  `maxTemperature`) + `GET /api/devices` (**nur Slaves**: `externalId`, `deviceType`, `ip`, `swVersion.number`).
  Serial-Match: `info.id` bzw. `devices[].externalId` == `externalId.split(":")[0]`.
- **Watt = `/api/current.adc / 5.5`** (adc 187→34W). **PAR@Tiefe = Watt × `/api/par-table`-Faktor** (34×3=102 @30cm).
- **Live-Push = Socket.IO EIO4** (`/socket.io`, `EIO=4`, ws, `connect.sid`): `temperature-spots` (~2s, alle Spots
  beider Lampen) + `changed-intensity`. **Die Web-UI pollt nicht.**

### Konkrete HA-Deltas (Datei → Änderung)
| Datei | Was |
|---|---|
| `api.py` | `get_info()`/`get_devices()` → `deviceType`/`swVersion` nutzen. Optional `python-socketio` für Live-Push statt/zusätzlich zum 30s-Poll. |
| `coordinator.py` | Topologie: Master=`info`, Slaves=`get_devices()`, Spots je `externalId` (`_isLocal`/`ip`). Watt=`adc/5.5`. |
| `entity.py` | `DeviceInfo.model=deviceType`, `sw_version=swVersion.number`; Slaves via `via_device` an Master. |
| `sensor.py` | **Pro Spot** ein Temp-Sensor (Key `externalId`), gruppiert Lampe×Sektion (Links/Mitte/rechts). PAR=Watt×Faktor. |

**Fallstricke:** `temperature` kann fehlen (`:3`) → nullable. `/api/timelines.spots` sind volle Objekte (nicht
Indizes wie im Backup-File) → beim RMW opak lassen. `/api/devices` listet **nie** den Master.

## E. Referenz-Implementierung (App-Code, `../ati-straton-app/app/composeApp/src`)

Kotlin, aber 1:1 als Blaupause für Python lesbar:
- `net/StratonClient.kt` — Login, alle GETs, `putData`/`addTimeline`, `openSocket`.
- `net/StratonLive.kt` — **Socket.IO-EIO4-Client** (Handshake `0`/`40`, `42[event,payload]`, Ping `2`→Pong `3`).
- `net/LampTopology.kt` — Master/Slave + Gruppen + deviceType aus timelines/info/devices.
- `net/StatusModels.kt` — `SpotTemp`, `PowerInfo` (Watt), `ParDepth`, `DeviceInfo`, `DeviceEntry`.
- `discovery/*` — mDNS je Plattform (jmdns/NsdManager/NWBrowser) + `LampDiscovery`-Abstraktion.
- `editor/EditorModel.kt` + `ui/screens/ProgrammScreen.kt` — Kurven-Editor (Punkte ziehen, 0%-reversibel).

## F. UX-Konzept & Mockups (für die Panel-Neukonzeption)  ·  `../ati-straton-app/mockup/`, `docs/ati-app-features.md`

Das HA-Panel soll laut Projektziel weg von der 1:1-ATI-UI-Kopie hin zum **smarten Cockpit** (Progressive
Disclosure, à la ReefBeat/Mobius). Die App hat dieses Konzept bereits gebaut:
- Screens **Jetzt / Programm(-Editor) / Geräte / Mehr** (Bottom-Nav), dunkles Design-System.
- **Jetzt:** Intensitäts-Ring + Live-Pills (Leistung/Spot/PAR) + Gruppen + **Sektionen je Lampe** (D).
- Editor-Ideen: Palette-Dropdown mit Farbe+Name, „Wolken" = Zickzack-Generator (Cap 4/h), Play=Tagesverlauf-
  Cursor, „Übertragen auf alle", Gruppen ein/aus.
- Mockups: `mockup/straton_app.html` (Voll-App), `mockup/straton_cockpit.html` (Jetzt-Cockpit).
- **Entscheidungen** (Helligkeits-Faktor nicht-destruktiv, Effekt-Scope App vs. HA, Mond raus, Acclimation=HA)
  stehen im App-Session-Kontext; Feature-Inventur der ATI-App in `ati-app-features.md`.

---

### Nicht übernehmen (bleibt außen vor)
`/api/network`, `/api/wifis`, `/api/user`, `/api/reboot`, `/api/reset-device`, `/api/delete-spot`,
Firmware-Endpoints. ATIs proprietäre `*.min.js` **nie** committen (nur abgeleitete Erkenntnisse).
