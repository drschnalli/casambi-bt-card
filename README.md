# Casambi BT Card v0.2.3

Hotfix for source selection: `name_only` can no longer be active while `strict_casambi_matching` is enabled. This prevents Hue scenes from reappearing when the Name/Network Match source is selected by accident.

Recommended Casambi-only YAML:

```yaml
type: custom:casambi-bt-card
title: Casambi
preset: djungle
layout: default
network_config_entity: sensor.kalli_network_configuration
discovery:
  strict_casambi_matching: true
  enabled_sources:
    - raw_network
  prefer_available: true
  hide_unavailable_duplicates: true
  show_rejected_candidates: true
controls:
  brightness: true
  color_temp: auto
```
