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

- **Phase 1 — Read-only-Korrekturen (sicher, kein Hardware-Risiko):** ⟵ *aktuell in Arbeit*
  1. PAR-pro-Tiefe-Sensoren (`par_table`-Faktoren × Watt).
  2. Watt → `adc/5.5`.
  3. Spot-Temp-Sensoren nach **Sektion** benennen (Links/Mitte/rechts aus `externalId`-Index), `temperature=null` sauber.
- **Phase 2 — Fundament (kein realer Write):** Options-Flow (`write_enabled` Default AUS, `scan_interval`, `auto_save`) + `put_data`-Skelett (RMW, Debounce, `spots` opak) hinter Guard.
- **Phase 3 — Erste Steuerung (⚠️ reale Hardware, nur live mit Rene):** `light.straton_<gruppe>` ON/OFF (`timeline.active`) + Dimmen (Node-`value`) via `PUT /api/data`; zuerst rechts/0 %.
- **Phase 4 — Koexistenz & Live:** Single-Session-Pausier-Schalter; `python-socketio`-Client (`temperature-spots`/`changed-intensity`) statt/zusätzlich 30 s-Poll; Spot-Identität dann auf `externalId` re-keyen; ermöglicht transientes Live-Dimmen (`update-node`) für Override/Mondlicht.
- **Phase 5 — Komfort & UX:** mDNS-Discovery (A); Panel-Cockpit-Redesign (F); `number`/`select`/`button` (Kanäle, Profile via `/api/presettings`, Speichern).

## Guardrails
- Config-Entry ist **bewusst deaktiviert** → nur auf ausdrückliche Ansage reaktivieren. Live-Test nur, wenn die App **nicht** verbunden ist (Single-Session-Limit).
- Schreibpfade nicht raten (`PUT /api/data` ist verifiziert), erste Writes nur rechts/0 %.
- ATIs `*.min.js` nie committen; Kotlin nur als Blaupause lesen.
