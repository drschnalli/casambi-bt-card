# Casambi BT Card v0.2.1

Compact LCARS long-bar refinement based on the latest layout sketch.

Changes:

- LCARS bar presets are more compact.
- Statistics are long LCARS command bars.
- Brightness and color-temperature sliders use LCARS-style progress bars.
- v0.2.0 source-group selection and editor hotfixes are retained.

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
