# ATI Straton — Schreib- & Live-API (aus dem Quellcode verifiziert)

Quelle (2026-07-17): die Angular-App der Straton-Weboberfläche, **drei Bundles**:
`js/ati.min.js` (App-Modul/Services), **`js/controller/controller.min.js`** (Haupt-Controller),
**`js/angular-chart/ati-chart.min.js`** (Chart-Directive, Modul `chart.module`, D3 v7 + **Socket.IO**).

> **Korrektur einer früheren Annahme:** Es gibt **doch einen Live-Kanal** — die App lädt
> `socket.io/socket.io.js` und der Chart macht `io.connect()`. „Kein WebSocket" galt nur fürs
> *persistente Speichern* (das ist HTTP), **nicht** fürs Live-Preview.

## Übersicht: Schreib- & Live-Wege

| Zweck | Weg | Payload |
|---|---|---|
| **Programm dauerhaft speichern** (SPEICHERN) | `PUT /api/data` | `{ timelines, spots, colors }` → Resp. `{ lines, spots, colors }` |
| **Neue Gruppe anlegen** | `PUT /api/timeline` | `{ timelines }` → Server **erzeugt** neue Gruppe & gibt sie zurück |
| **Vorschau-Edits** (Preview-Modus) | `PUT /api/preview` | `{ timelines }` |
| **Gerätezeit setzen** | `POST /api/time` | `{ ts, offset }` |
| **LIVE ziehen/preview** | **Socket.IO** (`io.connect()`) | `emit("update-node", {parent,index,time,value,color})` · `emit("preview-timestamp",{value})` · `emit("preview-stop",{})` |

Auth = Session-Cookie `connect.sid`, kein CSRF. HTTP-Body = JSON (`$http`).

## SPEICHERN (persistentes Vollprogramm)

```js
// ati.min.js / controller
t.put("/api/data", { timelines, spots, colors })
 .success(e => { setTimelines(e.lines); spots=e.spots; colors=e.colors; isSaveButtonEnabled=false; })
// Toast "MODAL_SUCCESS_SAVE_MESSAGE" = die „gespeichert"-Meldung
```
- **Der** dauerhafte Save; kein getrennter „permanent"-Endpoint. Body-Struktur = `config-schema.md`.
- Request-Key `timelines`, **Response-Key `lines`**. Body enthält `spots` (das Voll-Backup „Datei" hatte
  stattdessen `version`). → O1/O3/O7 geklärt.

## Neue Gruppe anlegen (Antwort auf „wie legt man Gruppen an")

```js
// controller.min.js
i.addGroup = function () {
  a.put("/api/timeline", { timelines: r.timelines })
   .success(function (e) {
     r.timelines.push(e);   // Server liefert die NEUE Gruppe (mit _id, Defaults) zurück
     i.editGroup(e);        // öffnet sofort die Sektions-Zuordnung
   });
}
```
- **`PUT /api/timeline`** (Singular — **nicht** `/api/data`!) mit dem aktuellen `{timelines}`-Array.
  **Der Server erzeugt die neue Gruppe** (vergibt `_id`, Default-`linecolor`, Default-`nodes`) und gibt sie
  zurück. → offene Frage geklärt: **`_id`/Defaults sind serverseitig**, der Client baut die Gruppe nicht.
- **Sektions-Zuordnung** (`editGroup`): jeder Spot hat `_timelineId` = seine Gruppe. Zuordnen = `_timelineId`
  auf die Gruppen-`_id` setzen (`saveSections`). Spots werden pro Lampe gruppiert via
  `externalId.split(":")[0]`. **Jeder aktivierte Spot muss einer Gruppe gehören** sonst
  `ERROR_UNASSIGNED_SPOTS`.
- Danach `PUT /api/data` (SPEICHERN) persistiert das Ganze.
- **Für HA:** Gruppen anlegen/löschen bleibt eine seltene **Setup-Aufgabe** → weiterhin sinnvoll in der
  ATI-UI zu belassen (wie Netzwerk/Firmware). Technisch aber via `PUT /api/timeline` machbar.

## LIVE / Vorschau = Socket.IO (Antwort auf O2)

```js
// ati-chart.min.js
this._socket = io.connect();
// beim Ziehen eines Punktes IM Preview-Modus:
this._socket.emit("update-node", { parent, index, time, value, color });   // transient, kein Flash-Write
this._socket.emit("preview-timestamp", { value: previewTimestamp });        // Tages-/Zeit-Vorschau (alle 750 ms)
this._socket.emit("preview-stop", {});
// zusätzlich: PUT /api/preview { timelines }  (Preview-Node-Add)
```
- **Es GIBT einen transienten Live-Override — über Socket.IO** (`update-node`), nicht HTTP.
  → **O2 revidiert: JA.** Live-Änderung ohne Persistenz = `emit("update-node", …)`; das ist der Weg für
  „Live Mode" / Sofort-Vorschau **ohne Flash-Verschleiß**.
- **HA-Konsequenz — sauberer Split:**
  - **Persistente** Programmänderung → `PUT /api/data` (HTTP, einfach, aber Flash-Write → Debounce).
  - **Transientes** Dimmen / Manual-Override mit Auto-Return / **Mondlicht-Modulation** → **Socket.IO
    `update-node`** (kein Flash-Verschleiß). Braucht in Python einen Socket.IO-Client (`python-socketio`)
    → mehr Aufwand, aber ideal für häufige Live-Änderungen.

## Socket.IO LIVE verifiziert (2026-07-19, an der echten Weboberfläche gemessen)

Die Weboberfläche **pollt NICHT** (0 fetch/XHR über Sekunden) — alle Live-Werte kommen per **Socket.IO-Push**:
- **EngineIO v4** (`EIO=4`), Transport **websocket**, Pfad **`/socket.io`**, URI `http://192.168.0.22`, `pingInterval 25000` / `pingTimeout 60000`. Auth = derselbe `connect.sid`-Cookie.
- **Server → Client Push-Events** (Client hört auf): `connect`/`connecting`/`disconnect`/`reconnect`/`logout`,
  **`temperature-spots`** (alle ~2 s, Payload `[{temperature, externalId:"serial:sektion", rawtemperature:[{value,addr}], online}]`),
  **`changed-intensity`** (bei Intensitätsänderung), **`new-spots`**, **`intensity-auto-correction`**.
- **Leistung** = `GET /api/current` → `{adc, max, warn, isWarning, isDanger}` (ADC-Wert von max, Warn-/Gefahr-Schwellen; kein Watt). Einmal laden, per `changed-intensity` aktualisieren.
- **PAR = berechnet, nicht gemessen:** `GET /api/par-table` → Tiefen-Faktoren `[{label:"30cm",factor:3},{"45cm",2.1},{"60cm",1.5},{"75cm",1.25}]`. PAR@Tiefe = aktuelle Leistung × Faktor.

→ **App-Umsetzung:** Ktor-WebSocket-Client (commonMain) spricht EIO4/SIO-Framing (`0`/`40` Handshake, `42["event",payload]`, Ping `2`→Pong `3`); `temperature-spots`+`changed-intensity` abonnieren, `/api/current`+`/api/par-table` einmal laden → Jetzt zeigt live Temp/Leistung/PAR ohne Polling.

## Master/Slave-Topologie, Spots & Lampentyp (live verifiziert 2026-07-19)

Der lokale Master **aggregiert alle verlinkten Lampen** — eine einzige Verbindung liefert alle Spot-Werte beider Lampen. Kein separater Connect zur Slave nötig.

**`externalId` = `"<Seriennummer>:<SpotIndex>"`** ist der Schlüssel überall (Live-Stream **und** `/api/timelines`-Spots):
- `SpotIndex 0 = Links, 1 = Mitte, 2 = rechts` (bei jeder Lampe identisch). `:3` = unbestückter Platzhalter-Slot (kommt im Stream mit, ohne `temperature`).
- Jede Programm-Gruppe (Links/Mitte/rechts) bündelt genau **1 Master-Spot + 1 Slave-Spot** (gleicher SpotIndex).

**`temperature-spots`-Payload** (alle ~2 s, ein Eintrag je Spot **beider** Lampen):
```json
{"temperature":31.8, "externalId":"147335:0",
 "rawtemperature":[{"value":31.7,"addr":1},{"value":31.8,"addr":2}], "online":true}
// unbestückt: {"externalId":"114619:3","online":false}   // KEIN temperature-Feld
```
`temperature` = Repräsentativwert des Spots; `rawtemperature` = die zwei Sub-Sensoren (Adressen) je Spot. `temperature` kann fehlen → nullable behandeln.

**`/api/timelines`-Spots sind volle OBJEKTE** (nicht nur Indizes wie im Backup-File). Pro Spot u.a.:
`externalId`, `temperature`, `rawtemperature`, `channels[]`/`_colorChannels{}` (Kanal→address-Mapping mit `max`/`factor`/`valueTemperature`), `customName`, **`_isLocal`** (true = Master/lokal), **`ip`** (nur bei Slaves gesetzt).
→ Master vs. Slave unterscheidet man an **`_isLocal:true`** (Master, keine `ip`) bzw. gesetzter **`ip`** (Slave).

**Lampentyp/Modell kommt fertig von der Firmware:**
- **`GET /api/info`** (lokaler Master): `{"id":114619, "isMaster":true, "deviceType":"Straton Flex 153", "maxTemperature":60, "adc":true, "deviceMessages":{"parInfo":"FLEX_PAR_INFO"}}`
- **`GET /api/devices`** (nur die **verlinkten Slaves**, nicht der Master): `[{"externalId":147335, "deviceType":"Straton Flex 153", "ip":"192.168.0.223", "swVersion":{"number":"3.0.4","release":"2024.4-beta"}, "customName":"ATI-Straton-147335", "t":31.82}]`
- Serial-Match: `/api/info.id` (Master) und `/api/devices[].externalId` (Slaves) sind die Serials aus `externalId.split(":")[0]`. So ordnet man `deviceType`/Firmware jeder physischen Lampe zu.

**Leistung (Watt):** `/api/current.adc / 5.5` (kalibriert: adc 187 → 34 W). **PAR@Tiefe** = Watt × Tiefenfaktor aus `/api/par-table` (verifiziert: 34 W × 3 = 102 @30 cm).

## Profile / Voreinstellungen

- **`GET /api/presettings`** → Liste; Client teilt in Werk (`isCustom:false`) und eigene (`isCustom:true`).
- Eigenes Profil speichern → `/api/custom-presetting` (+ Chart-Event `save-as-custom-presettings`).
- Gruppen-Profil-Referenz bleibt `timeline.presetting:{id,title}` (siehe `config-schema.md`).

## Vollständige API-Oberfläche (aus controller.min.js + Modulen)

```
Lesen:   /api/current /api/info /api/state /api/timeinfo /api/time /api/timestring
         /api/timelines /api/timeline /api/spots /api/colors /api/channels /api/devices
         /api/temperatures /api/uptime /api/version /api/par-table /api/demo
         /api/presettings /api/ignoreHelpDialogs /api/wifis /api/wifistatus /api/timezone
         /api/start-up-time /data/timezones.json
Schreiben (HTTP): PUT /api/data · PUT /api/timeline · PUT /api/preview · POST /api/time
         POST /api/timezone · POST /api/start-up-time · /api/custom-presetting · /api/indicate-spots
Live:    Socket.IO  emit: update-node, preview-timestamp, preview-stop
⛔ System (NICHT in HA): /api/network /api/wifis /api/user /api/reboot /api/reset-device
         /api/delete-spot /api/create-support-file /api/support-file
         /api/check-online-firmware-update /api/download-online-firmware-update
```

## Für die HA-Integration

1. **Phase 1–3 (persistent):** alles über `PUT /api/data` (Read-Modify-Write des Vollprogramms). Debounce.
2. **Optional/besser für Live (Phase 4+):** Socket.IO-Client für `update-node` → transientes Dimmen &
   Mondlicht-Modulation ohne Flash-Verschleiß.
3. **Gruppen anlegen/Sektionen:** `PUT /api/timeline` + `_timelineId`-Zuordnung — aber eher Setup-Aufgabe,
   default in ATI-UI belassen.
4. **⛔** Netzwerk/User/Reboot/Reset/Firmware/Spot-Löschen bleiben außen vor.
