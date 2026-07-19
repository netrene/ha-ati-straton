// ATI Straton — read-only cockpit panel (R1).
// Live data via the `ati_straton/program/list` websocket command. No writes.
// Design adapted from the app-session mockup (aqua cockpit, theme-aware).

const CHANNEL_COLORS = {
  UV: "#7c4dff",
  V: "#a341e0",
  RB: "#2f5bff",
  B: "#1e9bf0",
  LC: "#22c1d6",
  C: "#22c1d6",
  W: "#c9d4dc",
  R: "#ff5a5a",
};

// The lamp calls the cyan channel "LC" internally; the ATI UI shows it as "C".
const channelLabel = (name) => (name === "LC" ? "C" : name);

class ATIStratonProgramPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
    this._loaded = false;
    this._loading = false;
    this._error = "";
    this._programs = [];
    this._entryId = "";
    this._timelineId = "";
    this._view = "overview";
    this._timer = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) {
      this._load();
    }
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = Boolean(value);
    this._updateMenuButton();
  }

  get narrow() {
    return this._narrow;
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this._render();
    this._timer = setInterval(() => {
      if (this._hass && !this._loading) this._load();
    }, 10000);
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _load() {
    if (!this._hass) return;
    this._loading = true;
    if (!this._loaded) this._render();
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "ati_straton/program/list",
      });
      this._programs = (result && result.programs) || [];
      this._error = "";
      if (!this._entryId && this._programs.length) {
        this._entryId = this._programs[0].entry_id;
      }
      const program = this._program();
      if (program && !this._selectedTimeline() && program.timelines.length) {
        this._timelineId = String(program.timelines[0].id);
      }
      this._loaded = true;
    } catch (err) {
      this._error = (err && err.message) || "Programm konnte nicht geladen werden.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _program() {
    return (
      this._programs.find((p) => p.entry_id === this._entryId) ||
      this._programs[0]
    );
  }

  _selectedTimeline() {
    const program = this._program();
    if (!program) return null;
    return (
      program.timelines.find((t) => String(t.id) === this._timelineId) || null
    );
  }

  _onClick(event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "menu") {
      this.dispatchEvent(
        new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
      );
    } else if (action === "reload") {
      this._loaded = false;
      this._load();
    } else if (action === "view") {
      this._view = btn.dataset.view;
      this._render();
    } else if (action === "tab") {
      this._timelineId = btn.dataset.id;
      this._render();
    }
  }

  _onChange(event) {
    const select = event.target.closest('select[name="program"]');
    if (select) {
      this._entryId = select.value;
      this._timelineId = "";
      const program = this._program();
      if (program && program.timelines.length) {
        this._timelineId = String(program.timelines[0].id);
      }
      this._render();
    }
  }

  // ---------- rendering ----------

  _render() {
    const program = this._program();
    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <button class="menu" data-action="menu" aria-label="Menu">
        <span class="menu-icon"></span>
      </button>
      <div class="wrap">
        ${this._header(program)}
        ${
          this._error
            ? `<div class="notice error">${this._esc(this._error)}</div>`
            : ""
        }
        ${
          !this._loaded && this._loading
            ? `<div class="notice">Programm wird geladen…</div>`
            : ""
        }
        ${
          this._loaded && !this._programs.length
            ? `<div class="notice">Keine ATI Straton Integration geladen.</div>`
            : ""
        }
        ${program ? this._nav() : ""}
        ${
          program && this._view === "overview"
            ? this._overview(program)
            : ""
        }
        ${
          program && this._view === "program"
            ? this._programView(program)
            : ""
        }
      </div>
    `;
    this._updateMenuButton();
  }

  _header(program) {
    const device = (program && program.device) || {};
    const refresh = program && program.last_successful_refresh
      ? new Date(program.last_successful_refresh).toLocaleTimeString()
      : "–";
    const cur = (program && program.current) || {};
    const status = cur.warning || cur.danger ? "warn" : "ok";
    return `
      <header>
        <div class="id">
          <span class="glyph">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          </span>
          <div class="names">
            <strong>${this._esc((program && program.title) || "ATI Straton")}</strong>
            <span>${this._esc(device.type || "Straton Flex")} · ${this._esc(device.software || "–")} · Stand ${this._esc(refresh)}</span>
          </div>
        </div>
        <div class="head-right">
          <span class="chip ${status}">${status === "ok" ? "OK" : "Warnung"}</span>
          <button class="btn" data-action="reload" ${this._loading ? "disabled" : ""}>Aktualisieren</button>
        </div>
      </header>
    `;
  }

  _nav() {
    const tab = (view, label) =>
      `<button class="navbtn ${this._view === view ? "active" : ""}" data-action="view" data-view="${view}">${label}</button>`;
    const selector =
      this._programs.length > 1
        ? `<select name="program" aria-label="Leuchte">${this._programs
            .map(
              (p) =>
                `<option value="${this._esc(p.entry_id)}" ${p.entry_id === this._entryId ? "selected" : ""}>${this._esc(p.title)}</option>`
            )
            .join("")}</select>`
        : "";
    return `<div class="nav">${tab("overview", "Übersicht")}${tab("program", "Programm")}${selector}</div>`;
  }

  // ----- overview -----

  _overview(program) {
    const cur = program.current || {};
    const par = program.par || [];
    const pills = [
      `<span class="pill">Leistung <b>${cur.estimated_power ?? "–"}</b> W</span>`,
      ...par.map(
        (p) => `<span class="pill">PAR ${this._esc(p.label)} <b>${p.value ?? "–"}</b></span>`
      ),
    ].join("");

    const groups = program.timelines
      .map((t) => {
        const on = t.active !== false;
        const intensity = this._fmt(t.current_intensity);
        return `
          <div class="row">
            <span class="swatch" style="background:${this._esc(t.linecolor || "var(--acc)")}"></span>
            <div class="row-main">
              <div class="row-top"><span class="row-name">${this._esc(t.name || t.id)}</span>
                <span class="row-val ${on ? "" : "off"}">${on ? intensity + " %" : "Aus"}</span></div>
              <div class="bar"><span class="fill" style="width:${on ? Math.max(0, Math.min(100, Number(t.current_intensity) || 0)) : 0}%"></span></div>
              <div class="row-sub">${(t.spots || []).length} Spots · nächster Wechsel ${this._esc(this._hhmm(t.next_change))}</div>
            </div>
          </div>`;
      })
      .join("");

    const spots = (program.spots || [])
      .filter((s) => s.enabled !== false)
      .map((s) => {
        const section = this._section(s.external_id);
        const temp = s.temperature != null ? `${this._fmt(s.temperature)} °C` : "–";
        return `
          <div class="row compact">
            <div class="row-main">
              <div class="row-name">${this._esc(section ? section : s.name || s.external_id)}</div>
              <div class="row-sub">${this._esc(s.external_id || "")}</div>
            </div>
            <span class="chip ${s.online ? "ok" : "off"}">${s.online ? "Online" : "Offline"}</span>
            <span class="temp">${temp}</span>
          </div>`;
      })
      .join("");

    return `
      <section class="card pad">
        <div class="live">${pills}</div>
      </section>
      <section class="card">
        <p class="label">Gruppen</p>
        <div class="list">${groups || `<div class="row"><div class="row-main">Keine Gruppen</div></div>`}</div>
      </section>
      <section class="card">
        <p class="label">Spots</p>
        <div class="list">${spots || `<div class="row"><div class="row-main">Keine Spots</div></div>`}</div>
      </section>
    `;
  }

  // ----- program (curve) -----

  _programView(program) {
    const timeline = this._selectedTimeline() || program.timelines[0];
    if (!timeline) return `<div class="notice">Kein Programm.</div>`;
    const tabs = program.timelines
      .map(
        (t) =>
          `<button class="tab ${String(t.id) === String(timeline.id) ? "active" : ""}" data-action="tab" data-id="${this._esc(String(t.id))}">${this._esc(t.name || t.id)}</button>`
      )
      .join("");
    const nodes = (timeline.nodes || [])
      .slice()
      .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    const active = this._activeColor(nodes);

    return `
      <div class="tabs">${tabs}</div>
      <section class="card">
        <div class="curve-head">
          <div><strong>${this._esc(timeline.name || "Gruppe")}</strong>
            <span class="muted">${nodes.length} Punkte · ${this._fmt(timeline.current_intensity)} % jetzt</span></div>
          <span class="chip ${timeline.active !== false ? "ok" : "off"}">${timeline.active !== false ? "Aktiv" : "Inaktiv"}</span>
        </div>
        <div class="curve">${this._curve(timeline, nodes)}</div>
      </section>
      <section class="card">
        <p class="label">Stützstellen</p>
        <div class="list">${this._nodeList(nodes)}</div>
      </section>
      <section class="card pad">
        <p class="label" style="margin-top:0">Aktuelles Spektrum</p>
        ${active ? this._spectrum(active) : `<div class="muted">Kein Spektrum aktiv.</div>`}
      </section>
    `;
  }

  _curve(timeline, nodes) {
    const W = 920,
      H = 320,
      pl = 44,
      pt = 18,
      pr = 16,
      pb = 30;
    const iw = W - pl - pr,
      ih = H - pt - pb;
    const line = timeline.linecolor || "var(--acc)";
    const X = (sec) => pl + (Math.max(0, Math.min(86400, Number(sec) || 0)) / 86400) * iw;
    const Y = (v) => pt + (1 - Math.max(0, Math.min(100, Number(v) || 0)) / 100) * ih;
    const pts = nodes.map((n) => ({ x: X(n.time), y: Y(n.value), n }));
    const path = pts
      .map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const area = pts.length
      ? `${path} L ${pts[pts.length - 1].x.toFixed(1)} ${pt + ih} L ${pts[0].x.toFixed(1)} ${pt + ih} Z`
      : "";
    const nowSec = this._nowSeconds();
    const nowX = X(nowSec);

    const grid = [0, 25, 50, 75, 100]
      .map((t) => {
        const y = Y(t);
        return `<line class="grid" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/><text class="axis" x="8" y="${y + 4}">${t}</text>`;
      })
      .join("");
    const xaxis = [0, 6, 12, 18, 24]
      .map((h) => {
        const x = pl + (h / 24) * iw;
        return `<text class="axis" text-anchor="middle" x="${x}" y="${H - 10}">${String(h).padStart(2, "0")}:00</text>`;
      })
      .join("");
    const dots = pts
      .map((p) => {
        const c = (p.n.color && p.n.color.bgColor) || line;
        return `<circle class="node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.5" fill="${this._esc(c)}"/>`;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tageskurve">
        ${grid}${xaxis}
        ${area ? `<path class="area" style="fill:${this._esc(line)}" d="${area}"/>` : ""}
        ${path ? `<path class="cline" style="stroke:${this._esc(line)}" d="${path}"/>` : ""}
        <line class="now" x1="${nowX}" y1="${pt}" x2="${nowX}" y2="${pt + ih}"/>
        <text class="now-t" text-anchor="middle" x="${Math.max(pl + 12, Math.min(W - pr - 12, nowX))}" y="${pt - 4}">jetzt</text>
        ${dots}
      </svg>
    `;
  }

  _nodeList(nodes) {
    if (!nodes.length) return `<div class="row"><div class="row-main">Keine Punkte</div></div>`;
    return nodes
      .map((n) => {
        const c = (n.color && n.color.bgColor) || "var(--acc)";
        const name = (n.color && n.color.name) || "–";
        return `
          <div class="row compact">
            <span class="dot" style="background:${this._esc(c)}"></span>
            <div class="row-main">
              <div class="row-name">${this._esc(n.time_label || "–")} · ${this._fmt(n.value)} %</div>
              <div class="row-sub">${this._esc(name)}</div>
            </div>
          </div>`;
      })
      .join("");
  }

  _spectrum(color) {
    const values = (color.values || [])
      .slice()
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    if (!values.length) return `<div class="muted">Keine Kanalwerte.</div>`;
    const bars = values
      .map((v) => {
        const pct = Math.max(0, Math.min(100, (Number(v.value) || 0) / 2.55));
        const col = CHANNEL_COLORS[v.name] || "var(--acc)";
        return `
          <div class="chan">
            <span class="cn">${this._esc(channelLabel(v.name))}</span>
            <span class="track"><span class="cfill" style="width:${pct}%;background:${col}"></span></span>
            <span class="cv">${v.value ?? "–"}</span>
          </div>`;
      })
      .join("");
    return `
      <div class="row compact">
        <span class="dot" style="background:${this._esc(color.bgColor || "var(--acc)")}"></span>
        <div class="row-main"><div class="row-name">${this._esc(color.name || "Spektrum")}</div>
          <div class="row-sub">Kanalwerte 0–255</div></div>
      </div>
      <div class="spectrum">${bars}</div>
    `;
  }

  // ---------- helpers ----------

  _activeColor(nodes) {
    const now = this._nowSeconds();
    let active = nodes[0];
    for (const n of nodes) {
      if ((Number(n.time) || 0) <= now) active = n;
    }
    return active && active.color;
  }

  _nowSeconds() {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  _section(externalId) {
    const s = String(externalId || "");
    if (!s.includes(":")) return null;
    return { 0: "Links", 1: "Mitte", 2: "rechts" }[s.split(":")[1]] || null;
  }

  _fmt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  _hhmm(iso) {
    if (!iso) return "–";
    const parts = String(iso).split(":");
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return String(iso);
  }

  _updateMenuButton() {
    const btn = this.shadowRoot.querySelector(".menu");
    if (btn) btn.style.display = this._narrow ? "grid" : "none";
  }

  _esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _css() {
    return `
      :host {
        --bg: var(--primary-background-color, #eef3f7);
        --card: var(--ha-card-background, var(--card-background-color, #ffffff));
        --border: var(--divider-color, rgba(127,127,127,.22));
        --text: var(--primary-text-color, #0c1c28);
        --muted: var(--secondary-text-color, #5a7183);
        --acc: var(--primary-color, #0e9fb5);
        /* Secondary tones derived from the HA theme so they follow light/dark
           automatically (never fight prefers-color-scheme). */
        --card2: color-mix(in srgb, var(--text) 6%, var(--card));
        --acc-soft: color-mix(in srgb, var(--acc) 14%, transparent);
        --good: var(--success-color, #2e9e4f);
        --warn: var(--warning-color, #c9761a);
        display: block; min-height: 100vh; background: var(--bg); color: var(--text);
        font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
      }
      * { box-sizing: border-box; }
      .wrap { width: min(1080px, calc(100vw - 24px)); margin: 0 auto; padding: 20px 0 48px;
        display: flex; flex-direction: column; gap: 14px; }
      .menu { position: fixed; top: 8px; left: 8px; z-index: 3; width: 44px; height: 44px; display: none;
        place-items: center; border: 0; background: transparent; color: var(--text); cursor: pointer; }
      .menu-icon, .menu-icon::before, .menu-icon::after { display: block; width: 20px; height: 2px;
        border-radius: 9px; background: currentColor; position: relative; }
      .menu-icon::before, .menu-icon::after { content: ""; position: absolute; left: 0; }
      .menu-icon::before { top: -6px; } .menu-icon::after { top: 6px; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
      .id { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .glyph { width: 40px; height: 40px; border-radius: 11px; flex: 0 0 auto; display: grid; place-items: center;
        background: linear-gradient(150deg, var(--acc), #2f5bff); color: #fff; }
      .glyph svg { width: 22px; height: 22px; }
      .names strong { display: block; font-size: 17px; }
      .names span { display: block; font-size: 12.5px; color: var(--muted); }
      .head-right { display: flex; align-items: center; gap: 10px; }
      .btn { min-height: 38px; border: 1px solid var(--border); border-radius: 9px; background: var(--card);
        color: var(--text); font: inherit; font-size: 13.5px; padding: 0 14px; cursor: pointer; }
      .btn[disabled] { opacity: .5; cursor: default; }
      .nav { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .navbtn { border: 1px solid var(--border); background: var(--card); color: var(--muted); font: inherit;
        font-weight: 650; font-size: 14px; padding: 9px 18px; border-radius: 999px; cursor: pointer; }
      .navbtn.active { background: var(--acc-soft); border-color: color-mix(in srgb, var(--acc) 50%, transparent); color: var(--acc); }
      select { margin-left: auto; min-height: 38px; border: 1px solid var(--border); border-radius: 9px;
        background: var(--card); color: var(--text); font: inherit; padding: 0 10px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
      .card.pad { padding: 16px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase;
        color: var(--muted); margin: 14px 16px 8px; }
      .live { display: flex; gap: 8px; flex-wrap: wrap; }
      .pill { font-size: 13px; background: var(--card2); border: 1px solid var(--border); padding: 7px 11px;
        border-radius: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .pill b { color: var(--text); }
      .list { display: flex; flex-direction: column; }
      .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
      .row + .row { border-top: 1px solid var(--border); }
      .row.compact { padding: 10px 16px; }
      .row-main { flex: 1 1 auto; min-width: 0; }
      .row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .row-name { font-size: 14px; font-weight: 650; }
      .row-val { font-family: ui-monospace, monospace; font-weight: 650; }
      .row-val.off { color: var(--muted); }
      .row-sub { margin-top: 3px; font-size: 12px; color: var(--muted); }
      .bar { margin-top: 8px; height: 7px; border-radius: 99px; background: var(--card2); border: 1px solid var(--border); overflow: hidden; }
      .fill { height: 100%; background: var(--acc); }
      .swatch { width: 34px; height: 34px; border-radius: 9px; flex: 0 0 auto; border: 1px solid var(--border); }
      .dot { width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto; border: 1px solid var(--border); }
      .temp { font-family: ui-monospace, monospace; font-size: 13px; }
      .chip { flex: 0 0 auto; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px;
        background: var(--card2); color: var(--muted); }
      .chip.ok { background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good); }
      .chip.off, .chip.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
      .tabs { display: flex; gap: 6px; overflow-x: auto; }
      .tab { white-space: nowrap; border: 1px solid var(--border); background: var(--card); color: var(--muted);
        font: inherit; font-weight: 650; font-size: 13px; padding: 8px 15px; border-radius: 999px; cursor: pointer; }
      .tab.active { background: var(--acc-soft); border-color: color-mix(in srgb, var(--acc) 50%, transparent); color: var(--acc); }
      .curve-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
      .curve-head strong { font-size: 16px; } .muted { color: var(--muted); font-size: 12.5px; }
      .curve { padding: 10px 8px; }
      svg { display: block; width: 100%; height: auto; }
      .grid { stroke: var(--border); stroke-width: 1; }
      .axis { fill: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
      .cline { fill: none; stroke-width: 2.6; stroke-linejoin: round; stroke-linecap: round; }
      .area { opacity: .1; }
      .node { stroke: var(--card); stroke-width: 2.5; }
      .now { stroke: var(--acc); stroke-width: 1.5; stroke-dasharray: 5 5; }
      .now-t { fill: var(--acc); font-size: 11px; font-weight: 700; }
      .spectrum { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
      .chan { display: grid; grid-template-columns: 34px 1fr 40px; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; }
      .cn { font-family: ui-monospace, monospace; font-weight: 700; }
      .cv { text-align: right; font-family: ui-monospace, monospace; }
      .track { height: 8px; border-radius: 99px; background: var(--card2); border: 1px solid var(--border); overflow: hidden; }
      .cfill { display: block; height: 100%; }
      .notice { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; color: var(--muted); }
      .notice.error { color: var(--error-color, #d64545); }
    `;
  }
}

customElements.define("ati-straton-program-panel", ATIStratonProgramPanel);
