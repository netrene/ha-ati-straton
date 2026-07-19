# Handover: App-Session-Erkenntnisse → HA-Integration (2026-07-19)

Quelle: Schwester-Repo `../ati-straton-app` (KMP-App, Branch `kmp-app`, Commit `b5d896e`).
Heute am **echten Gerät** (Master 192.168.0.22 + Slave .223, je „Straton Flex 153") verifiziert.
Kanonische Details stehen in **`docs/api-write.md`** (Abschnitt „Master/Slave-Topologie, Spots & Lampentyp").
Diese Datei ist das **Delta**: was die Integration konkret übernehmen sollte.

---

## 1. Verifizierte Fakten (neu/geschärft)

1. **Master aggregiert alles.** Der lokale Master liefert die Spots **beider** Lampen. Kein separater
   Connect zur Slave nötig. (Beantwortet die offene Frage O8 in `entity-architecture.md`: **ja, an den
   Master schreiben/lesen, er verteilt.**)
2. **`externalId = "<serial>:<spotIndex>"`** ist der stabile Schlüssel überall.
   - `spotIndex 0=Links, 1=Mitte, 2=rechts`; `:3` = unbestückter Platzhalter (kommt mit, ohne `temperature`).
   - Jede Programm-Gruppe (Links/Mitte/rechts) = **1 Master-Spot + 1 Slave-Spot** (gleicher spotIndex).
3. **Master/Slave-Unterscheidung** an den `/api/timelines`- bzw. `/api/spots`-Spot-Objekten:
   - **`_isLocal: true`** → Master (keine `ip`).
   - gesetztes **`ip`** → Slave (verlinkte Lampe).
4. **Lampentyp/Firmware kommen fertig von der Firmware:**
   - `GET /api/info` (Master): `{"id":114619,"isMaster":true,"deviceType":"Straton Flex 153","maxTemperature":60}`
   - `GET /api/devices` (nur **Slaves**): `[{"externalId":147335,"deviceType":"Straton Flex 153",
     "ip":"192.168.0.223","swVersion":{"number":"3.0.4","release":"2024.4-beta"},"t":31.82}]`
   - Serial-Match: `/api/info.id` und `/api/devices[].externalId` == `externalId.split(":")[0]`.
5. **Leistung (Watt) = `/api/current.adc / 5.5`** (kalibriert: adc 187 → 34 W).
   **PAR@Tiefe = Watt × Faktor** aus `/api/par-table` (34 W × 3 = 102 @30 cm).
6. **Live-Push via Socket.IO** (EngineIO v4, `/socket.io`, `EIO=4`, transport=websocket, `connect.sid`-Cookie):
   Event **`temperature-spots`** (~2 s, ein Eintrag je Spot beider Lampen) und **`changed-intensity`**.
   Die Weboberfläche **pollt nicht**. Payload je Spot:
   `{"temperature":31.8,"externalId":"147335:0","rawtemperature":[{"value":31.7,"addr":1},{"value":31.8,"addr":2}],"online":true}`.

---

## 2. Konkrete Deltas für die Integration

| Datei | Was übernehmen |
|---|---|
| `custom_components/ati_straton/api.py` | `get_info()`/`get_devices()` liefern `deviceType`/`swVersion` — nutzen. Optional: `python-socketio`-Client für `temperature-spots`/`changed-intensity` (Live statt Poll). |
| `coordinator.py` | Topologie bauen: Master = `info` (`isMaster`, `id`→serial, `deviceType`); Slaves = `get_devices()`; Spots aus `get_spots()`/`get_timelines()` je `externalId` (`_isLocal`/`ip`). Watt = `current.adc/5.5`. |
| `entity.py` | `DeviceInfo.model = deviceType` („Straton Flex 153"), `sw_version = swVersion.number`. Slaves via `via_device` an den Master hängen (Serial = `externalId`). |
| `sensor.py` (neu/erweitern) | **Pro Spot** ein Temperatur-Sensor, Schlüssel `externalId`, gruppiert nach Lampe (Master/Slave) + Sektion (Links/Mitte/rechts). PAR@Tiefe = Watt × `par-table`-Faktor. |

### Fallstricke (aus der App-Umsetzung)
- `temperature` kann **fehlen** (unbestückte `:3`-Slots) → nullable behandeln, `online` prüfen.
- `/api/timelines` liefert `spots` als **volle Objekte** (nicht Indizes wie im Backup-File) — beim
  Read-Modify-Write **opak durchreichen**, nicht typisiert wegparsen.
- `/api/devices` listet **nur die Slaves**, nie den Master — der Master steckt in `/api/info`.

---

## 3. Referenz-Implementierung (App)
- `net/LampTopology.kt` — Ableitung Master/Slave + Gruppen + deviceType aus timelines/info/devices.
- `net/StratonLive.kt` — Socket.IO-EIO4-Client (Handshake `0`/`40`, `42[event,payload]`, Ping `2`→Pong `3`).
- `net/StatusModels.kt` — `SpotTemp`, `PowerInfo` (Watt), `ParDepth`, `DeviceInfo`, `DeviceEntry`.
