# HA-Integration — Umsetzungsplan (aus Handover 2026-07-19)

Abgeleitet aus `HANDOVER-2026-07-19-app-session.md` (Punkte A–F) + Abgleich mit dem Ist-Stand
(`api.py`, `coordinator.py`, `entity.py`, `config_flow.py`, `sensor.py`, `panel.py`). Referenz-Docs:
`api-write.md`, `discovery-and-auth.md`, `config-schema.md`, `entity-architecture.md`.

## Ist-Stand vs. Handover

| Punkt | Schon da | Lücke |
|---|---|---|
| **A** mDNS-Discovery | — | Nur manuelle Host-Eingabe; kein `zeroconf` im manifest/config_flow. |
| **B** Auth | ✅ `POST /login` (urlencoded) → `connect.sid`, Re-Auth bei 401 (deckt `discovery-and-auth.md`). | Kein Single-Session-Handling (Pausier-Schalter), kein Options-Flow. |
| **C** Schreiben/Gruppen | ✅ Lese-Modell + Node-Interpolation. | **Kein Write** (`put_data`/RMW/Debounce/Guard), keine `light/number/switch/select/button`. |
| **D** Live/Topologie/Typ | ✅ `entity.py`: `model=deviceType`, Slaves `via_device`, per-Device `swVersion`; GETs da; per-Spot-Temp. | **PAR-Sensoren fehlen**; Watt-Formel ~3 % daneben; Spot-Naming nicht nach Sektion; **Socket.IO-Live-Push fehlt**. |
| **E** Referenz-Impl. | — | Kotlin (`../ati-straton-app/app/composeApp/src`) nur lesen. |
| **F** Panel | Read-only (läuft). | Noch 1:1-ATI-Kopie; Cockpit-Redesign offen. |

**Watt-Detail:** aktuell `adc·0.1875` (≈ `adc/5.33`), verifiziert `adc/5.5` (~3 % Diff).

## Phasen (priorisiert)

- **Phase 1 — Read-only-Korrekturen (sicher, kein Hardware-Risiko):** ✅ **released v0.3.0**
  1. PAR-pro-Tiefe-Sensoren (`par_table`-Faktoren × Watt).
  2. Watt → `adc/5.5`.
  3. Spot-Temp-Sensoren nach **Sektion** benennen (Links/Mitte/rechts aus `externalId`-Index), `temperature=null` sauber.
- **Geräte-Namensschema** (v0.4.0): `<deviceType>-<serial>-<Master|Slave>`, aus einer gemeinsamen Quelle (`lamp_device_info`), damit der Master nicht zwei Namen bekommt.
- **Phase 2 — Fundament (kein realer Write):** ✅ **v0.4.0** — Options-Flow (`write_enabled` Default AUS, `scan_interval`, `auto_save`) + gated `api.put_data()` (`PUT /api/data`, `spots` opak) + Coordinator-RMW-Helfer `async_apply_timelines()`. Debounce kommt mit der ersten Control-Entity (Phase 3).
- **Phase 3 — Erste Steuerung (⚠️ reale Hardware, nur live mit Rene):** `light.straton_<gruppe>` ON/OFF (`timeline.active`) + Dimmen (Node-`value`) via `PUT /api/data`; zuerst rechts/0 %.
- **Phase 4 — Koexistenz & Live:** Single-Session-Pausier-Schalter; `python-socketio`-Client (`temperature-spots`/`changed-intensity`) statt/zusätzlich 30 s-Poll; Spot-Identität dann auf `externalId` re-keyen; ermöglicht transientes Live-Dimmen (`update-node`) für Override/Mondlicht.
- **Panel-Cockpit-Redesign (F):**
  - **R1 — Read-only-Cockpit** ✅ **v0.5.0**: neue `frontend/panel.js` (Übersicht + Programm-Kurve) live an `program/list`, HA-theme-aware (Nebentöne via `color-mix` aus HA-Vars). Payload um `par` erweitert, Watt in `panel.py` auf `adc/5.5` gefixt, `PANEL_VERSION`-Bump (cache-bust). Kein Write.
  - **R1.1 — Sektionen-Kacheln + Editor-Auswahl** ✅ **v0.6.0**: Übersicht-Spots als **Kacheln pro Lampe** (Master/Slave, Links/Mitte/rechts-Temp; Payload um `lamps` erweitert). Programm: Stützstellen-Liste raus → **Punkt anklicken → Punkt-Editor unten** (Zeit/%-Stepper, +Punkt, Löschen), Auswahl hervorgehoben. Bearbeitung **rein lokal** (Arbeitskopie, Live-Redraw, Speicher-Leiste); **„Speichern" gesperrt** (= R2). Fix: Auto-Refresh verwirft Auswahl/Edits nicht mehr.
  - **R2 — Editor mit Schreiben** *(offen)*: `Speichern` wiren → neuer WS-Befehl `ati_straton/program/save` → `coordinator.async_apply_timelines()` (hinter `write_enabled`, Debounce), zuerst rechts/0 %, **live mit Rene**. Dazu offen: Gesamtintensitäts-Slider (lokal→save), Palette-Wechsel je Punkt, Kurven-Templates (Vorlagen/Wolken/Ränder/Zeit), Play/Vorschau, Punkt-Drag.
- **Phase 5 — Komfort:** mDNS-Discovery (A); `number`/`select`/`button` bzw. Panel-Aktionen (Kanäle, Profile via `/api/presettings`).

## Guardrails
- Config-Entry ist **bewusst deaktiviert** → nur auf ausdrückliche Ansage reaktivieren. Live-Test nur, wenn die App **nicht** verbunden ist (Single-Session-Limit).
- Schreibpfade nicht raten (`PUT /api/data` ist verifiziert), erste Writes nur rechts/0 %.
- ATIs `*.min.js` nie committen; Kotlin nur als Blaupause lesen.
