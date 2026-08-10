/* Casambi BT Card v0.1.5 */
const CARD_VERSION = '0.1.5';
const CARD_TAG = 'casambi-bt-card';
const EDITOR_TAG = 'casambi-bt-card-editor';
const BAD_SOURCES = {
  android_bridge: ['android_casambi_bridge'],
  jungle: ['casambi_jungle', 'jungle'],
  hue: ['hue_', ' hue ', 'philips hue'],
  shelly: ['shelly'],
  wallpanel: ['wallpanel', 'wall_display'],
  helper: ['helper'],
};
const SOURCE_LABELS = {
  casambi_bt_candidate: '✅ Casambi BT',
  raw_network: '✅ RAW Casambi',
  name_only: '⚠ Name Match Only',
  android_bridge: '⚠ Android Bridge',
  jungle: '🌴 Jungle',
  hue: '💡 Hue',
  shelly: '🔌 Shelly',
  wallpanel: '🖥 WallPanel',
  helper: '🧩 Helper',
  unknown: '❔ Unknown',
};
const DEFAULT_EXCLUDE = ['android_bridge', 'jungle', 'hue', 'shelly', 'wallpanel', 'helper'];
const PRESET_OPTIONS = ['casambi-native', 'casambi-neon', 'djungle', 'cyberpunk-blue', 'cyberpunk-purple', 'space-opera', 'retro-lcars', 'mushroom-soft', 'mushroom-dark', 'bubble-compact', 'bubble-glass', 'minimal'];
const LAYOUT_OPTIONS = ['default', 'compact', 'wide', 'scenes-first', 'lights-first'];

const stateName = (s) => s?.attributes?.friendly_name || s?.entity_id || '';
const domainOf = (e) => (e || '').split('.')[0];
const unavailable = (s) => !s || ['unavailable', 'unknown'].includes(s.state);
const normList = (v) => !v ? [] : Array.isArray(v) ? v.filter(Boolean) : String(v).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
const fire = (n, t, d) => n.dispatchEvent(new CustomEvent(t, { detail: d, bubbles: true, composed: true }));
const isOn = (s) => ['on', 'connected', 'online', 'true'].includes(String(s?.state || '').toLowerCase());

function slug(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function rawData(hass, config) {
  const configured = config.network_config_entity ? hass.states[config.network_config_entity] : null;
  const list = configured ? [configured] : Object.values(hass.states).filter((s) => domainOf(s.entity_id) === 'sensor' && s.attributes?.raw_network_data?.network);
  for (const s of list) {
    if (s?.attributes?.raw_network_data?.network) return { raw: s.attributes.raw_network_data, entity: s.entity_id };
  }
  return {};
}

function sourceOf(s) {
  const eid = (s?.entity_id || '').toLowerCase();
  const name = stateName(s).toLowerCase();
  for (const [source, words] of Object.entries(BAD_SOURCES)) {
    if (words.some((w) => eid.includes(w) || name.includes(w.replace(/_/g, ' ')))) return source;
  }
  return 'casambi_bt_candidate';
}

function rawTargets(hass, config, type) {
  const { raw } = rawData(hass, config);
  const network = config.network_name || raw?.network?.name || '';
  if (!raw?.network) return { targets: [], network };
  if (type === 'light') {
    return { targets: (raw.network.units || []).map((u) => ({ name: u.name, id: u.deviceID || u.deviceId, uuid: u.uuid, slug: slug(u.name) })).filter((x) => x.name), network };
  }
  return { targets: (raw.network.scenes || []).map((s) => ({ name: s.name, id: s.sceneID || s.sceneId, slug: slug(s.name) })).filter((x) => x.name), network };
}

function scoreEntity(s, wanted, network, type, config = {}) {
  if (!s) return { score: -999, source: 'unknown', reason: 'missing' };
  const eid = s.entity_id.toLowerCase();
  const friendly = stateName(s);
  const friendlyLower = friendly.toLowerCase();
  const wantedLower = String(wanted || '').toLowerCase();
  const wantedSlug = slug(wanted);
  const networkSlug = slug(network);
  let score = 0;
  const reasons = [];

  if (friendly === wanted) { score += 100; reasons.push('friendly exact'); }
  if (friendlyLower === wantedLower) { score += 90; reasons.push('name exact'); }
  if (network && friendlyLower === `${network} ${wanted}`.toLowerCase()) { score += 95; reasons.push('network name exact'); }
  if (network && friendlyLower === `${wanted} ${network}`.toLowerCase()) { score += 75; reasons.push('unit network name'); }
  if (wantedSlug && eid.endsWith(`_${wantedSlug}`)) { score += 55; reasons.push('entity suffix'); }
  if (wantedSlug && eid.includes(wantedSlug)) { score += 35; reasons.push('entity contains target slug'); }
  if (networkSlug && eid.includes(networkSlug)) { score += 25; reasons.push('network slug'); }
  if (!unavailable(s)) { score += config.discovery?.prefer_available === false ? 10 : 25; reasons.push('available'); }
  const source = sourceOf(s);
  if (source !== 'casambi_bt_candidate') { score -= 120; reasons.push('external source penalty'); }
  if (type === 'scene' && networkSlug && wantedSlug && eid === `scene.${networkSlug}_${wantedSlug}`) { score += 160; reasons.push('raw scene pattern'); }
  if (type === 'light' && wantedSlug && eid.includes(wantedSlug)) { score += 30; reasons.push('light name match'); }
  return { score, source, reason: reasons.join(', ') || 'fallback candidate' };
}

function candidatesFor(hass, config, type) {
  const domain = type === 'light' ? 'light' : 'scene';
  const { targets, network } = rawTargets(hass, config, type);
  const strict = config.discovery?.strict_casambi_matching !== false;
  const all = Object.values(hass.states).filter((s) => domainOf(s.entity_id) === domain);
  const seen = new Map();

  for (const target of targets) {
    for (const state of all) {
      const result = scoreEntity(state, target.name, network, type, config);
      const isRawCandidate = result.score >= (type === 'scene' ? 90 : 70);
      if (isRawCandidate) {
        const old = seen.get(state.entity_id);
        const source = sourceOf(state) === 'casambi_bt_candidate' ? 'raw_network' : sourceOf(state);
        if (!old || result.score > old.score) {
          seen.set(state.entity_id, {
            entity_id: state.entity_id,
            name: stateName(state),
            state: state.state,
            score: result.score,
            source,
            reason: result.reason,
            target: target.name,
            raw_match: true,
            available: !unavailable(state),
          });
        }
      }
    }
  }

  if (!strict && config.discovery?.include_fallback_candidates !== false) {
    for (const state of all) {
      const eid = state.entity_id.toLowerCase();
      const name = stateName(state).toLowerCase();
      const networkSlug = slug(network);
      if ((eid.includes('casambi') || name.includes('casambi') || (networkSlug && eid.includes(networkSlug))) && !seen.has(state.entity_id)) {
        const result = scoreEntity(state, '', network, type, config);
        seen.set(state.entity_id, {
          entity_id: state.entity_id,
          name: stateName(state),
          state: state.state,
          score: result.score,
          source: sourceOf(state) === 'casambi_bt_candidate' ? 'name_only' : sourceOf(state),
          reason: 'fallback name/network match only',
          target: 'fallback',
          raw_match: false,
          available: !unavailable(state),
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function isAllowedManual(hass, config, type, entityId) {
  if (!hass.states[entityId]) return false;
  if (config.discovery?.strict_casambi_matching === false) return true;
  return candidatesFor(hass, config, type).some((x) => x.entity_id === entityId && x.raw_match && !(config.discovery?.exclude_sources || DEFAULT_EXCLUDE).includes(x.source));
}

function selectedBest(hass, config, type, onlyAvailable = false) {
  const key = type === 'light' ? 'lights' : 'scenes';
  const manual = normList(config[key]).filter((e) => isAllowedManual(hass, config, type, e));
  if (manual.length) return manual;
  let list = candidatesFor(hass, config, type);
  const exclude = config.discovery?.exclude_sources || DEFAULT_EXCLUDE;
  list = list.filter((x) => !exclude.includes(x.source));
  if (config.discovery?.strict_casambi_matching !== false) list = list.filter((x) => x.raw_match);
  if (onlyAvailable) list = list.filter((x) => x.available);
  if (config.discovery?.hide_unavailable_duplicates !== false) {
    const byName = new Map();
    for (const x of list) {
      const keyName = slug(x.name);
      const old = byName.get(keyName);
      if (!old || (!old.available && x.available) || x.score > old.score) byName.set(keyName, x);
    }
    list = [...byName.values()];
  }
  if (config.discovery?.prefer_available !== false) list.sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score);
  return list.filter((x) => x.score >= 70).map((x) => x.entity_id);
}

function detectStatus(hass, config) {
  if (config.status_entity && hass.states[config.status_entity]) return config.status_entity;
  const { raw } = rawData(hass, config);
  const network = config.network_name || raw?.network?.name || config.title || '';
  const networkSlug = slug(network);
  let best = null;
  let bestScore = -999;
  Object.values(hass.states).filter((s) => domainOf(s.entity_id) === 'binary_sensor').forEach((s) => {
    const eid = s.entity_id.toLowerCase();
    const name = stateName(s).toLowerCase();
    let score = 0;
    if (networkSlug && eid === `binary_sensor.${networkSlug}_status`) score += 200;
    if (network && name === `${network} status`.toLowerCase()) score += 160;
    if (name.includes('status')) score += 25;
    if (sourceOf(s) !== 'casambi_bt_candidate') score -= 100;
    if (score > bestScore) { bestScore = score; best = s; }
  });
  return bestScore >= 80 ? best.entity_id : undefined;
}

class CasambiBtCard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR_TAG); }
  static getStubConfig() { return { title: 'Casambi', preset: 'djungle', layout: 'default', network_config_entity: '', discovery: { strict_casambi_matching: true, prefer_available: true, hide_unavailable_duplicates: true }, lights: [], scenes: [] }; }
  setConfig(config) {
    this._config = {
      title: 'Casambi',
      preset: config?.style || 'djungle',
      layout: 'default',
      auto_discover: false,
      discovery: { strict_casambi_matching: true, prefer_available: true, hide_unavailable_duplicates: true, show_rejected_candidates: true, exclude_sources: DEFAULT_EXCLUDE },
      controls: { brightness: true, color_temp: 'auto' },
      show_header: true,
      show_stats: true,
      show_scenes: true,
      show_lights: true,
      show_footer: true,
      ...config,
    };
    if (!this._config.preset && this._config.style) this._config.preset = this._config.style;
  }
  set hass(hass) { this._hass = hass; this.render(); }
  getCardSize() { return this._config?.layout === 'compact' ? 3 : 5; }
  async call(domain, service, data) { await this._hass.callService(domain, service, data); }
  async scene(entity) { this._lastScene = entity; this._lastSceneTs = Date.now(); await this.call('scene', 'turn_on', { entity_id: entity }); this.render(); }
  render() {
    if (!this._hass || !this._config) return;
    const hass = this._hass;
    const config = this._config;
    const preset = config.preset || config.style || 'djungle';
    const layout = config.layout || 'default';
    const lights = selectedBest(hass, config, 'light');
    const scenes = selectedBest(hass, config, 'scene');
    const statusEntity = detectStatus(hass, config);
    const online = statusEntity ? isOn(hass.states[statusEntity]) : lights.some((e) => !unavailable(hass.states[e]));
    const { raw, entity: configSensor } = rawData(hass, config);
    const network = config.network_name || raw?.network?.name || config.title;
    const activeLights = lights.filter((e) => hass.states[e]?.state === 'on').length;
    const offlineLights = lights.filter((e) => unavailable(hass.states[e])).length;
    const header = config.show_header === false ? '' : `<div class="head"><div class="brand"><div class="logo">C</div><div><div class="title">${config.title}</div><div class="sub">${network || 'Casambi'}</div></div></div><div class="state ${online ? 'on' : 'off'}"><i></i>${online ? 'Online' : 'Offline'}</div></div>`;
    const stats = config.show_stats === false ? '' : `<div class="stats"><b>${lights.length}<span>Lichter</span></b><b>${activeLights}<span>Aktiv</span></b><b>${scenes.length}<span>Szenen</span></b><b>${offlineLights}<span>Offline</span></b></div>`;
    const scenesBlock = config.show_scenes === false ? '' : this.renderScenes(scenes);
    const lightsBlock = config.show_lights === false ? '' : this.renderLights(lights);
    const ordered = layout === 'lights-first' ? lightsBlock + scenesBlock : scenesBlock + lightsBlock;
    const footer = config.show_footer === false ? '' : `<footer><span>Casambi BT Card ${CARD_VERSION}</span><span>${configSensor || 'Auto-Discovery bereit'}</span></footer>`;
    this.innerHTML = `<ha-card class="cb preset-${preset} layout-${layout}">${this.css()}${header}${stats}<div class="body layout-${layout}">${ordered}</div>${footer}</ha-card>`;
    this.querySelectorAll('[data-scene]').forEach((x) => x.onclick = () => this.scene(x.dataset.scene));
    this.querySelectorAll('[data-toggle]').forEach((x) => x.onclick = () => this.call('light', 'toggle', { entity_id: x.dataset.toggle }));
    this.querySelectorAll('[data-br]').forEach((x) => x.onchange = () => this.call('light', 'turn_on', { entity_id: x.dataset.br, brightness: Number(x.value) }));
    this.querySelectorAll('[data-temp]').forEach((x) => x.onchange = () => this.call('light', 'turn_on', { entity_id: x.dataset.temp, color_temp_kelvin: Number(x.value) }));
  }
  renderScenes(scenes) {
    const hass = this._hass;
    return `<section class="section scenes-section"><h3><ha-icon icon="mdi:palette-outline"></ha-icon>Szenen</h3><div class="scenes">${scenes.length ? scenes.map((e) => `<button data-scene="${e}" title="${e}"><ha-icon icon="mdi:creation"></ha-icon>${stateName(hass.states[e]).replace(/^Casambi\s*/i, '')}</button>`).join('') : '<p>Keine Casambi-Szenen gefunden. Strict RAW-Matching filtert fremde Szenen aus.</p>'}</div></section>`;
  }
  renderLights(lights) {
    const hass = this._hass;
    const config = this._config;
    return `<section class="section lights-section"><h3><ha-icon icon="mdi:lightbulb-group-outline"></ha-icon>Lichter</h3><div class="grid">${lights.length ? lights.map((e) => {
      const s = hass.states[e];
      const on = s?.state === 'on';
      const br = Number(s?.attributes?.brightness ?? (on ? 255 : 0));
      const pct = Math.round(br / 2.55);
      const hasTemp = config.controls?.color_temp !== false && (s?.attributes?.color_temp_kelvin || (s?.attributes?.min_color_temp_kelvin && s?.attributes?.max_color_temp_kelvin));
      const minK = Number(s?.attributes?.min_color_temp_kelvin || 2200);
      const maxK = Number(s?.attributes?.max_color_temp_kelvin || 6500);
      const valK = Number(s?.attributes?.color_temp_kelvin || Math.round((minK + maxK) / 2));
      return `<div class="tile ${on ? 'on' : ''} ${unavailable(s) ? 'unav' : ''}"><div class="tile-head"><strong>${stateName(s)}</strong><button data-toggle="${e}"><ha-icon icon="mdi:power"></ha-icon></button></div><small>${unavailable(s) ? 'Nicht verfügbar' : on ? 'Ein' : 'Aus'}</small>${config.controls?.brightness === false ? '' : `<label class="slider"><ha-icon icon="mdi:brightness-6"></ha-icon><input data-br="${e}" type="range" min="1" max="255" value="${Math.max(1, br)}"><em>${pct}%</em></label>`}${hasTemp ? `<label class="slider temp"><ha-icon icon="mdi:thermometer-lines"></ha-icon><input data-temp="${e}" type="range" min="${minK}" max="${maxK}" value="${valK}"><em>${valK}K</em></label>` : ''}</div>`;
    }).join('') : '<p>Keine Casambi-Lichter gefunden. Bitte Network Config Sensor oder Discovery-Assistent prüfen.</p>'}</div></section>`;
  }
  css() { return `<style>
.cb{--casambi-accent:#15c8ff;--casambi-accent-2:#1de9b6;--casambi-card-bg:linear-gradient(145deg,#101827,#172437);--casambi-panel:rgba(255,255,255,.08);--casambi-panel-2:rgba(255,255,255,.13);--casambi-text:var(--primary-text-color,#f8fafc);--casambi-muted:var(--secondary-text-color,#a8b3c7);--casambi-card-radius:22px;--casambi-tile-radius:18px;--casambi-glow:0 0 22px rgba(21,200,255,.3);background:var(--casambi-card-bg);color:var(--casambi-text);border-radius:var(--casambi-card-radius);overflow:hidden;padding:18px;border:1px solid rgba(255,255,255,.12);box-shadow:var(--casambi-glow)}
.preset-casambi-native{--casambi-card-bg:linear-gradient(145deg,#101827,#172437)}.preset-casambi-neon{--casambi-card-bg:radial-gradient(circle at top left,rgba(0,229,255,.25),transparent 28%),linear-gradient(145deg,#07131f,#102637);--casambi-accent:#00e5ff;--casambi-accent-2:#00ff99;--casambi-glow:0 0 34px rgba(0,229,255,.38)}
.preset-djungle{--casambi-card-bg:radial-gradient(circle at 10% 0%,rgba(51,255,153,.20),transparent 26%),radial-gradient(circle at 85% 10%,rgba(9,95,72,.45),transparent 30%),linear-gradient(145deg,#03140d,#06291b 55%,#02100b);--casambi-accent:#27f58a;--casambi-accent-2:#00c875;--casambi-panel:rgba(39,245,138,.10);--casambi-panel-2:rgba(39,245,138,.18);--casambi-glow:0 0 34px rgba(39,245,138,.23);--casambi-card-radius:28px;--casambi-tile-radius:22px}
.preset-cyberpunk-blue{--casambi-card-bg:radial-gradient(circle at top right,rgba(0,229,255,.22),transparent 30%),linear-gradient(145deg,#050914,#0b1028);--casambi-accent:#00e5ff;--casambi-accent-2:#ff2bd6;--casambi-panel:rgba(0,229,255,.10);--casambi-panel-2:rgba(255,43,214,.14);--casambi-glow:0 0 38px rgba(0,229,255,.30)}
.preset-cyberpunk-purple{--casambi-card-bg:radial-gradient(circle at top left,rgba(176,38,255,.28),transparent 30%),linear-gradient(145deg,#12001f,#21063a 58%,#07000f);--casambi-accent:#b026ff;--casambi-accent-2:#ffcc00;--casambi-panel:rgba(176,38,255,.12);--casambi-panel-2:rgba(255,204,0,.14);--casambi-glow:0 0 36px rgba(176,38,255,.30)}
.preset-space-opera{--casambi-card-bg:radial-gradient(circle at 50% 0%,rgba(120,170,255,.20),transparent 32%),linear-gradient(145deg,#070b16,#111827 60%,#05070d);--casambi-accent:#7dd3fc;--casambi-accent-2:#facc15;--casambi-panel:rgba(125,211,252,.10);--casambi-panel-2:rgba(250,204,21,.12);--casambi-glow:0 0 40px rgba(125,211,252,.22)}
.preset-retro-lcars{--casambi-card-bg:linear-gradient(145deg,#050505,#111018);--casambi-accent:#ff9f55;--casambi-accent-2:#c084fc;--casambi-panel:rgba(255,159,85,.16);--casambi-panel-2:rgba(192,132,252,.18);--casambi-card-radius:30px;--casambi-tile-radius:26px;--casambi-glow:none}.preset-retro-lcars .logo,.preset-retro-lcars .scenes button,.preset-retro-lcars .stats b,.preset-retro-lcars .tile{border-radius:26px 8px 26px 8px}
.preset-mushroom-soft{--casambi-card-bg:var(--ha-card-background,var(--card-background-color));--casambi-panel:rgba(127,127,127,.11);--casambi-text:var(--primary-text-color);--casambi-muted:var(--secondary-text-color);--casambi-card-radius:18px;--casambi-glow:none}.preset-mushroom-dark{--casambi-card-bg:linear-gradient(145deg,#1b1f24,#111418);--casambi-panel:rgba(255,255,255,.07);--casambi-card-radius:18px;--casambi-glow:none}.preset-bubble-compact{--casambi-card-radius:32px;--casambi-tile-radius:24px;--casambi-accent:#03a9f4;--casambi-accent-2:#00e5ff}.preset-bubble-glass{--casambi-card-bg:linear-gradient(145deg,rgba(18,35,55,.72),rgba(12,18,30,.82));--casambi-panel:rgba(255,255,255,.12);--casambi-card-radius:32px;backdrop-filter:blur(12px);--casambi-glow:0 12px 42px rgba(0,0,0,.28)}.preset-minimal{--casambi-card-bg:var(--ha-card-background,var(--card-background-color));--casambi-panel:transparent;--casambi-panel-2:rgba(127,127,127,.1);--casambi-glow:none;border-color:var(--divider-color)}
.head{display:flex;justify-content:space-between;gap:12px}.brand{display:flex;gap:12px;align-items:center}.logo{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--casambi-accent),var(--casambi-accent-2));color:#03202d;font-weight:900}.title{font-weight:800;font-size:18px}.sub,footer,small,p{color:var(--casambi-muted);font-size:12px}.state{padding:8px 10px;border-radius:999px;background:var(--casambi-panel);height:max-content}.state i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#ef5350}.state.on i{background:var(--casambi-accent-2);box-shadow:0 0 10px var(--casambi-accent-2)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.stats b{background:var(--casambi-panel);border-radius:16px;padding:10px;text-align:center}.stats span{display:block;font-weight:400;color:var(--casambi-muted);font-size:11px}.section h3{font-size:14px;display:flex;gap:8px;align-items:center}.scenes{display:flex;gap:9px;flex-wrap:wrap}.scenes button{border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:10px 13px;background:var(--casambi-panel);color:inherit;display:flex;gap:8px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}.tile{background:var(--casambi-panel);border-radius:var(--casambi-tile-radius);padding:12px}.tile.on{background:linear-gradient(145deg,var(--casambi-panel-2),rgba(29,233,182,.08))}.tile.unav{opacity:.55}.tile-head{display:flex;justify-content:space-between;gap:8px}.tile strong{min-width:0;overflow:hidden;text-overflow:ellipsis}.tile button{border:0;border-radius:13px;background:var(--casambi-panel-2);color:inherit;width:36px;height:36px}.slider{display:grid;grid-template-columns:22px 1fr 54px;gap:8px;align-items:center;margin-top:10px}.slider input{width:100%;accent-color:var(--casambi-accent)}.slider em{text-align:right;font-style:normal;font-size:12px}.layout-wide .body{display:grid;grid-template-columns:1fr 1.4fr;gap:16px}.layout-compact .stats{grid-template-columns:repeat(2,1fr)}.layout-compact .grid{grid-template-columns:1fr}footer{display:flex;justify-content:space-between;gap:10px;margin-top:14px}@media(max-width:620px){.layout-wide .body{display:block}.stats{grid-template-columns:repeat(2,1fr)}}
</style>`; }
}

class CasambiBtCardEditor extends HTMLElement {
  setConfig(config) { this._config = { auto_discover: false, preset: 'djungle', layout: 'default', discovery: { strict_casambi_matching: true, prefer_available: true, hide_unavailable_duplicates: true, show_rejected_candidates: true, exclude_sources: DEFAULT_EXCLUDE }, ...(config || {}) }; this._rendered = false; this.render(); }
  set hass(hass) { this._hass = hass; if (!this._rendered) this.render(); else this.updatePickers(); }
  updatePickers() { ['status','networkConfig'].forEach((id) => { const p = this.querySelector('#' + id); if (p) p.hass = this._hass; }); }
  emit() { fire(this, 'config-changed', { config: this._config }); }
  chg(k, v) { this._config = { ...this._config, [k]: v }; this.emit(); this.render(); }
  setDiscovery(k, v) { this._config = { ...this._config, discovery: { ...(this._config.discovery || {}), [k]: v } }; this.emit(); this.render(); }
  setControls(k, v) { this._config = { ...this._config, controls: { ...(this._config.controls || {}), [k]: v } }; this.emit(); this.render(); }
  autoBest(onlyAvailable = false) { this._config = { ...this._config, lights: selectedBest(this._hass, this._config, 'light', onlyAvailable), scenes: selectedBest(this._hass, this._config, 'scene', onlyAvailable), discovery_collapsed: true }; this.emit(); this.render(); }
  cleanSelection() { this._config = { ...this._config, lights: normList(this._config.lights).filter((e) => isAllowedManual(this._hass, this._config, 'light', e)), scenes: normList(this._config.scenes).filter((e) => isAllowedManual(this._hass, this._config, 'scene', e)) }; this.emit(); this.render(); }
  applySelection() { const lights = [...this.querySelectorAll('input[data-kind="light"]:checked')].map((x) => x.value); const scenes = [...this.querySelectorAll('input[data-kind="scene"]:checked')].map((x) => x.value); this._config = { ...this._config, lights, scenes, discovery_collapsed: true }; this.emit(); this.render(); }
  candHtml(type) {
    const all = candidatesFor(this._hass, this._config, type);
    const selected = new Set(normList(this._config[type === 'light' ? 'lights' : 'scenes']).filter((e) => isAllowedManual(this._hass, this._config, type, e)));
    const hideRejected = this._config.discovery?.show_rejected_candidates === false;
    const list = hideRejected ? all.filter((x) => !(this._config.discovery?.exclude_sources || DEFAULT_EXCLUDE).includes(x.source)) : all;
    if (!list.length) return '<p class="hint">Keine Kandidaten gefunden. Bitte Network Config Sensor setzen.</p>';
    return list.map((x) => {
      const excluded = (this._config.discovery?.exclude_sources || DEFAULT_EXCLUDE).includes(x.source) || (this._config.discovery?.strict_casambi_matching !== false && !x.raw_match);
      const recommended = x.score >= 90 && x.available && !excluded && x.raw_match;
      const checked = selected.has(x.entity_id) || (!selected.size && recommended);
      return `<label class="cand ${x.available ? 'ok' : 'bad'} ${recommended ? 'rec' : ''} ${excluded ? 'rej' : ''}"><input type="checkbox" data-kind="${type}" value="${x.entity_id}" ${checked ? 'checked' : ''} ${excluded ? '' : ''}><span><b>${x.name}</b><code>${x.entity_id}</code><small><mark>${recommended ? 'Empfohlen' : excluded ? 'Nicht empfohlen' : 'Kandidat'}</mark> ${SOURCE_LABELS[x.source] || x.source} · ${x.raw_match ? 'RAW Match' : 'Name only'} · Score ${x.score} · ${x.available ? 'verfügbar' : 'unavailable'} · ${x.reason}</small></span></label>`;
    }).join('');
  }
  cardModExamples() { return `# card_mod examples\n\ncard_mod:\n  style: |\n    ha-card {\n      --casambi-accent: #00e5ff;\n      --casambi-accent-2: #00ff99;\n      --casambi-card-radius: 28px;\n      --casambi-glow: 0 0 28px rgba(0,229,255,.45);\n    }`; }
  render() {
    if (!this._hass || !this._config) return;
    const c = this._config;
    const d = c.discovery || {};
    const controls = c.controls || {};
    const summary = `<div class="summary"><b>Ausgewählt:</b> ${selectedBest(this._hass, c, 'light').length} Licht(er), ${selectedBest(this._hass, c, 'scene').length} Casambi-Szene(n) <button id="openDiscovery">Discovery erneut öffnen</button></div>`;
    const discovery = c.discovery_collapsed ? summary : `<div class="box"><b>Discovery-Assistent</b><label><input id="strict" type="checkbox" ${d.strict_casambi_matching !== false ? 'checked' : ''}> Strict RAW Casambi Matching aktivieren</label><label><input id="pref" type="checkbox" ${d.prefer_available !== false ? 'checked' : ''}> verfügbare Entities bevorzugen</label><label><input id="hide" type="checkbox" ${d.hide_unavailable_duplicates !== false ? 'checked' : ''}> unavailable Dubletten ausblenden</label><label><input id="showrej" type="checkbox" ${d.show_rejected_candidates !== false ? 'checked' : ''}> auch nicht empfohlene Kandidaten anzeigen</label><div class="actions"><button id="autoBest">Empfohlene auswählen</button><button id="autoAvail">Nur verfügbare auswählen</button><button id="applySel">Auswahl übernehmen</button><button id="cleanSel">Fremde manuelle Einträge entfernen</button></div><b>Licht-Kandidaten</b>${this.candHtml('light')}<b>Szenen-Kandidaten</b>${this.candHtml('scene')}</div>`;
    this.innerHTML = `<div class="ed"><style>.ed{display:grid;gap:14px}.row{display:grid;gap:6px}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid var(--divider-color);border-radius:10px;padding:9px;background:var(--card-background-color);color:var(--primary-text-color)}textarea{min-height:72px;font-family:monospace}.hint,small{font-size:12px;color:var(--secondary-text-color)}.box,.summary{border:1px solid var(--divider-color);border-radius:14px;padding:10px;display:grid;gap:8px}.cand{display:grid;grid-template-columns:24px 1fr;gap:8px;padding:8px;border-radius:12px;background:rgba(127,127,127,.1)}.cand.ok{border-left:3px solid #1de9b6}.cand.bad{opacity:.72;border-left:3px solid #ff6b6b}.cand.rec{background:rgba(29,233,182,.08)}.cand.rej{opacity:.48}.cand b,.cand code,.cand small{display:block}.cand code{font-size:11px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cand mark{border-radius:999px;padding:2px 6px;background:rgba(3,169,244,.18);color:inherit}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button,.summary button{border:0;border-radius:12px;padding:9px 12px;background:#03a9f4;color:white;font-weight:700}.codebox{font-size:11px;white-space:pre;overflow:auto;background:rgba(127,127,127,.12);border-radius:12px;padding:10px}</style><div class="row"><label>Titel</label><input id="title" value="${c.title || 'Casambi'}"></div><div class="row"><label>Design Preset</label><select id="preset">${PRESET_OPTIONS.map((p) => `<option value="${p}" ${c.preset === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div class="row"><label>Layout</label><select id="layout">${LAYOUT_OPTIONS.map((p) => `<option value="${p}" ${c.layout === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div class="row"><label>Status Entity optional</label><ha-entity-picker id="status" value="${c.status_entity || ''}" allow-custom-entity></ha-entity-picker></div><div class="row"><label>Network Config Sensor empfohlen</label><ha-entity-picker id="networkConfig" value="${c.network_config_entity || ''}" allow-custom-entity></ha-entity-picker><div class="hint">Empfohlen: sensor.kalli_network_configuration. Strict RAW Matching entfernt Hue-/Büro-Szenen.</div></div><div class="box"><b>Controls</b><label><input id="brightness" type="checkbox" ${controls.brightness !== false ? 'checked' : ''}> Helligkeits-Slider anzeigen</label><label><input id="temp" type="checkbox" ${controls.color_temp !== false ? 'checked' : ''}> Farbtemperatur automatisch anzeigen</label></div>${discovery}<div class="row"><label>Lichter manuell</label><textarea id="lights" placeholder="Leer lassen für Auto-Erkennung">${normList(c.lights).join('\n')}</textarea></div><div class="row"><label>Szenen manuell</label><textarea id="scenes" placeholder="Leer lassen für Auto-Erkennung">${normList(c.scenes).join('\n')}</textarea></div><details><summary>card_mod Beispiele</summary><div class="codebox">${this.cardModExamples().replace(/</g,'&lt;')}</div></details></div>`;
    this.updatePickers();
    this.querySelector('#title').onchange = (e) => this.chg('title', e.target.value);
    this.querySelector('#preset').onchange = (e) => this.chg('preset', e.target.value);
    this.querySelector('#layout').onchange = (e) => this.chg('layout', e.target.value);
    this.querySelector('#status').addEventListener('value-changed', (e) => this.chg('status_entity', e.detail.value));
    this.querySelector('#networkConfig').addEventListener('value-changed', (e) => this.chg('network_config_entity', e.detail.value));
    this.querySelector('#brightness').onchange = (e) => this.setControls('brightness', e.target.checked);
    this.querySelector('#temp').onchange = (e) => this.setControls('color_temp', e.target.checked ? 'auto' : false);
    const open = this.querySelector('#openDiscovery'); if (open) open.onclick = () => this.chg('discovery_collapsed', false);
    const strict = this.querySelector('#strict'); if (strict) strict.onchange = (e) => this.setDiscovery('strict_casambi_matching', e.target.checked);
    const pref = this.querySelector('#pref'); if (pref) pref.onchange = (e) => this.setDiscovery('prefer_available', e.target.checked);
    const hide = this.querySelector('#hide'); if (hide) hide.onchange = (e) => this.setDiscovery('hide_unavailable_duplicates', e.target.checked);
    const showrej = this.querySelector('#showrej'); if (showrej) showrej.onchange = (e) => this.setDiscovery('show_rejected_candidates', e.target.checked);
    const autoBest = this.querySelector('#autoBest'); if (autoBest) autoBest.onclick = () => this.autoBest(false);
    const autoAvail = this.querySelector('#autoAvail'); if (autoAvail) autoAvail.onclick = () => this.autoBest(true);
    const applySel = this.querySelector('#applySel'); if (applySel) applySel.onclick = () => this.applySelection();
    const cleanSel = this.querySelector('#cleanSel'); if (cleanSel) cleanSel.onclick = () => this.cleanSelection();
    this.querySelector('#lights').onchange = (e) => this.chg('lights', normList(e.target.value));
    this.querySelector('#scenes').onchange = (e) => this.chg('scenes', normList(e.target.value));
    this._rendered = true;
  }
}
customElements.define(CARD_TAG, CasambiBtCard);
customElements.define(EDITOR_TAG, CasambiBtCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: CARD_TAG, name: 'Casambi BT Card', description: 'Modern Casambi Bluetooth dashboard card with strict discovery, scenes, lights, presets and card_mod hooks.', preview: true });
console.info(`CASAMBI-BT-CARD ${CARD_VERSION}`);
