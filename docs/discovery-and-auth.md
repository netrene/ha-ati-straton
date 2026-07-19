# ATI Straton — Discovery & Authentifizierung

Verifizierte Befunde (2026-07-19, live an Renes LAN + aus dem statischen JS). Ergänzt
`api-write.md` (API-Oberfläche) und `config-schema.md` (Datenmodell).

## 1. Geräte-Discovery = mDNS / Bonjour

**Die Straton kündigt sich per mDNS an** — die App braucht **keine fest verdrahtete IP** (DHCP-fest).

- Service-Typ: **`_http._tcp.local.`**
- Instanzname: **`ATI-Straton-<Seriennummer>`** — z.B. `ATI-Straton-114619` (Master), `ATI-Straton-147335` (Slave).
- Port: **80** (Web-UI läuft auf `http://…` ohne Portangabe).
- **Live verifiziert:** passiver `dns-sd -B _http._tcp local.` fand beide Lampen sofort.

### App-Logik
1. `_http._tcp.local.` browsen, Instanzen mit Präfix `ATI-Straton-` filtern.
2. Instanz → Host/IP:Port auflösen (SRV/A-Record). Seriennummer steckt im Namen.
3. **Master finden:** `GET /api/info` (`isMaster`) bzw. `GET /api/devices` (Master listet alle Lampen).
   Writes gehen an den **Master** (er verteilt an die Slaves, offene Frage O8).
4. **Fallback:** manuelle IP-Eingabe (gemerkt) — falls mDNS blockiert ist.

### ⚠️ Netz-Caveat (VLAN/AP-Isolation)
Renes WLAN: **WELTNETZ** (Haupt) + **IoT_2G** (IoT). Hängt die Lampe auf IoT_2G und das Handy auf
WELTNETZ und sind die Netze isoliert, kommt **weder mDNS-Multicast noch direkter HTTP-Zugriff** rüber.
Discovery + App-Zugriff setzen voraus, dass das **Handy im selben (oder gebrückten) Netz** wie die Lampe ist.

### KMP-Umsetzung (plattformspezifisch → expect/actual)
- **Android:** `NsdManager` (braucht `Context`).
- **iOS:** `NWBrowser` (Network-Framework).
- **Desktop (JVM):** `jmdns`.
- `commonMain`: `LampDiscovery`-Interface (liefert `DiscoveredLamp`), plus Manuell-IP-Pfad.

## 2. Authentifizierung = HTML-Formular-Login (kein JSON-API-Login!)

Der Login läuft **nicht** über `/api/…`, sondern als klassisches Server-Session-Login:

- **`POST /login`**, `Content-Type: application/x-www-form-urlencoded`, Body **`username=<user>&password=<pass>`**
  (Feldnamen `username` / `password`, aus der `/login`-Formularseite verifiziert).
- Bei Erfolg setzt der Server das Session-Cookie **`connect.sid`** → danach funktionieren alle `/api/*`-Requests mit dem Cookie.
- Ohne Session: `GET /` → **`302 /login`**. Die Angular-App macht bei 401/`logout` selbst `window.location="/login"`.
- `GET /api/user` liefert den User (Passwort geblankt) — für die Einstellungen, **nicht** zum Login.

### App-Logik
1. Beim Verbinden: `POST /login` mit `username`/`password` → Cookie-Jar hält `connect.sid`.
2. Alle `/api/*`-Requests nutzen das Cookie automatisch.
3. Bekommt ein Request die Login-Seite/302 zurück → Session abgelaufen → neu einloggen.

> ⚠️ ATIs minifizierte JS/HTML **nicht** ins Repo committen — hier stehen nur die Erkenntnisse.
> Werksstandard `admin`/`admin`; Renes Passwort ist gesetzt (kennt Rene). Passwort-/Netz-/Firmware-
> Endpoints (`POST /api/user`, `/api/network`, `/api/reboot` …) bleiben ⛔ außen vor (Sicherheit).
