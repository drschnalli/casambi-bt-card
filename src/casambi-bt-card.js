/*
 * Casambi BT Card
 * A clean Lovelace card for the Casambi Bluetooth Home Assistant integration.
 * No external dependencies.
 */

const CARD_VERSION = '0.1.0';
const CARD_TAG = 'casambi-bt-card';
const EDITOR_TAG = 'casambi-bt-card-editor';

const fireEvent = (node, type, detail = {}, options = {}) => {
  node.dispatchEvent(new CustomEvent(type, {
    detail,
    bubbles: options.bubbles ?? true,
    cancelable: options.cancelable ?? false,
    composed: options.composed ?? true,
  }));
};

const stateName = (stateObj) => stateObj?.attributes?.friendly_name || stateObj?.entity_id || '';
const domainOf = (entityId) => (entityId || '').split('.')[0];
const isUnavailable = (stateObj) => !stateObj || ['unavailable', 'unknown'].includes(stateObj.state);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

function getRawNetworkData(hass, config) {
  const configured = config.network_config_entity ? hass.states[config.network_config_entity] : undefined;
  const candidates = configured ? [configured] : Object.values(hass.states).filter((stateObj) => {
    if (domainOf(stateObj.entity_id) !== 'sensor') return false;
    const name = `${stateObj.entity_id} ${stateName(stateObj)}`.toLowerCase();
    return name.includes('casambi') && (name.includes('network') || name.includes('configuration'));
  });
  for (const candidate of candidates) {
    const raw = candidate?.attributes?.raw_network_data;
    if (raw?.network) return { raw, entity: candidate.entity_id };
  }
  return { raw: undefined, entity: undefined };
}

function globToRegex(glob) {
  if (!glob) return null;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function nameMatchesNetwork(raw, stateObj, type) {
  if (!raw?.network || !stateObj) return false;
  const friendly = stateName(stateObj).toLowerCase();
  const eid = stateObj.entity_id.toLowerCase();
  if (type === 'light') {
    const units = raw.network.units || [];
    return units.some((unit) => {
      const n = `${unit.name || ''}`.toLowerCase();
      return n && (friendly.includes(n) || eid.includes(n.replace(/\s+/g, '_')));
    });
  }
  if (type === 'scene') {
    const scenes = raw.network.scenes || [];
    return scenes.some((scene) => {
      const n = `${scene.name || ''}`.toLowerCase();
      return n && (friendly.includes(n) || eid.includes(n.replace(/\s+/g, '_')));
    });
  }
  return false;
}

function discoverEntities(hass, config, type) {
  const configured = normalizeList(config?.[type === 'light' ? 'lights' : 'scenes']);
  if (configured.length) return configured;

  if (config.auto_discover === false) return [];
  const { raw } = getRawNetworkData(hass, config);
  const include = config.include || {};
  const glob = globToRegex(type === 'light' ? include.light_glob : include.scene_glob);
  const domain = type === 'light' ? 'light' : 'scene';
  const seen = new Set();
  const matches = [];

  Object.values(hass.states).forEach((stateObj) => {
    if (domainOf(stateObj.entity_id) !== domain) return;
    if (include.only_available && isUnavailable(stateObj)) return;
    const haystack = `${stateObj.entity_id} ${stateName(stateObj)}`.toLowerCase();
    const entityMatch = glob ? glob.test(stateObj.entity_id) : false;
    const casambiMatch = haystack.includes('casambi');
    const rawMatch = nameMatchesNetwork(raw, stateObj, type);
    if (entityMatch || casambiMatch || rawMatch) {
      if (!seen.has(stateObj.entity_id)) {
        seen.add(stateObj.entity_id);
        matches.push(stateObj.entity_id);
      }
    }
  });

  matches.sort((a, b) => stateName(hass.states[a]).localeCompare(stateName(hass.states[b])));
  return matches;
}

class CasambiBtCard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR_TAG); }
  static getStubConfig(hass) {
    const lights = Object.keys(hass.states).filter((entityId) => entityId.startsWith('light.')).slice(0, 4);
    const scenes = Object.keys(hass.states).filter((entityId) => entityId.startsWith('scene.')).slice(0, 4);
    return { title: 'Casambi', auto_discover: true, style: 'casambi', lights, scenes };
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = {
      title: 'Casambi',
      auto_discover: true,
      style: 'casambi',
      show_header: true,
      show_scenes: true,
      show_lights: true,
      show_footer: true,
      ...config,
    };
    this._lastScene = this._lastScene || null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const lights = discoverEntities(this._hass || {states: {}}, this._config || {}, 'light').length;
    const scenes = discoverEntities(this._hass || {states: {}}, this._config || {}, 'scene').length;
    return 3 + Math.ceil(lights / 2) + Math.ceil(scenes / 3);
  }

  _networkStatus() {
    const hass = this._hass;
    const config = this._config;
    const statusEntity = config.status_entity || config.network_entity;
    const statusObj = statusEntity ? hass.states[statusEntity] : undefined;
    const lights = discoverEntities(hass, config, 'light');
    const anyAvailable = lights.some((entityId) => !isUnavailable(hass.states[entityId]));
    const online = statusObj ? ['on', 'connected', 'true'].includes(String(statusObj.state).toLowerCase()) : anyAvailable;
    return { online, statusObj };
  }

  async _toggleLight(entityId) {
    await this._hass.callService('light', 'toggle', { entity_id: entityId });
  }

  async _setBrightness(entityId, value) {
    await this._hass.callService('light', 'turn_on', { entity_id: entityId, brightness: Number(value) });
  }

  async _activateScene(entityId) {
    this._lastScene = entityId;
    this._lastSceneTs = Date.now();
    await this._hass.callService('scene', 'turn_on', { entity_id: entityId });
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    const hass = this._hass;
    const config = this._config;
    const lights = discoverEntities(hass, config, 'light');
    const scenes = discoverEntities(hass, config, 'scene');
    const { raw, entity: configSensor } = getRawNetworkData(hass, config);
    const { online } = this._networkStatus();
    const networkName = config.network_name || raw?.network?.name || config.title || 'Casambi';
    const activeLights = lights.filter((id) => hass.states[id]?.state === 'on').length;
    const unavailableLights = lights.filter((id) => isUnavailable(hass.states[id])).length;
    const sceneKeepMs = Number(config.scene_highlight_seconds ?? 8) * 1000;
    const lastSceneActive = this._lastScene && (Date.now() - (this._lastSceneTs || 0) < sceneKeepMs);
    const activeScene = lastSceneActive ? this._lastScene : null;

    this.innerHTML = `
      <ha-card class="casambi-card theme-${config.style || 'casambi'}">
        ${this._style()}
        ${config.show_header !== false ? `
          <div class="header">
            <div class="brand">
              <div class="logo">C</div>
              <div>
                <div class="title">${config.title || 'Casambi'}</div>
                <div class="subtitle">${networkName}</div>
              </div>
            </div>
            <div class="status ${online ? 'online' : 'offline'}">
              <span></span>${online ? 'Online' : 'Offline'}
            </div>
          </div>
          <div class="stats">
            <div><strong>${lights.length}</strong><span>Lichter</span></div>
            <div><strong>${activeLights}</strong><span>Aktiv</span></div>
            <div><strong>${scenes.length}</strong><span>Szenen</span></div>
            <div><strong>${unavailableLights}</strong><span>Offline</span></div>
          </div>
        ` : ''}
        ${config.show_scenes !== false ? this._renderScenes(scenes, activeScene) : ''}
        ${config.show_lights !== false ? this._renderLights(lights) : ''}
        ${config.show_footer !== false ? `
          <div class="footer">
            <span>Casambi BT Card ${CARD_VERSION}</span>
            ${configSensor ? `<span>${configSensor}</span>` : '<span>Manuelle Auswahl empfohlen</span>'}
          </div>
        ` : ''}
      </ha-card>
    `;

    this.querySelectorAll('[data-scene]').forEach((el) => {
      el.addEventListener('click', () => this._activateScene(el.dataset.scene));
    });
    this.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => this._toggleLight(el.dataset.toggle));
    });
    this.querySelectorAll('[data-brightness]').forEach((el) => {
      el.addEventListener('change', () => this._setBrightness(el.dataset.brightness, el.value));
      el.addEventListener('input', () => {
        const value = el.closest('.light-card')?.querySelector('.brightness-value');
        if (value) value.textContent = `${Math.round(Number(el.value) / 2.55)}%`;
      });
    });
  }

  _renderScenes(scenes, activeScene) {
    const hass = this._hass;
    return `
      <section class="section">
        <div class="section-title"><ha-icon icon="mdi:palette-outline"></ha-icon><span>Szenen</span></div>
        ${scenes.length ? `<div class="scene-grid">
          ${scenes.map((entityId) => {
            const stateObj = hass.states[entityId];
            const active = entityId === activeScene;
            return `<button class="scene-chip ${active ? 'active' : ''}" data-scene="${entityId}" title="${entityId}">
              <ha-icon icon="${active ? 'mdi:check-circle' : 'mdi:creation'}"></ha-icon>
              <span>${stateName(stateObj).replace(/^Casambi\s*/i, '')}</span>
            </button>`;
          }).join('')}
        </div>` : `<div class="empty">Keine Szenen gefunden. Trage sie im Card-Editor ein oder aktiviere Auto-Discovery mit passenden Namen.</div>`}
      </section>
    `;
  }

  _renderLights(lights) {
    const hass = this._hass;
    return `
      <section class="section">
        <div class="section-title"><ha-icon icon="mdi:lightbulb-group-outline"></ha-icon><span>Lichter</span></div>
        ${lights.length ? `<div class="light-grid">
          ${lights.map((entityId) => {
            const stateObj = hass.states[entityId];
            const on = stateObj?.state === 'on';
            const unavailable = isUnavailable(stateObj);
            const brightness = Number(stateObj?.attributes?.brightness ?? (on ? 255 : 0));
            const pct = Math.round(brightness / 2.55);
            const colorMode = stateObj?.attributes?.color_mode || 'light';
            return `<div class="light-card ${on ? 'on' : ''} ${unavailable ? 'unavailable' : ''}">
              <div class="light-top">
                <div class="light-name" title="${entityId}">${stateName(stateObj)}</div>
                <button class="power ${on ? 'on' : ''}" data-toggle="${entityId}"><ha-icon icon="mdi:power"></ha-icon></button>
              </div>
              <div class="meta">
                <span>${unavailable ? 'Nicht verfügbar' : (on ? 'Eingeschaltet' : 'Aus')}</span>
                <span>${colorMode}</span>
              </div>
              <div class="slider-row">
                <ha-icon icon="mdi:brightness-6"></ha-icon>
                <input type="range" min="1" max="255" value="${clamp(brightness || 1, 1, 255)}" data-brightness="${entityId}" ${unavailable ? 'disabled' : ''}/>
                <span class="brightness-value">${pct}%</span>
              </div>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty">Keine Lichter gefunden. Wähle deine Casambi-Lichter im Card-Editor aus.</div>`}
      </section>
    `;
  }

  _style() {
    return `<style>
      .casambi-card {
        --cb-bg: linear-gradient(145deg, rgba(17, 24, 39, .96), rgba(21, 35, 54, .96));
        --cb-panel: rgba(255,255,255,.075);
        --cb-panel-2: rgba(255,255,255,.11);
        --cb-text: var(--primary-text-color, #f8fafc);
        --cb-muted: var(--secondary-text-color, #a8b3c7);
        --cb-accent: #15c8ff;
        --cb-accent-2: #1de9b6;
        --cb-warn: #ffb74d;
        --cb-radius: 22px;
        color: var(--cb-text);
        background: var(--cb-bg);
        overflow: hidden;
        border-radius: var(--cb-radius);
        border: 1px solid rgba(255,255,255,.12);
        box-shadow: 0 16px 48px rgba(0,0,0,.28);
      }
      .theme-mushroom { --cb-bg: var(--ha-card-background, var(--card-background-color)); --cb-text: var(--primary-text-color); --cb-muted: var(--secondary-text-color); --cb-panel: rgba(127,127,127,.10); --cb-panel-2: rgba(127,127,127,.16); --cb-radius: 18px; }
      .theme-bubble { --cb-radius: 32px; --cb-accent: #03a9f4; --cb-accent-2: #00e5ff; }
      .theme-minimal { --cb-bg: var(--ha-card-background, var(--card-background-color)); --cb-panel: transparent; --cb-panel-2: rgba(127,127,127,.10); box-shadow: none; }
      .header { display:flex; align-items:center; justify-content:space-between; padding:18px 18px 8px; gap:12px; }
      .brand { display:flex; gap:12px; align-items:center; min-width:0; }
      .logo { width:42px; height:42px; border-radius:14px; display:grid; place-items:center; font-weight:900; color:#03202d; background: linear-gradient(135deg, var(--cb-accent), var(--cb-accent-2)); box-shadow: 0 0 24px rgba(21,200,255,.35); }
      .title { font-size:18px; font-weight:800; line-height:1.1; }
      .subtitle { color:var(--cb-muted); font-size:12px; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px; }
      .status { display:inline-flex; align-items:center; gap:7px; padding:7px 10px; border-radius:999px; font-size:12px; background:var(--cb-panel); color:var(--cb-muted); }
      .status span { width:8px; height:8px; border-radius:50%; background:#ef5350; box-shadow:0 0 10px #ef5350; }
      .status.online span { background:var(--cb-accent-2); box-shadow:0 0 12px var(--cb-accent-2); }
      .stats { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; padding:10px 18px 4px; }
      .stats div { background:var(--cb-panel); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:9px 8px; text-align:center; }
      .stats strong { display:block; font-size:16px; }
      .stats span { display:block; font-size:11px; color:var(--cb-muted); margin-top:2px; }
      .section { padding:12px 18px 4px; }
      .section-title { display:flex; align-items:center; gap:8px; font-weight:800; font-size:14px; margin:0 0 10px; color:var(--cb-text); }
      .section-title ha-icon { color:var(--cb-accent); }
      .scene-grid { display:flex; flex-wrap:wrap; gap:9px; }
      .scene-chip { border: 1px solid rgba(255,255,255,.12); border-radius:999px; background:var(--cb-panel); color:var(--cb-text); padding:10px 13px; display:flex; align-items:center; gap:8px; cursor:pointer; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; font:inherit; }
      .scene-chip:hover { transform: translateY(-1px); background:var(--cb-panel-2); }
      .scene-chip.active { color:#02251f; background:linear-gradient(135deg, var(--cb-accent-2), #b2fff0); box-shadow:0 0 22px rgba(29,233,182,.42); border-color:transparent; }
      .light-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap:10px; }
      .light-card { background:var(--cb-panel); border:1px solid rgba(255,255,255,.10); border-radius:18px; padding:12px; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease; }
      .light-card.on { background: linear-gradient(145deg, rgba(21,200,255,.14), rgba(29,233,182,.09)); border-color: rgba(29,233,182,.30); box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
      .light-card.unavailable { opacity:.52; }
      .light-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
      .light-name { font-weight:800; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .power { width:38px; height:38px; border:0; border-radius:14px; display:grid; place-items:center; background:rgba(255,255,255,.10); color:var(--cb-muted); cursor:pointer; }
      .power.on { color:#02251f; background:linear-gradient(135deg, var(--cb-accent), var(--cb-accent-2)); }
      .meta { display:flex; justify-content:space-between; gap:8px; color:var(--cb-muted); font-size:11px; margin:7px 0 12px; }
      .slider-row { display:grid; grid-template-columns: 22px 1fr 42px; gap:8px; align-items:center; color:var(--cb-muted); }
      input[type=range] { accent-color: var(--cb-accent); width:100%; }
      .brightness-value { text-align:right; font-size:12px; color:var(--cb-text); font-variant-numeric: tabular-nums; }
      .empty { color:var(--cb-muted); background:var(--cb-panel); border-radius:16px; padding:14px; font-size:13px; }
      .footer { display:flex; justify-content:space-between; gap:10px; padding:12px 18px 16px; color:var(--cb-muted); font-size:11px; }
      @media (max-width: 480px) { .stats { grid-template-columns: repeat(2, 1fr); } .header { align-items:flex-start; } .status { font-size:11px; } .light-grid { grid-template-columns: 1fr; } }
    </style>`;
  }
}

class CasambiBtCardEditor extends HTMLElement {
  setConfig(config) { this._config = { auto_discover: true, style: 'casambi', ...(config || {}) }; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }

  _valueChanged(key, value) {
    const config = { ...this._config, [key]: value };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
    this._render();
  }

  _listChanged(key, value) {
    this._valueChanged(key, normalizeList(value));
  }

  _render() {
    if (!this._hass || !this._config) return;
    const lights = normalizeList(this._config.lights);
    const scenes = normalizeList(this._config.scenes);
    this.innerHTML = `
      <div class="editor">
        <style>
          .editor { display:grid; gap:14px; padding:8px 0; }
          .row { display:grid; gap:6px; }
          label { font-weight:600; color:var(--primary-text-color); }
          input, select, textarea { width:100%; box-sizing:border-box; border:1px solid var(--divider-color); border-radius:10px; padding:9px; background:var(--card-background-color); color:var(--primary-text-color); }
          textarea { min-height:80px; font-family:monospace; }
          .hint { color:var(--secondary-text-color); font-size:12px; }
        </style>
        <div class="row"><label>Titel</label><input id="title" value="${this._config.title || 'Casambi'}"></div>
        <div class="row"><label>Stil</label><select id="style">
          ${['casambi','mushroom','bubble','minimal'].map((s) => `<option value="${s}" ${this._config.style === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
        <div class="row"><label>Status Entity optional</label><ha-entity-picker id="status" .hass="${''}" value="${this._config.status_entity || this._config.network_entity || ''}" allow-custom-entity></ha-entity-picker></div>
        <div class="row"><label>Network Config Sensor optional</label><ha-entity-picker id="networkConfig" value="${this._config.network_config_entity || ''}" allow-custom-entity></ha-entity-picker><div class="hint">Optional: Sensor mit raw_network_data Attribut für bessere Auto-Erkennung.</div></div>
        <div class="row"><label>Lichter</label><textarea id="lights" placeholder="light.lampe_1\nlight.lampe_2">${lights.join('\n')}</textarea></div>
        <div class="row"><label>Szenen</label><textarea id="scenes" placeholder="scene.an\nscene.aus">${scenes.join('\n')}</textarea></div>
        <div class="row"><label><input type="checkbox" id="auto" ${this._config.auto_discover !== false ? 'checked' : ''}> Auto-Discovery aktivieren</label><div class="hint">Findet Entity-IDs mit Casambi im Namen oder per Network-Config-Sensor.</div></div>
      </div>
    `;
    const statusPicker = this.querySelector('#status');
    const networkPicker = this.querySelector('#networkConfig');
    statusPicker.hass = this._hass;
    networkPicker.hass = this._hass;
    this.querySelector('#title').addEventListener('change', (ev) => this._valueChanged('title', ev.target.value));
    this.querySelector('#style').addEventListener('change', (ev) => this._valueChanged('style', ev.target.value));
    statusPicker.addEventListener('value-changed', (ev) => this._valueChanged('status_entity', ev.detail.value));
    networkPicker.addEventListener('value-changed', (ev) => this._valueChanged('network_config_entity', ev.detail.value));
    this.querySelector('#lights').addEventListener('change', (ev) => this._listChanged('lights', ev.target.value));
    this.querySelector('#scenes').addEventListener('change', (ev) => this._listChanged('scenes', ev.target.value));
    this.querySelector('#auto').addEventListener('change', (ev) => this._valueChanged('auto_discover', ev.target.checked));
  }
}

customElements.define(CARD_TAG, CasambiBtCard);
customElements.define(EDITOR_TAG, CasambiBtCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'Casambi BT Card',
  description: 'Control Casambi Bluetooth lights and scenes with a clean Lovelace card.',
  preview: true,
});
console.info(`%c CASAMBI-BT-CARD %c ${CARD_VERSION} `, 'color: #111; background: #15c8ff; font-weight: 700;', 'color: #111; background: #1de9b6; font-weight: 700;');
