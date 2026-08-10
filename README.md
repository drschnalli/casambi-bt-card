# Casambi BT Card v0.2.2

Hotfix for strict scene discovery: scenes in strict RAW mode now require an exact `scene.<network>_<scene>` entity-id match. This prevents Hue scenes such as `scene.buro_kalli_*` from being treated as RAW Casambi scenes just because the name contains the network name.

Keeps v0.2.1 LCARS compact bars, source group selection and robust visual editor.

## Clean YAML for Casambi BT only

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
  prefer_available: true
  hide_unavailable_duplicates: true
controls:
  brightness: true
  color_temp: auto
```
