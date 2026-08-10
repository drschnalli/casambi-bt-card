# Casambi BT Card v0.1.5

## Highlights

- Strict RAW Casambi Matching filters out Hue/Buero scenes that only match by name.
- New themes: `djungle`, `cyberpunk-blue`, `cyberpunk-purple`, `space-opera`, `retro-lcars`.
- Existing themes: Casambi, Mushroom, Bubble, Minimal.
- Discovery Assistant labels candidates as RAW Match or Name only.
- Button to remove foreign manual entries from existing YAML.
- Optional card_mod CSS variables.

## Minimal config

```yaml
type: custom:casambi-bt-card
title: Casambi
preset: djungle
layout: default
network_config_entity: sensor.kalli_network_configuration
discovery:
  strict_casambi_matching: true
  prefer_available: true
  hide_unavailable_duplicates: true
```

## Presets

- `casambi-native`
- `casambi-neon`
- `djungle`
- `cyberpunk-blue`
- `cyberpunk-purple`
- `space-opera`
- `retro-lcars`
- `mushroom-soft`
- `mushroom-dark`
- `bubble-compact`
- `bubble-glass`
- `minimal`
