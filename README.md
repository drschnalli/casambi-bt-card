# Casambi BT Card v0.2.0

Adds LCARS long command-bar themes while keeping v0.1.9 hotfixes, source group selection, strict discovery and Djungle/Cyberpunk presets.

## LCARS long-bar example

```yaml
type: custom:casambi-bt-card
title: Casambi
preset: lcars-bars
layout: wide
network_config_entity: sensor.kalli_network_configuration
discovery:
  strict_casambi_matching: true
  enabled_sources:
    - raw_network
```

## Multi-source test

```yaml
type: custom:casambi-bt-card
title: Casambi Multi Source Test
preset: djungle
discovery:
  strict_casambi_matching: false
  enabled_sources:
    - raw_network
    - android_bridge
    - jungle
    - name_only
```
