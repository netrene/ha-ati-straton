class ATIStratonProgramPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._loaded = false;
    this._loading = false;
    this._error = "";
    this._programs = [];
    this._entryId = "";
    this._timelineId = "";
    this._narrow = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) {
      this._load();
      return;
    }
    this._render();
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
    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
    this.shadowRoot.addEventListener("change", (event) => this._handleChange(event));
    this._render();
  }

  async _load() {
    if (!this._hass) {
      return;
    }
    this._loading = true;
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "ati_straton/program/list",
      });
      this._programs = result.programs || [];
      if (!this._entryId && this._programs.length > 0) {
        this._entryId = this._programs[0].entry_id;
      }
      const program = this._selectedProgram();
      if (!this._timelineId && program?.timelines?.length > 0) {
        this._timelineId = String(program.timelines[0].id);
      }
      this._loaded = true;
    } catch (error) {
      this._error = error.message || "Straton Programm konnte nicht geladen werden.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _reload() {
    this._loaded = false;
    await this._load();
  }

  _handleClick(event) {
    const button = event.target.closest("button");
    if (!button?.dataset.action) {
      return;
    }
    if (button.dataset.action === "menu") {
      this.dispatchEvent(
        new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
      );
      return;
    }
    if (button.dataset.action === "reload") {
      this._reload();
    }
  }

  _handleChange(event) {
    const select = event.target.closest("select");
    if (!select) {
      return;
    }
    if (select.name === "program") {
      this._entryId = select.value;
      const program = this._selectedProgram();
      this._timelineId = program?.timelines?.length ? String(program.timelines[0].id) : "";
      this._render();
      return;
    }
    if (select.name === "timeline") {
      this._timelineId = select.value;
      this._render();
    }
  }

  _selectedProgram() {
    return this._programs.find((program) => program.entry_id === this._entryId);
  }

  _selectedTimeline() {
    const program = this._selectedProgram();
    return program?.timelines?.find((timeline) => String(timeline.id) === this._timelineId);
  }

  _render() {
    const program = this._selectedProgram();
    const timeline = this._selectedTimeline();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --straton-card: var(--ha-card-background, var(--card-background-color, #1b1f24));
          --straton-panel: rgba(255, 255, 255, 0.055);
          --straton-border: rgba(255, 255, 255, 0.1);
          --straton-muted: var(--secondary-text-color, #9aa6b2);
          --straton-text: var(--primary-text-color, #f5f7fa);
          --straton-primary: var(--primary-color, #03a9f4);
          display: block;
          min-height: 100vh;
          background: var(--primary-background-color, #101418);
          color: var(--straton-text);
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .page {
          width: min(1180px, calc(100vw - 28px));
          margin: 0 auto;
          padding: 30px 0 42px;
        }

        .menu-button {
          position: fixed;
          top: 8px;
          left: 8px;
          z-index: 2;
          width: 44px;
          height: 44px;
          display: none;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: var(--primary-text-color, #eaeaea);
          padding: 0;
        }

        .menu-icon,
        .menu-icon::before,
        .menu-icon::after {
          display: block;
          width: 20px;
          height: 2px;
          border-radius: 99px;
          background: currentColor;
        }

        .menu-icon {
          position: relative;
        }

        .menu-icon::before,
        .menu-icon::after {
          content: "";
          position: absolute;
          left: 0;
        }

        .menu-icon::before {
          top: -6px;
        }

        .menu-icon::after {
          top: 6px;
        }

        header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 18px;
          margin-bottom: 20px;
        }

        .kicker {
          color: var(--straton-primary);
          font-size: 12px;
          font-weight: 750;
          letter-spacing: 1.2px;
          text-transform: uppercase;
        }

        h1 {
          margin: 5px 0 0;
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: 0;
        }

        .meta {
          margin-top: 7px;
          color: var(--straton-muted);
          font-size: 14px;
        }

        .actions {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        button,
        select {
          min-height: 40px;
          border: 1px solid var(--straton-border);
          border-radius: 8px;
          background: var(--straton-card);
          color: var(--straton-text);
          font: inherit;
          font-size: 14px;
        }

        button {
          cursor: pointer;
          padding: 0 14px;
        }

        button.primary {
          background: var(--straton-primary);
          border-color: var(--straton-primary);
          color: var(--text-primary-color, #061018);
          font-weight: 750;
        }

        select {
          min-width: 190px;
          padding: 0 34px 0 12px;
        }

        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 16px;
          align-items: start;
        }

        .surface {
          background: var(--straton-card);
          border: 1px solid var(--straton-border);
          border-radius: 8px;
          overflow: hidden;
        }

        .chart-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--straton-border);
        }

        .chart-title {
          min-width: 0;
        }

        .chart-title strong {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 18px;
        }

        .chart-title span {
          display: block;
          margin-top: 3px;
          color: var(--straton-muted);
          font-size: 13px;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          border-bottom: 1px solid var(--straton-border);
        }

        .stat {
          padding: 12px 16px;
          border-right: 1px solid var(--straton-border);
        }

        .stat:last-child {
          border-right: 0;
        }

        .stat-label {
          color: var(--straton-muted);
          font-size: 12px;
        }

        .stat-value {
          margin-top: 4px;
          font-size: 22px;
          font-weight: 800;
        }

        .chart-wrap {
          padding: 12px 14px 18px;
        }

        svg {
          display: block;
          width: 100%;
          height: auto;
        }

        .grid-line {
          stroke: rgba(255, 255, 255, 0.08);
          stroke-width: 1;
        }

        .axis-label {
          fill: var(--straton-muted);
          font-size: 11px;
        }

        .curve {
          fill: none;
          stroke: var(--line-color);
          stroke-width: 3;
          stroke-linejoin: round;
          stroke-linecap: round;
        }

        .area {
          fill: var(--line-color);
          opacity: 0.13;
        }

        .node {
          fill: var(--color);
          stroke: var(--straton-card);
          stroke-width: 3;
        }

        .node-label {
          fill: var(--straton-text);
          font-size: 10px;
          paint-order: stroke;
          stroke: rgba(0, 0, 0, 0.55);
          stroke-width: 3px;
        }

        .now-line {
          stroke: var(--straton-primary);
          stroke-width: 2;
          stroke-dasharray: 6 6;
        }

        .now-label {
          fill: var(--straton-primary);
          font-size: 11px;
          font-weight: 750;
        }

        aside {
          display: grid;
          gap: 16px;
        }

        .side-section {
          padding: 16px;
        }

        h2 {
          margin: 0 0 12px;
          font-size: 15px;
          letter-spacing: 0;
        }

        .spot-list,
        .node-list {
          display: grid;
          gap: 8px;
        }

        .row {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 42px;
          padding: 9px 10px;
          border-radius: 8px;
          background: var(--straton-panel);
        }

        .row-main {
          min-width: 0;
        }

        .row-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 650;
        }

        .row-sub {
          margin-top: 2px;
          color: var(--straton-muted);
          font-size: 12px;
        }

        .chip {
          flex: 0 0 auto;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 750;
          background: rgba(255, 255, 255, 0.08);
          color: var(--straton-text);
        }

        .chip.ok {
          background: rgba(76, 175, 80, 0.18);
          color: #a9e9ad;
        }

        .chip.off {
          background: rgba(244, 67, 54, 0.15);
          color: #ffb1a9;
        }

        .swatch {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color);
          border: 1px solid rgba(255, 255, 255, 0.3);
          flex: 0 0 auto;
        }

        .spectrum {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }

        .bar {
          display: grid;
          grid-template-columns: 36px 1fr 34px;
          align-items: center;
          gap: 8px;
          color: var(--straton-muted);
          font-size: 12px;
        }

        .track {
          height: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .fill {
          height: 100%;
          width: var(--value);
          border-radius: inherit;
          background: var(--color);
        }

        .error,
        .empty {
          background: var(--straton-card);
          border: 1px solid var(--straton-border);
          border-radius: 8px;
          padding: 18px;
          color: var(--straton-muted);
        }

        .error {
          color: var(--error-color, #ff8a80);
        }

        @media (max-width: 860px) {
          .page {
            width: min(100vw - 16px, 760px);
            padding-top: 62px;
          }

          header {
            display: grid;
            align-items: start;
          }

          .actions {
            justify-content: stretch;
          }

          select,
          button {
            width: 100%;
          }

          .layout {
            grid-template-columns: 1fr;
          }

          .stats {
            grid-template-columns: 1fr;
          }

          .stat {
            border-right: 0;
            border-bottom: 1px solid var(--straton-border);
          }

          .stat:last-child {
            border-bottom: 0;
          }
        }
      </style>
      <button class="menu-button" data-action="menu" aria-label="Menue oeffnen">
        <span class="menu-icon" aria-hidden="true"></span>
      </button>
      <div class="page">
        <header>
          <div>
            <div class="kicker">ATI Straton Flex</div>
            <h1>Lichtprogramm</h1>
            <div class="meta">${this._headerMeta(program)}</div>
          </div>
          <div class="actions">
            ${this._programSelect()}
            ${this._timelineSelect(program)}
            <button class="primary" data-action="reload" ${this._loading ? "disabled" : ""}>
              Aktualisieren
            </button>
          </div>
        </header>
        ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
        ${this._loading ? `<div class="empty">Programm wird geladen...</div>` : ""}
        ${!this._loading && !this._error && this._programs.length === 0 ? this._emptyView() : ""}
        ${!this._loading && !this._error && program && timeline ? this._programView(program, timeline) : ""}
      </div>
    `;
    this._updateMenuButton();
  }

  _programView(program, timeline) {
    const nodes = this._nodes(timeline);
    const activeColor = this._activeColor(nodes);
    return `
      <div class="layout">
        <section class="surface">
          <div class="chart-head">
            <div class="chart-title">
              <strong>${this._escape(timeline.name || "Gruppe")}</strong>
              <span>${timeline.spots?.length || 0} Spots · ${nodes.length} Punkte · ${this._escape(timeline.next_change || "-")} naechster Wechsel</span>
            </div>
            <span class="chip ${timeline.active ? "ok" : "off"}">${timeline.active ? "Aktiv" : "Inaktiv"}</span>
          </div>
          <div class="stats">
            <div class="stat">
              <div class="stat-label">Geplante Intensitaet</div>
              <div class="stat-value">${this._formatNumber(timeline.current_intensity)}%</div>
            </div>
            <div class="stat">
              <div class="stat-label">Leistung</div>
              <div class="stat-value">${program.current?.estimated_power ?? "-"} W</div>
            </div>
            <div class="stat">
              <div class="stat-label">Status</div>
              <div class="stat-value">${program.current?.warning || program.current?.danger ? "Warnung" : "OK"}</div>
            </div>
          </div>
          <div class="chart-wrap">${this._chart(timeline)}</div>
        </section>
        <aside>
          <section class="surface side-section">
            <h2>Spots</h2>
            <div class="spot-list">${this._spotRows(timeline)}</div>
          </section>
          <section class="surface side-section">
            <h2>Punkte</h2>
            <div class="node-list">${this._nodeRows(nodes)}</div>
          </section>
          <section class="surface side-section">
            <h2>Aktuelles Spektrum</h2>
            ${activeColor ? this._spectrum(activeColor) : `<div class="empty">Kein Spektrum aktiv.</div>`}
          </section>
        </aside>
      </div>
    `;
  }

  _chart(timeline) {
    const nodes = this._nodes(timeline);
    const width = 920;
    const height = 390;
    const pad = { left: 48, top: 22, right: 18, bottom: 42 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const lineColor = timeline.linecolor || "#03a9f4";
    const points = nodes.map((node) => ({
      x: pad.left + (this._nodeSeconds(node) / 86400) * innerWidth,
      y: pad.top + (1 - this._nodeValue(node) / 100) * innerHeight,
      node,
    }));
    const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    const area = points.length
      ? `${path} L ${points[points.length - 1].x.toFixed(1)} ${pad.top + innerHeight} L ${points[0].x.toFixed(1)} ${pad.top + innerHeight} Z`
      : "";
    const nowX = pad.left + (this._secondsNow() / 86400) * innerWidth;
    const yTicks = [0, 25, 50, 75, 100];
    const xTicks = [0, 6, 12, 18, 24];

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Straton Lichtkurve">
        ${yTicks
          .map((tick) => {
            const y = pad.top + (1 - tick / 100) * innerHeight;
            return `
              <line class="grid-line" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
              <text class="axis-label" x="10" y="${y + 4}">${tick}%</text>
            `;
          })
          .join("")}
        ${xTicks
          .map((tick) => {
            const x = pad.left + (tick / 24) * innerWidth;
            return `
              <line class="grid-line" x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + innerHeight}"></line>
              <text class="axis-label" x="${x - 12}" y="${height - 15}">${String(tick).padStart(2, "0")}:00</text>
            `;
          })
          .join("")}
        ${area ? `<path class="area" style="--line-color:${this._escape(lineColor)}" d="${area}"></path>` : ""}
        ${path ? `<path class="curve" style="--line-color:${this._escape(lineColor)}" d="${path}"></path>` : ""}
        <line class="now-line" x1="${nowX}" y1="${pad.top}" x2="${nowX}" y2="${pad.top + innerHeight}"></line>
        <text class="now-label" x="${Math.min(nowX + 6, width - 68)}" y="${pad.top + 14}">Jetzt</text>
        ${points
          .map((point) => {
            const color = point.node.color?.bgColor || lineColor;
            const labelY = point.y < 42 ? point.y + 22 : point.y - 12;
            return `
              <circle class="node" style="--color:${this._escape(color)}" cx="${point.x}" cy="${point.y}" r="7"></circle>
              <text class="node-label" x="${point.x + 9}" y="${labelY}">
                ${this._escape(point.node.time_label || "")} · ${this._formatNumber(point.node.value)}%
              </text>
            `;
          })
          .join("")}
      </svg>
    `;
  }

  _spotRows(timeline) {
    const spots = timeline.spots || [];
    if (!spots.length) {
      return `<div class="row"><div class="row-main"><div class="row-title">Keine Spots</div></div></div>`;
    }
    return spots
      .map(
        (spot) => `
          <div class="row">
            <div class="row-main">
              <div class="row-title">${this._escape(this._spotLabel(spot))}</div>
              <div class="row-sub">${this._escape(spot.external_id || "")} · ${spot.temperature ?? "-"} °C</div>
            </div>
            <span class="chip ${spot.online ? "ok" : "off"}">${spot.online ? "Online" : "Offline"}</span>
          </div>
        `
      )
      .join("");
  }

  _nodeRows(nodes) {
    if (!nodes.length) {
      return `<div class="row"><div class="row-main"><div class="row-title">Keine Punkte</div></div></div>`;
    }
    return nodes
      .map((node) => {
        const color = node.color?.bgColor || "#03a9f4";
        return `
          <div class="row">
            <span class="swatch" style="--color:${this._escape(color)}"></span>
            <div class="row-main">
              <div class="row-title">${this._escape(node.time_label || "-")} · ${this._formatNumber(node.value)}%</div>
              <div class="row-sub">${this._escape(node.color?.name || "Kein Spektrum")}</div>
            </div>
            <span class="chip">${this._escape(node.type || "node")}</span>
          </div>
        `;
      })
      .join("");
  }

  _spectrum(color) {
    const values = (color.values || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    if (!values.length) {
      return `<div class="empty">Keine Kanalwerte.</div>`;
    }
    return `
      <div class="row">
        <span class="swatch" style="--color:${this._escape(color.bgColor || "#03a9f4")}"></span>
        <div class="row-main">
          <div class="row-title">${this._escape(color.name || "Spektrum")}</div>
          <div class="row-sub">Kanalwerte 0-255</div>
        </div>
      </div>
      <div class="spectrum">
        ${values
          .map((value) => {
            const percent = Math.max(0, Math.min(100, (Number(value.value) / 255) * 100));
            return `
              <div class="bar">
                <span>${this._escape(value.name)}</span>
                <span class="track"><span class="fill" style="--value:${percent}%; --color:${this._channelColor(value.name)}"></span></span>
                <span>${value.value ?? "-"}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  _programSelect() {
    if (this._programs.length <= 1) {
      return "";
    }
    return `
      <select name="program" aria-label="Straton auswaehlen">
        ${this._programs
          .map(
            (program) => `
              <option value="${this._escape(program.entry_id)}" ${program.entry_id === this._entryId ? "selected" : ""}>
                ${this._escape(program.title)}
              </option>
            `
          )
          .join("")}
      </select>
    `;
  }

  _timelineSelect(program) {
    const timelines = program?.timelines || [];
    if (!timelines.length) {
      return "";
    }
    return `
      <select name="timeline" aria-label="Gruppe auswaehlen">
        ${timelines
          .map(
            (timeline) => `
              <option value="${this._escape(String(timeline.id))}" ${String(timeline.id) === this._timelineId ? "selected" : ""}>
                ${this._escape(timeline.name || timeline.id)}
              </option>
            `
          )
          .join("")}
      </select>
    `;
  }

  _emptyView() {
    return `<div class="empty">Keine ATI Straton Integration gefunden oder noch keine Programmdaten geladen.</div>`;
  }

  _headerMeta(program) {
    if (!program) {
      return "Read-only Ansicht der Tageskurve";
    }
    const device = program.device || {};
    const refresh = program.last_successful_refresh
      ? new Date(program.last_successful_refresh).toLocaleString()
      : "-";
    return `${this._escape(device.type || "Straton Flex")} · ${this._escape(device.software || "-")} · letzte Aktualisierung ${this._escape(refresh)}`;
  }

  _nodes(timeline) {
    return (timeline.nodes || [])
      .slice()
      .sort((a, b) => this._nodeSeconds(a) - this._nodeSeconds(b));
  }

  _activeColor(nodes) {
    const now = this._secondsNow();
    let active = nodes[0];
    for (const node of nodes) {
      if (this._nodeSeconds(node) <= now) {
        active = node;
      }
    }
    return active?.color;
  }

  _nodeSeconds(node) {
    const value = Number(node?.time);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(86400, value));
  }

  _nodeValue(node) {
    const value = Number(node?.value);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }

  _secondsNow() {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }

  _spotLabel(spot) {
    return (spot.name || spot.custom_name || spot.external_id || "Spot").replaceAll("_", " ");
  }

  _formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "-";
    }
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  _channelColor(name) {
    const colors = {
      UV: "#7e57c2",
      V: "#8e24aa",
      RB: "#304ffe",
      B: "#2196f3",
      LC: "#00bcd4",
      W: "#f7f7f2",
      R: "#f44336",
    };
    return colors[name] || "#03a9f4";
  }

  _updateMenuButton() {
    const menuButton = this.shadowRoot.querySelector(".menu-button");
    if (menuButton) {
      menuButton.style.display = this._narrow ? "grid" : "none";
    }
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("ati-straton-program-panel", ATIStratonProgramPanel);
