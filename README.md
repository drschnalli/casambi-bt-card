# Casambi BT Card v0.1.4

A Lovelace custom card for the Casambi Bluetooth Home Assistant integration.

## Highlights

- Assisted discovery from the Casambi Network Configuration sensor
- Candidate selection for duplicate entities
- Source badges and recommendation texts
- Presets for Casambi, Mushroom, Bubble and Minimal dashboards
- Layout modes: default, compact, wide, scenes-first, lights-first
- Optional brightness and color temperature controls
- CSS variables designed for optional card_mod styling

## Minimal config

```yaml
type: custom:casambi-bt-card
title: Casambi
preset: casambi-native
layout: default
network_config_entity: sensor.kalli_network_configuration
```

## Recommended config after discovery

```yaml
type: custom:casambi-bt-card
title: Casambi
preset: casambi-neon
layout: default
network_config_entity: sensor.kalli_network_configuration
discovery:
  prefer_available: true
  hide_unavailable_duplicates: true
controls:
  brightness: true
  color_temp: auto
```

## Presets

- `casambi-native`
- `casambi-neon`
- `mushroom-soft`
- `mushroom-dark`
- `bubble-compact`
- `bubble-glass`
- `minimal`

## card_mod

card_mod is optional. The card exposes CSS variables such as:

```css
--casambi-accent
--casambi-accent-2
--casambi-card-bg
--casambi-card-radius
--casambi-tile-radius
--casambi-panel
--casambi-glow
```

See the examples folder for ready-to-copy YAML snippets.
