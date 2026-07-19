// ATI Straton — cockpit panel.
// Live data via the `ati_straton/program/list` websocket command.
// The curve editor edits a LOCAL working copy only; persisting to the lamp
// (Save) is gated and not wired yet (R2 — needs write access + program/save).
// Design adapted from the app-session mockup (aqua cockpit, theme-aware).

const CHANNEL_COLORS = {
  UV: "#7c4dff", V: "#a341e0", RB: "#2f5bff", B: "#1e9bf0",
  LC: "#22c1d6", C: "#22c1d6", W: "#c9d4dc", R: "#ff5a5a",
};
const SECTIONS = ["Links", "Mitte", "rechts"];
// Curve templates: normalized [time 0..1, value %]. Adapted from the app mockup.
const TPL = {
  plateau: [[0, 0], [0.1, 30], [0.2, 60], [0.82, 60], [0.91, 30], [1, 0]],
  bolus: [[0, 0], [0.02, 72], [0.19, 72], [0.2, 60], [0.46, 60], [0.54, 50], [0.63, 39], [0.72, 27], [0.81, 12], [1, 0]],
  glocke: [[0, 0], [0.17, 30], [0.33, 55], [0.5, 70], [0.67, 55], [0.83, 30], [1, 0]],
  sunrise: [[0, 0], [0.08, 10], [0.15, 25], [0.23, 45], [0.31, 60], [0.69, 60], [0.85, 30], [1, 0]],
  natur: [[0, 0], [0.16, 25], [0.32, 50], [0.44, 65], [0.52, 68], [0.6, 60], [0.76, 45], [0.92, 20], [1, 0]],
};
const TPL_META = [
  ["plateau", "Plateau", "Anlauf → langes Plateau → Abstieg. SPS, Mixed."],
  ["bolus", "Bolus", "2-h-Block am Start, langer Auslauf. SPS."],
  ["glocke", "Glocke", "Gleichmäßig rauf/runter, kurzes Max. LPS, Mixed."],
  ["sunrise", "Langer Sonnenaufgang", "Sehr langsamer Start, dann Hauptphase. LPS."],
  ["natur", "Natürlich", "Langsam rauf, breites Mittag, sanft runter."],
];
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
    // editor working copy
    this._edit = null; // { tid, nodes: [...clones] }
    this._sel = -1; // selected node index
    this._dirty = false;
    // template tool state
    this._tool = "vorlagen";
    this._tplStart = 9; // hours
    this._tplDur = 11; // hours
    this._tplPal = null; // palette name
    this._cloudDepth = 15; // %
    this._cloudDensity = 3; // dips per hour
    this._rampDur = 45; // minutes
    this._saving = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) this._load();
  }
  get hass() { return this._hass; }

  set narrow(value) { this._narrow = Boolean(value); this._updateMenuButton(); }
  get narrow() { return this._narrow; }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this._render();
    this._timer = setInterval(() => {
      if (this._hass && !this._loading && !this._dirty) this._load();
    }, 10000);
  }
  disconnectedCallback() { if (this._timer) clearInterval(this._timer); this._timer = null; }

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
      if (!this._entryId && this._programs.length) this._entryId = this._programs[0].entry_id;
      const program = this._program();
      if (program && !this._selectedTimeline() && program.timelines.length) {
        this._timelineId = String(program.timelines[0].id);
      }
      // Do NOT touch the editor working copy here: an auto-refresh must not
      // clear the selected point or discard local edits. The working copy is
      // (re)built in _ensureEdit only when the selected timeline changes.
      this._loaded = true;
    } catch (err) {
      this._error = (err && err.message) || "Programm konnte nicht geladen werden.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _program() {
    return this._programs.find((p) => p.entry_id === this._entryId) || this._programs[0];
  }
  _selectedTimeline() {
    const program = this._program();
    if (!program) return null;
    return program.timelines.find((t) => String(t.id) === this._timelineId) || null;
  }

  // ---- editor working copy ----
  _ensureEdit(timeline) {
    if (this._edit && this._edit.tid === String(timeline.id)) return;
    const nodes = (timeline.nodes || [])
      .slice()
      .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))
      .map((n) => JSON.parse(JSON.stringify(n)));
    this._edit = { tid: String(timeline.id), nodes };
    this._sel = -1;
    this._dirty = false;
  }
  _editNodes() { return this._edit ? this._edit.nodes : []; }
  _selNode() {
    const nodes = this._editNodes();
    return this._sel >= 0 && this._sel < nodes.length ? nodes[this._sel] : null;
  }

  _onChange(event) {
    const select = event.target.closest('select[name="program"]');
    if (select) {
      this._entryId = select.value;
      this._timelineId = "";
      this._edit = null; this._sel = -1; this._dirty = false;
      const program = this._program();
      if (program && program.timelines.length) this._timelineId = String(program.timelines[0].id);
      this._render();
      return;
    }
    const pal = event.target.closest('select[name="palette"]');
    if (pal) {
      const node = this._selNode();
      const colors = (this._program() && this._program().colors) || [];
      const chosen = colors.find((c) => String(c.id) === pal.value);
      if (node && chosen) {
        // Points reference a palette by id; the lamp is written the palette id
        // (node.color._id) plus the palette library — not per-point raw values.
        node.color = {
          id: chosen.id,
          name: chosen.name,
          bgColor: chosen.bgColor,
          values: (chosen.values || []).slice(),
        };
        this._dirty = true;
        this._render();
      }
      return;
    }
    const tplpal = event.target.closest('select[name="tplpal"]');
    if (tplpal) {
      this._tplPal = tplpal.value;
      this._render();
    }
  }

  _onClick(event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === "menu") {
      this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
    } else if (a === "reload") {
      this._loaded = false; this._load();
    } else if (a === "view") {
      this._view = btn.dataset.view; this._render();
    } else if (a === "tab") {
      this._timelineId = btn.dataset.id;
      this._edit = null; this._sel = -1; this._dirty = false;
      this._render();
    } else if (a === "node") {
      this._sel = Number(btn.dataset.i); this._render();
    } else if (a === "adj") {
      this._adjust(btn.dataset.field, Number(btn.dataset.d));
    } else if (a === "addpoint") {
      this._addPoint();
    } else if (a === "delpoint") {
      this._delPoint();
    } else if (a === "discard") {
      this._edit = null; this._sel = -1; this._dirty = false; this._render();
    } else if (a === "tool") {
      this._tool = btn.dataset.tool; this._render();
    } else if (a === "tpl") {
      this._adjustTpl(btn.dataset.field, Number(btn.dataset.d));
    } else if (a === "tplapply") {
      this._applyTpl(btn.dataset.key);
    } else if (a === "toolstep") {
      this._adjustTool(btn.dataset.field, Number(btn.dataset.d));
    } else if (a === "cloudapply") {
      this._applyClouds();
    } else if (a === "rampapply") {
      this._applyRamp();
    } else if (a === "shift") {
      this._shiftCurve(Number(btn.dataset.d));
    } else if (a === "save") {
      this._save();
    }
  }

  // ---- local edit operations (working copy only, no persistence) ----
  _adjust(field, dir) {
    const nodes = this._editNodes();
    const n = this._selNode();
    if (!n) return;
    if (field === "time") {
      if (n.type === "first" || n.type === "last") return; // endpoints fixed
      const prev = nodes[this._sel - 1], next = nodes[this._sel + 1];
      const min = prev ? (Number(prev.time) || 0) + 60 : 0;
      const max = next ? (Number(next.time) || 86400) - 60 : 86400;
      let t = (Number(n.time) || 0) + dir * 300; // 5 min steps
      t = Math.max(min, Math.min(max, t));
      n.time = t;
      n.time_label = this._secToHHMM(t);
    } else {
      let v = (Number(n.value) || 0) + dir * 2.5;
      v = Math.max(0, Math.min(100, Math.round(v * 10) / 10));
      n.value = v;
    }
    this._dirty = true;
    this._render();
  }
  _addPoint() {
    const nodes = this._editNodes();
    if (!nodes.length) return;
    let i = this._sel;
    if (i < 0) i = 0;
    const cur = nodes[i];
    const next = nodes[i + 1] || cur;
    const t = Math.round(((Number(cur.time) || 0) + (Number(next.time) || 86400)) / 2);
    const v = Math.round((((Number(cur.value) || 0) + (Number(next.value) || 0)) / 2) * 10) / 10;
    const node = JSON.parse(JSON.stringify(cur));
    node.type = "node";
    node.time = Math.max(0, Math.min(86400, t));
    node.time_label = this._secToHHMM(node.time);
    node.value = v;
    nodes.splice(i + 1, 0, node);
    this._sel = i + 1;
    this._dirty = true;
    this._render();
  }
  _delPoint() {
    const nodes = this._editNodes();
    const n = this._selNode();
    if (!n || n.type === "first" || n.type === "last" || nodes.length <= 2) return;
    nodes.splice(this._sel, 1);
    this._sel = Math.max(0, this._sel - 1);
    this._dirty = true;
    this._render();
  }

  // ---------- render ----------
  _render() {
    const program = this._program();
    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <button class="menu" data-action="menu" aria-label="Menu"><span class="menu-icon"></span></button>
      <div class="wrap">
        ${this._header(program)}
        ${this._error ? `<div class="notice error">${this._esc(this._error)}</div>` : ""}
        ${!this._loaded && this._loading ? `<div class="notice">Programm wird geladen…</div>` : ""}
        ${this._loaded && !this._programs.length ? `<div class="notice">Keine ATI Straton Integration geladen.</div>` : ""}
        ${program ? this._nav() : ""}
        ${program && this._view === "overview" ? this._overview(program) : ""}
        ${program && this._view === "program" ? this._programView(program) : ""}
      </div>
      ${this._dirty ? this._saveBar() : ""}
    `;
    this._updateMenuButton();
  }

  _header(program) {
    const device = (program && program.device) || {};
    const refresh = program && program.last_successful_refresh
      ? new Date(program.last_successful_refresh).toLocaleTimeString() : "–";
    const cur = (program && program.current) || {};
    const status = cur.warning || cur.danger ? "warn" : "ok";
    return `
      <header>
        <div class="id">
          <span class="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
          <div class="names"><strong>${this._esc((program && program.title) || "ATI Straton")}</strong>
            <span>${this._esc(device.type || "Straton Flex")} · ${this._esc(device.software || "–")} · Stand ${this._esc(refresh)}</span></div>
        </div>
        <div class="head-right">
          <span class="chip ${status}">${status === "ok" ? "OK" : "Warnung"}</span>
          <button class="btn" data-action="reload" ${this._loading ? "disabled" : ""}>Aktualisieren</button>
        </div>
      </header>`;
  }

  _nav() {
    const tab = (v, l) => `<button class="navbtn ${this._view === v ? "active" : ""}" data-action="view" data-view="${v}">${l}</button>`;
    const sel = this._programs.length > 1
      ? `<select name="program" aria-label="Leuchte">${this._programs.map((p) => `<option value="${this._esc(p.entry_id)}" ${p.entry_id === this._entryId ? "selected" : ""}>${this._esc(p.title)}</option>`).join("")}</select>` : "";
    return `<div class="nav">${tab("overview", "Übersicht")}${tab("program", "Programm")}${sel}</div>`;
  }

  // ----- overview -----
  _overview(program) {
    const cur = program.current || {};
    const pills = [
      `<span class="pill">Leistung <b>${cur.estimated_power ?? "–"}</b> W</span>`,
      ...(program.par || []).map((p) => `<span class="pill">PAR ${this._esc(p.label)} <b>${p.value ?? "–"}</b></span>`),
    ].join("");
    const groups = program.timelines.map((t) => {
      const on = t.active !== false;
      const pct = Math.max(0, Math.min(100, Number(t.current_intensity) || 0));
      return `
        <div class="row">
          <span class="swatch" style="background:${this._esc(t.linecolor || "var(--acc)")}"></span>
          <div class="row-main">
            <div class="row-top"><span class="row-name">${this._esc(t.name || t.id)}</span>
              <span class="row-val ${on ? "" : "off"}">${on ? this._fmt(t.current_intensity) + " %" : "Aus"}</span></div>
            <div class="bar"><span class="fill" style="width:${on ? pct : 0}%"></span></div>
            <div class="row-sub">${(t.spots || []).length} Spots · nächster Wechsel ${this._esc(this._hhmm(t.next_change))}</div>
          </div>
        </div>`;
    }).join("");
    return `
      <section class="card pad"><div class="live">${pills}</div></section>
      <section class="card">
        <p class="label">Gruppen</p>
        <div class="list">${groups || `<div class="row"><div class="row-main">Keine Gruppen</div></div>`}</div>
      </section>
      ${this._sektionen(program)}`;
  }

  _sektionen(program) {
    const lamps = program.lamps || [];
    if (!lamps.length) return "";
    const spotTemp = (serial, idx) => {
      const s = (program.spots || []).find(
        (sp) => String(sp.external_id) === `${serial}:${idx}`
      );
      return s && s.temperature != null ? `${this._fmt(s.temperature)}°` : "–";
    };
    const spotOnline = (serial) =>
      (program.spots || []).some((sp) => String(sp.external_id).split(":")[0] === serial && sp.online);
    const blocks = lamps.map((l) => {
      const meta = [
        "#" + this._esc(l.serial),
        l.sw ? "SW " + this._esc(l.sw) : "",
        l.ip ? this._esc(l.ip) : "",
      ].filter(Boolean).join(" · ");
      const tiles = SECTIONS.map((name, i) => `
        <div class="tile"><span class="tile-l">${name}</span><span class="tile-v">${spotTemp(l.serial, i)}</span></div>`).join("");
      return `
        <div class="lamp">
          <div class="lamp-head">
            <span class="ldot ${spotOnline(l.serial) ? "on" : "off"}"></span>
            <strong>${this._esc(l.role)}</strong> <span class="muted">${this._esc(l.type || "Straton Flex")}</span>
          </div>
          <div class="lamp-meta">${meta}</div>
          <div class="tiles">${tiles}</div>
        </div>`;
    }).join("");
    return `
      <section class="card pad">
        <p class="label" style="margin:0 0 12px">Sektionen · ${lamps.length} Lampen</p>
        <div class="lamps">${blocks}</div>
      </section>`;
  }

  // ----- program (curve editor) -----
  _programView(program) {
    const timeline = this._selectedTimeline() || program.timelines[0];
    if (!timeline) return `<div class="notice">Kein Programm.</div>`;
    this._ensureEdit(timeline);
    const tabs = program.timelines.map((t) =>
      `<button class="tab ${String(t.id) === String(timeline.id) ? "active" : ""}" data-action="tab" data-id="${this._esc(String(t.id))}">${this._esc(t.name || t.id)}</button>`).join("");
    const nodes = this._editNodes();
    const sel = this._selNode();
    const active = sel ? sel.color : this._activeColor(nodes);
    return `
      <div class="tabs">${tabs}</div>
      <section class="card pad readonly-note">
        <div class="row-top"><span class="row-name">Intensität (geplant, jetzt)</span>
          <span class="row-val">${this._fmt(timeline.current_intensity)} %</span></div>
        <div class="bar"><span class="fill" style="width:${Math.max(0, Math.min(100, Number(timeline.current_intensity) || 0))}%"></span></div>
        <p class="hint">Gesamt-Skalierung &amp; Speichern kommen mit dem Schreibzugriff (R2).</p>
      </section>
      <section class="card">
        <div class="curve-head"><span class="label" style="margin:0">Kurve · ${this._esc(timeline.name || "Gruppe")}</span>
          <span class="chip ${timeline.active !== false ? "ok" : "off"}">${timeline.active !== false ? "Aktiv" : "Inaktiv"}</span></div>
        <div class="curve">${this._curve(timeline, nodes)}</div>
        ${this._pointEditor(sel)}
      </section>
      ${this._tools(program)}
      <section class="card pad">
        <p class="label" style="margin-top:0">Aktuelles Spektrum</p>
        ${active ? this._spectrum(active) : `<div class="muted">Kein Spektrum.</div>`}
      </section>`;
  }

  _pointEditor(sel) {
    if (!sel) {
      return `<div class="pt-empty"><span class="muted">Punkt in der Kurve antippen zum Bearbeiten.</span>
        <button class="btn" data-action="addpoint">+ Punkt</button></div>`;
    }
    const isEnd = sel.type === "first" || sel.type === "last";
    const stepper = (field, label, value, unit) => `
      <div class="stepper-row"><span class="sl">${label}</span>
        <button class="sbtn" data-action="adj" data-field="${field}" data-d="-1" ${field === "time" && isEnd ? "disabled" : ""}>−</button>
        <span class="sval">${value}${unit ? " " + unit : ""}</span>
        <button class="sbtn" data-action="adj" data-field="${field}" data-d="1" ${field === "time" && isEnd ? "disabled" : ""}>+</button></div>`;
    const palColor = (sel.color && sel.color.bgColor) || "var(--acc)";
    const curId = sel.color && sel.color.id;
    const colors = (this._program() && this._program().colors) || [];
    const options = colors.length
      ? colors.map((c) => `<option value="${this._esc(String(c.id))}" ${String(c.id) === String(curId) ? "selected" : ""}>${this._esc(c.name)}${c.disabled === false ? " · eigen" : ""}</option>`).join("")
      : `<option selected>${this._esc((sel.color && sel.color.name) || "–")}</option>`;
    return `
      <div class="pt-edit">
        <div class="pt-steppers">
          ${stepper("time", "Zeit", this._esc(sel.time_label || this._secToHHMM(sel.time)), "")}
          ${stepper("value", "%", this._fmt(sel.value), "")}
        </div>
        <div class="pt-actions">
          <button class="btn" data-action="addpoint">+ Punkt</button>
          <button class="btn danger" data-action="delpoint" ${isEnd ? "disabled" : ""} title="Punkt löschen">🗑</button>
        </div>
        <div class="pt-pal">
          <span class="pt-pal-l">Palette</span>
          <span class="dot" style="background:${this._esc(palColor)}"></span>
          <select name="palette" aria-label="Palette" ${colors.length ? "" : "disabled"}>${options}</select>
        </div>
      </div>`;
  }

  _curve(timeline, nodes) {
    const W = 920, H = 300, pl = 44, pt = 18, pr = 16, pb = 30;
    const iw = W - pl - pr, ih = H - pt - pb;
    const line = timeline.linecolor || "var(--acc)";
    const X = (s) => pl + (Math.max(0, Math.min(86400, Number(s) || 0)) / 86400) * iw;
    const Y = (v) => pt + (1 - Math.max(0, Math.min(100, Number(v) || 0)) / 100) * ih;
    const pts = nodes.map((n) => ({ x: X(n.time), y: Y(n.value), n }));
    const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = pts.length ? `${path} L ${pts[pts.length - 1].x.toFixed(1)} ${pt + ih} L ${pts[0].x.toFixed(1)} ${pt + ih} Z` : "";
    const nowX = X(this._nowSeconds());
    const grid = [0, 25, 50, 75, 100].map((t) => { const y = Y(t); return `<line class="grid" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/><text class="axis" x="8" y="${y + 4}">${t}</text>`; }).join("");
    const xax = [0, 6, 12, 18, 24].map((h) => { const x = pl + (h / 24) * iw; return `<text class="axis" text-anchor="middle" x="${x}" y="${H - 10}">${String(h).padStart(2, "0")}</text>`; }).join("");
    const dots = pts.map((p, i) => {
      const c = (p.n.color && p.n.color.bgColor) || line;
      const isSel = i === this._sel;
      return `<circle class="node ${isSel ? "sel" : ""}" data-action="node" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isSel ? 9 : 5.5}" fill="${this._esc(c)}"/>`;
    }).join("");
    return `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tageskurve">
        ${grid}${xax}
        ${area ? `<path class="area" style="fill:${this._esc(line)}" d="${area}"/>` : ""}
        ${path ? `<path class="cline" style="stroke:${this._esc(line)}" d="${path}"/>` : ""}
        <line class="now" x1="${nowX}" y1="${pt}" x2="${nowX}" y2="${pt + ih}"/>
        ${dots}
      </svg>`;
  }

  _spectrum(color) {
    const values = (color.values || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    if (!values.length) return `<div class="muted">Keine Kanalwerte.</div>`;
    const bars = values.map((v) => {
      const pct = Math.max(0, Math.min(100, (Number(v.value) || 0) / 2.55));
      const col = CHANNEL_COLORS[v.name] || "var(--acc)";
      return `<div class="chan"><span class="cn">${this._esc(channelLabel(v.name))}</span>
        <span class="track"><span class="cfill" style="width:${pct}%;background:${col}"></span></span>
        <span class="cv">${v.value ?? "–"}</span></div>`;
    }).join("");
    return `
      <div class="row compact"><span class="dot" style="background:${this._esc(color.bgColor || "var(--acc)")}"></span>
        <div class="row-main"><div class="row-name">${this._esc(color.name || "Spektrum")}</div>
          <div class="row-sub">Kanalwerte 0–255</div></div></div>
      <div class="spectrum">${bars}</div>`;
  }

  // ----- tools (templates) -----
  _tools(program) {
    const colors = program.colors || [];
    if (this._tplPal === null) {
      const own = colors.find((c) => c.disabled === false);
      this._tplPal = ((own || colors[0] || {}).name) || null;
    }
    const ttab = (id, label) => `<button class="ttab ${this._tool === id ? "on" : ""}" data-action="tool" data-tool="${id}">${label}</button>`;
    const tabs = `<div class="tooltabs">${ttab("vorlagen", "Vorlagen")}${ttab("wolken", "Wolken")}${ttab("raender", "Ränder")}${ttab("zeit", "Zeit")}</div>`;
    const body =
      this._tool === "vorlagen" ? this._toolVorlagen(colors)
      : this._tool === "wolken" ? this._toolWolken()
      : this._tool === "raender" ? this._toolRaender()
      : this._tool === "zeit" ? this._toolZeit()
      : "";
    return `<section class="card pad"><p class="label" style="margin:0 0 10px">Werkzeuge</p>${tabs}<div class="toolbody">${body}</div></section>`;
  }

  _toolWolken() {
    const step = (field, label, value) => `
      <div class="stepper-row"><span class="sl">${label}</span>
        <button class="sbtn" data-action="toolstep" data-field="${field}" data-d="-1">−</button>
        <span class="sval">${value}</span>
        <button class="sbtn" data-action="toolstep" data-field="${field}" data-d="1">+</button></div>`;
    return `
      <p class="muted" style="margin:0 0 12px">Zickzack-Wolken ins Fenster <b>10–16 Uhr</b> backen. Die Baseline wird abwechselnd um „Tiefe" abgesenkt.</p>
      <div class="tpl-inputs">${step("depth", "Tiefe", "−" + this._cloudDepth + " %")}${step("density", "Dichte", this._cloudDensity + " / h")}</div>
      <button class="btn full" data-action="cloudapply">Wolken einfügen (10–16 Uhr)</button>`;
  }
  _toolRaender() {
    const step = `
      <div class="stepper-row"><span class="sl">Dauer</span>
        <button class="sbtn" data-action="toolstep" data-field="rampdur" data-d="-1">−</button>
        <span class="sval">${this._rampDur} Min</span>
        <button class="sbtn" data-action="toolstep" data-field="rampdur" data-d="1">+</button></div>`;
    return `
      <p class="muted" style="margin:0 0 12px">Sonnenauf-/-untergänge weichzeichnen: an jeder 0↔Wert-Kante werden sanfte Zwischenpunkte (Smoothstep) eingefügt.</p>
      <div class="tpl-inputs">${step}</div>
      <button class="btn full" data-action="rampapply">Enden weichzeichnen</button>`;
  }
  _toolZeit() {
    return `
      <p class="muted" style="margin:0 0 12px">Ganze Kurve zeitlich verschieben — die Endpunkte (0 / 24 Uhr) bleiben.</p>
      <div class="btn-row">
        <button class="btn" data-action="shift" data-d="-1">‹ 1 h</button>
        <button class="btn" data-action="shift" data-d="-0.25">‹ 15 min</button>
        <button class="btn" data-action="shift" data-d="0.25">15 min ›</button>
        <button class="btn" data-action="shift" data-d="1">1 h ›</button>
      </div>`;
  }
  _adjustTool(field, d) {
    if (field === "depth") this._cloudDepth = Math.max(5, Math.min(40, this._cloudDepth + d * 5));
    else if (field === "density") this._cloudDensity = Math.max(1, Math.min(4, this._cloudDensity + d));
    else if (field === "rampdur") this._rampDur = Math.max(10, Math.min(90, this._rampDur + d * 5));
    this._render();
  }
  _applyClouds() {
    if (!this._edit) return;
    const nodes = this._editNodes();
    if (nodes.length < 2) return;
    const w0 = 10 * 3600, w1 = 16 * 3600;
    const depth = this._cloudDepth, perH = this._cloudDensity, stepSec = 3600 / perH;
    const inside = [];
    let k = 0;
    for (let t = w0; t <= w1 + 1; t += stepSec) {
      const base = this._interpValue(nodes, t);
      const dip = k % 2 === 1 ? depth : 0;
      inside.push({
        type: "node", index: 0, time: Math.round(t), time_label: this._secToHHMM(t),
        value: Math.max(0, Math.round((base - dip) * 4) / 4),
        color: this._cloneColor(this._colorAt(nodes, t)),
      });
      k++;
    }
    const out = nodes.filter((n) => n.time < w0 - 1 || n.time > w1 + 1).concat(inside);
    this._finalize(out);
    this._edit.nodes = out;
    this._sel = -1; this._dirty = true; this._render();
  }
  _applyRamp() {
    if (!this._edit) return;
    const nodes = this._editNodes();
    const durSec = this._rampDur * 60, N = 3, out = [];
    for (let i = 0; i < nodes.length; i++) {
      out.push(nodes[i]);
      const a = nodes[i], b = nodes[i + 1];
      if (!b) continue;
      const rising = a.value === 0 && b.value > 0;
      const falling = a.value > 0 && b.value === 0;
      if (!rising && !falling) continue;
      const span = Math.min(durSec, b.time - a.time);
      for (let s = 1; s <= N; s++) {
        const f = s / (N + 1), ss = f * f * (3 - 2 * f);
        const tt = rising ? b.time - span + f * span : a.time + f * span;
        const ease = rising ? ss : 1 - ss;
        const vv = rising ? ease * b.value : ease * a.value;
        out.push({
          type: "node", index: 0, time: Math.round(tt), time_label: this._secToHHMM(Math.round(tt)),
          value: Math.round(vv * 4) / 4, color: this._cloneColor(rising ? b.color : a.color),
        });
      }
    }
    this._finalize(out);
    this._edit.nodes = out;
    this._sel = -1; this._dirty = true; this._render();
  }
  _shiftCurve(dh) {
    if (!this._edit) return;
    const nodes = this._editNodes();
    if (nodes.length < 3) return;
    let d = dh * 3600;
    const i0 = 1, i1 = nodes.length - 2;
    if (nodes[i0].time + d < 360) d = 360 - nodes[i0].time;
    if (nodes[i1].time + d > 86040) d = 86040 - nodes[i1].time;
    if (Math.abs(d) < 1) return;
    for (let i = i0; i <= i1; i++) {
      nodes[i].time = Math.round(nodes[i].time + d);
      nodes[i].time_label = this._secToHHMM(nodes[i].time);
    }
    this._finalize(nodes);
    this._dirty = true; this._render();
  }
  _interpValue(nodes, t) {
    if (!nodes.length) return 0;
    if (t <= nodes[0].time) return Number(nodes[0].value) || 0;
    for (let i = 1; i < nodes.length; i++) {
      if (t <= nodes[i].time) {
        const a = nodes[i - 1], b = nodes[i], span = (b.time - a.time) || 1;
        return (Number(a.value) || 0) + ((Number(b.value) || 0) - (Number(a.value) || 0)) * ((t - a.time) / span);
      }
    }
    return Number(nodes[nodes.length - 1].value) || 0;
  }
  _colorAt(nodes, t) {
    let c = nodes[0] && nodes[0].color;
    for (const n of nodes) if ((n.time || 0) <= t) c = n.color;
    return c;
  }
  _cloneColor(c) {
    return c
      ? { id: c.id, name: c.name, bgColor: c.bgColor, values: (c.values || []).slice() }
      : { id: null, name: "–", bgColor: "var(--acc)", values: [] };
  }
  _finalize(nodes) {
    nodes.sort((a, b) => a.time - b.time);
    nodes.forEach((n, i) => {
      n.type = i === 0 ? "first" : i === nodes.length - 1 ? "last" : "node";
      n.index = i;
    });
    return nodes;
  }

  _toolVorlagen(colors) {
    const dur = Math.min(this._tplDur, 24 - this._tplStart);
    const step = (field, label, value) => `
      <div class="stepper-row"><span class="sl">${label}</span>
        <button class="sbtn" data-action="tpl" data-field="${field}" data-d="-1">−</button>
        <span class="sval">${value}</span>
        <button class="sbtn" data-action="tpl" data-field="${field}" data-d="1">+</button></div>`;
    const options = colors.length
      ? colors.map((c) => `<option value="${this._esc(c.name)}" ${c.name === this._tplPal ? "selected" : ""}>${this._esc(c.name)}${c.disabled === false ? " · eigen" : ""}</option>`).join("")
      : `<option>—</option>`;
    const list = TPL_META.map((m) => `
      <button class="tpl-row" data-action="tplapply" data-key="${m[0]}">
        <span class="tpl-mini">${this._miniCurve(TPL[m[0]])}</span>
        <span class="tpl-txt"><b>${this._esc(m[1])}</b><span>${this._esc(m[2])}</span></span></button>`).join("");
    return `
      <p class="muted" style="margin:0 0 12px">Startzeit &amp; Dauer wählen, dann Form antippen — sie wird ins Fenster <b>Start … Start+Dauer</b> gelegt. „Verwerfen" macht rückgängig.</p>
      <div class="tpl-inputs">${step("start", "Start", this._esc(this._hoursToHHMM(this._tplStart)))}${step("dur", "Dauer", this._esc(this._fmtDur(dur)))}</div>
      <div class="tpl-pal"><span class="pt-pal-l">Palette</span><select name="tplpal" ${colors.length ? "" : "disabled"}>${options}</select></div>
      <div class="tpl-list">${list}</div>`;
  }

  _applyTpl(key) {
    const program = this._program();
    const shape = TPL[key];
    if (!this._edit || !program || !shape) return;
    const start = this._tplStart;
    const dur = Math.min(this._tplDur, 24 - start);
    const colors = program.colors || [];
    const pal = colors.find((c) => c.name === this._tplPal) ||
      colors[0] || { id: null, name: this._tplPal, bgColor: "#888888", values: [] };
    const mk = (h, v) => {
      const t = Math.max(0, Math.min(86400, Math.round(h * 3600)));
      return {
        type: "node", index: 0, time: t, time_label: this._secToHHMM(t),
        value: Math.max(0, Math.min(100, v)),
        color: { id: pal.id, name: pal.name, bgColor: pal.bgColor, values: (pal.values || []).slice() },
      };
    };
    const nodes = [];
    if (start > 0.02) nodes.push(mk(0, 0));
    shape.forEach((a) => nodes.push(mk(start + a[0] * dur, a[1])));
    if (start + dur < 23.98) nodes.push(mk(24, 0));
    this._finalize(nodes);
    this._edit.nodes = nodes;
    this._sel = Math.min(1, nodes.length - 1);
    this._dirty = true;
    this._render();
  }
  _adjustTpl(field, d) {
    if (field === "start") this._tplStart = Math.max(0, Math.min(22, Math.round((this._tplStart + d * 0.25) * 100) / 100));
    else this._tplDur = Math.max(3, Math.min(16, this._tplDur + d * 0.5));
    this._render();
  }
  _miniCurve(shape) {
    const w = 72, h = 34, pl = 2, pr = 2, pt = 3, pb = 3, iw = w - pl - pr, ih = h - pt - pb;
    let d = "";
    shape.forEach((a, i) => { const x = pl + a[0] * iw, y = pt + (1 - a[1] / 100) * ih; d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " "; });
    const area = `${d}L ${pl + iw} ${pt + ih} L ${pl} ${pt + ih} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${area}" fill="var(--acc)" opacity=".15"/><path d="${d}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  _hoursToHHMM(h) { return this._secToHHMM(Math.round(h * 3600)); }
  _fmtDur(h) { return (h % 1 === 0 ? String(h) : h.toFixed(1)) + " h"; }

  _saveBar() {
    const canWrite = !!(this._program() && this._program().write_enabled);
    const saving = this._saving;
    const saveBtn = canWrite
      ? `<button class="btn primary" data-action="save" ${saving ? "disabled" : ""}>${saving ? "Speichert…" : "Speichern"}</button>`
      : `<button class="btn primary" disabled title="Schreibzugriff in den Integrations-Optionen aktivieren">Speichern</button>`;
    const sub = canWrite
      ? "Wird dauerhaft in die Leuchte geschrieben"
      : "Nur lokal — Schreibzugriff in den Optionen aktivieren";
    return `
      <div class="savebar"><div class="sb-inner">
        <div class="sb-t">Ungespeicherte Änderungen<span>${sub}</span></div>
        <button class="btn" data-action="discard" ${saving ? "disabled" : ""}>Verwerfen</button>
        ${saveBtn}
      </div></div>`;
  }

  _save() {
    const program = this._program();
    if (!program || !program.write_enabled || !this._edit || !this._dirty || this._saving) return;
    const tid = Number(this._edit.tid);
    const nodes = this._editNodes().map((n) => ({
      time: Math.round(Number(n.time) || 0),
      value: Number(n.value) || 0,
      color_id: n.color && n.color.id,
    }));
    this._saving = true;
    this._render();
    this._hass.connection
      .sendMessagePromise({
        type: "ati_straton/program/save",
        entry_id: this._entryId,
        timeline_id: tid,
        nodes,
      })
      .then(() => {
        this._saving = false;
        this._dirty = false;
        this._edit = null;
        this._sel = -1;
        this._error = "";
        this._load();
      })
      .catch((err) => {
        this._saving = false;
        this._error = (err && err.message) || "Speichern fehlgeschlagen.";
        this._render();
      });
  }

  // ---------- helpers ----------
  _activeColor(nodes) {
    const now = this._nowSeconds();
    let active = nodes[0];
    for (const n of nodes) if ((Number(n.time) || 0) <= now) active = n;
    return active && active.color;
  }
  _nowSeconds() { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); }
  _secToHHMM(sec) {
    let s = Math.max(0, Math.min(86400, Math.round(Number(sec) || 0)));
    if (s === 86400) return "24:00";
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  }
  _fmt(v) { const n = Number(v); if (!Number.isFinite(n)) return "–"; return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  _hhmm(iso) { if (!iso) return "–"; const p = String(iso).split(":"); return p.length >= 2 ? `${p[0]}:${p[1]}` : String(iso); }
  _updateMenuButton() { const b = this.shadowRoot.querySelector(".menu"); if (b) b.style.display = this._narrow ? "grid" : "none"; }
  _esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  _css() {
    return `
      :host {
        --bg: var(--primary-background-color, #eef3f7);
        --card: var(--ha-card-background, var(--card-background-color, #ffffff));
        --border: var(--divider-color, rgba(127,127,127,.22));
        --text: var(--primary-text-color, #0c1c28);
        --muted: var(--secondary-text-color, #5a7183);
        --acc: var(--primary-color, #0e9fb5);
        --card2: color-mix(in srgb, var(--text) 6%, var(--card));
        --acc-soft: color-mix(in srgb, var(--acc) 14%, transparent);
        --good: var(--success-color, #2e9e4f);
        --warn: var(--warning-color, #c9761a);
        --crit: var(--error-color, #d64545);
        display: block; min-height: 100vh; background: var(--bg); color: var(--text);
        font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
      }
      * { box-sizing: border-box; }
      .wrap { width: min(1080px, calc(100vw - 24px)); margin: 0 auto; padding: 20px 0 120px; display: flex; flex-direction: column; gap: 14px; }
      .menu { position: fixed; top: 8px; left: 8px; z-index: 3; width: 44px; height: 44px; display: none; place-items: center; border: 0; background: transparent; color: var(--text); cursor: pointer; }
      .menu-icon, .menu-icon::before, .menu-icon::after { display: block; width: 20px; height: 2px; border-radius: 9px; background: currentColor; position: relative; }
      .menu-icon::before, .menu-icon::after { content: ""; position: absolute; left: 0; } .menu-icon::before { top: -6px; } .menu-icon::after { top: 6px; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
      .id { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .glyph { width: 40px; height: 40px; border-radius: 11px; flex: 0 0 auto; display: grid; place-items: center; background: linear-gradient(150deg, var(--acc), #2f5bff); color: #fff; }
      .glyph svg { width: 22px; height: 22px; }
      .names strong { display: block; font-size: 17px; } .names span { display: block; font-size: 12.5px; color: var(--muted); }
      .head-right { display: flex; align-items: center; gap: 10px; }
      .btn { min-height: 36px; border: 1px solid var(--border); border-radius: 9px; background: var(--card); color: var(--text); font: inherit; font-size: 13.5px; padding: 0 13px; cursor: pointer; }
      .btn[disabled] { opacity: .45; cursor: default; }
      .btn.primary { background: var(--acc); border-color: var(--acc); color: #04222a; font-weight: 650; }
      .btn.danger { color: var(--crit); border-color: color-mix(in srgb, var(--crit) 45%, transparent); }
      .nav { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .navbtn { border: 1px solid var(--border); background: var(--card); color: var(--muted); font: inherit; font-weight: 650; font-size: 14px; padding: 9px 18px; border-radius: 999px; cursor: pointer; }
      .navbtn.active { background: var(--acc-soft); border-color: color-mix(in srgb, var(--acc) 50%, transparent); color: var(--acc); }
      select { margin-left: auto; min-height: 36px; border: 1px solid var(--border); border-radius: 9px; background: var(--card); color: var(--text); font: inherit; padding: 0 10px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
      .card.pad { padding: 16px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--muted); margin: 14px 16px 8px; }
      .live { display: flex; gap: 8px; flex-wrap: wrap; }
      .pill { font-size: 13px; background: var(--card2); border: 1px solid var(--border); padding: 7px 11px; border-radius: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .pill b { color: var(--text); }
      .list { display: flex; flex-direction: column; }
      .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
      .row + .row { border-top: 1px solid var(--border); }
      .row.compact { padding: 10px 16px; }
      .row-main { flex: 1 1 auto; min-width: 0; }
      .row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .row-name { font-size: 14px; font-weight: 650; }
      .row-val { font-family: ui-monospace, monospace; font-weight: 650; } .row-val.off { color: var(--muted); }
      .row-sub { margin-top: 3px; font-size: 12px; color: var(--muted); }
      .bar { margin-top: 8px; height: 8px; border-radius: 99px; background: var(--card2); border: 1px solid var(--border); overflow: hidden; }
      .fill { height: 100%; background: var(--acc); }
      .swatch { width: 34px; height: 34px; border-radius: 9px; flex: 0 0 auto; border: 1px solid var(--border); }
      .dot { width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto; border: 1px solid var(--border); }
      .chip { flex: 0 0 auto; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: var(--card2); color: var(--muted); }
      .chip.ok { background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good); }
      .chip.off, .chip.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
      .muted { color: var(--muted); font-size: 12.5px; }
      /* sektionen tiles */
      .lamps { display: flex; flex-direction: column; gap: 18px; }
      .lamp-head { display: flex; align-items: center; gap: 9px; font-size: 15px; }
      .ldot { width: 11px; height: 11px; border-radius: 50%; background: var(--muted); }
      .ldot.on { background: var(--good); } .ldot.off { background: var(--warn); }
      .lamp-meta { margin: 4px 0 10px 20px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .tile { background: var(--card2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
      .tile-l { display: block; font-size: 13px; color: var(--muted); }
      .tile-v { display: block; margin-top: 6px; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
      /* editor */
      .tabs { display: flex; gap: 6px; overflow-x: auto; }
      .tab { white-space: nowrap; border: 1px solid var(--border); background: var(--card); color: var(--muted); font: inherit; font-weight: 650; font-size: 13px; padding: 8px 15px; border-radius: 999px; cursor: pointer; }
      .tab.active { background: var(--acc-soft); border-color: color-mix(in srgb, var(--acc) 50%, transparent); color: var(--acc); }
      .readonly-note .hint { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
      .curve-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 4px; }
      .curve { padding: 6px 8px 12px; }
      svg { display: block; width: 100%; height: auto; }
      .grid { stroke: var(--border); stroke-width: 1; }
      .axis { fill: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
      .cline { fill: none; stroke-width: 2.6; stroke-linejoin: round; stroke-linecap: round; }
      .area { opacity: .12; }
      .node { stroke: var(--card); stroke-width: 2.5; cursor: pointer; }
      .node.sel { stroke: var(--text); stroke-width: 3; }
      .now { stroke: var(--acc); stroke-width: 1.4; stroke-dasharray: 5 5; }
      .pt-empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 16px; }
      .pt-edit { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 16px 16px; border-top: 1px solid var(--border); }
      .pt-steppers { display: flex; gap: 18px; flex: 1 1 auto; }
      .stepper-row { display: flex; align-items: center; gap: 8px; }
      .sl { font-size: 12px; color: var(--muted); min-width: 30px; }
      .sbtn { width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--border); background: var(--card2); color: var(--text); font-size: 18px; cursor: pointer; line-height: 1; }
      .sbtn[disabled] { opacity: .4; cursor: default; }
      .sval { min-width: 66px; text-align: center; font-family: ui-monospace, monospace; font-size: 15px; font-weight: 650; background: var(--card2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 6px; }
      .pt-actions { display: flex; gap: 8px; }
      .pt-pal { flex-basis: 100%; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
      .pt-pal-l { min-width: 46px; }
      .pt-pal select, .tpl-pal select { margin-left: 0; flex: 1 1 auto; min-width: 160px; }
      .tooltabs { display: flex; gap: 6px; background: var(--card2); border: 1px solid var(--border); border-radius: 11px; padding: 4px; margin-bottom: 12px; }
      .ttab { flex: 1; border: 0; background: transparent; color: var(--muted); font: inherit; font-weight: 650; font-size: 13px; padding: 8px 4px; border-radius: 8px; cursor: pointer; }
      .ttab.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
      .tpl-inputs { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 12px; }
      .tpl-pal { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .tpl-list { display: flex; flex-direction: column; gap: 8px; }
      .tpl-row { display: flex; align-items: center; gap: 12px; text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: 11px; padding: 8px 10px; cursor: pointer; color: var(--text); font: inherit; }
      .tpl-row:hover { border-color: color-mix(in srgb, var(--acc) 45%, var(--border)); }
      .tpl-mini { flex: 0 0 auto; width: 72px; height: 34px; display: block; }
      .tpl-txt { display: flex; flex-direction: column; gap: 2px; } .tpl-txt b { font-size: 13.5px; } .tpl-txt span { font-size: 11.5px; color: var(--muted); }
      .btn.full { width: 100%; }
      .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .btn-row .btn { flex: 1; min-width: 88px; }
      .spectrum { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
      .chan { display: grid; grid-template-columns: 34px 1fr 40px; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; }
      .cn { font-family: ui-monospace, monospace; font-weight: 700; } .cv { text-align: right; font-family: ui-monospace, monospace; }
      .track { height: 8px; border-radius: 99px; background: var(--card2); border: 1px solid var(--border); overflow: hidden; }
      .cfill { display: block; height: 100%; }
      .notice { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; color: var(--muted); }
      .notice.error { color: var(--crit); }
      .savebar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; width: min(1080px, calc(100vw - 24px)); z-index: 5; }
      .sb-inner { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 10px 12px 10px 16px; }
      .sb-t { flex: 1; font-size: 13px; font-weight: 650; } .sb-t span { display: block; font-size: 11.5px; color: var(--muted); font-weight: 500; }
    `;
  }
}

customElements.define("ati-straton-program-panel", ATIStratonProgramPanel);
