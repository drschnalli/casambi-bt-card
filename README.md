# Casambi BT Card

A clean Lovelace custom card for the **Casambi Bluetooth** Home Assistant integration.

This card is intentionally named **Casambi BT Card**, not Casambi Jungle Card. It is made for the `casambi_bt` integration based on the lkempf Casambi Bluetooth project and the revamped fork.

## Features

- Displays Casambi lights in a responsive grid
- Displays Casambi scenes as compact scene chips
- Toggle each light directly
- Adjust brightness directly from the card
- Optional online/offline status indicator
- Optional auto-discovery from entity names and the Casambi network configuration sensor
- Visual Editor support
- Built-in styles:
  - `casambi`
  - `mushroom`
  - `bubble`
  - `minimal`
- No Mushroom, Bubble Card, or card_mod dependency required

## Installation with HACS

1. Add this repository as a custom repository in HACS.
2. Select category **Dashboard** / **Frontend**.
3. Install **Casambi BT Card**.
4. Clear browser cache if Home Assistant still serves an older JavaScript version.
5. Add a manual card or use the visual editor.

## Manual Installation

Copy this file:

```text
dist/casambi-bt-card.js
```

to:

```text
/config/www/community/casambi-bt-card/casambi-bt-card.js
```

Then add the resource in Home Assistant:

```yaml
url: /local/community/casambi-bt-card/casambi-bt-card.js
type: module
```

## Basic YAML

```yaml
type: custom:casambi-bt-card
title: Casambi
style: casambi
lights:
  - light.minicontroller_casambi_dim2warm
scenes:
  - scene.an
  - scene.aus
```

## Recommended YAML with status and network config

```yaml
type: custom:casambi-bt-card
title: Casambi
style: casambi
status_entity: binary_sensor.kalli_status
network_config_entity: sensor.kalli_network_configuration
lights:
  - light.minicontroller_casambi_dim2warm
scenes:
  - scene.an
  - scene.aus
```

## Auto-Discovery

Auto-discovery is enabled by default.

The card tries to find entities by:

1. Entity ID or friendly name containing `casambi`
2. Matching light and scene friendly names against the integration's `raw_network_data` network configuration sensor
3. Optional glob filters

Example:

```yaml
type: custom:casambi-bt-card
title: Casambi
auto_discover: true
network_config_entity: sensor.kalli_network_configuration
include:
  light_glob: light.*casambi*
  scene_glob: scene.*
```

Manual entity selection is still recommended for a perfectly curated dashboard.

## Style Options

```yaml
style: casambi
```

```yaml
style: mushroom
```

```yaml
style: bubble
```

```yaml
style: minimal
```

## Configuration Reference

| Option | Type | Default | Description |
|---|---:|---:|---|
| `title` | string | `Casambi` | Header title |
| `style` | string | `casambi` | `casambi`, `mushroom`, `bubble`, or `minimal` |
| `lights` | list | `[]` | Light entities to display |
| `scenes` | list | `[]` | Scene entities to display |
| `status_entity` | entity | optional | Binary sensor or status entity for online badge |
| `network_config_entity` | entity | optional | Sensor with `raw_network_data` attributes from the integration |
| `auto_discover` | boolean | `false` | Try to discover Casambi lights and scenes automatically |
| `show_header` | boolean | `true` | Show header and stats |
| `show_scenes` | boolean | `true` | Show scenes section |
| `show_lights` | boolean | `true` | Show lights section |
| `show_footer` | boolean | `true` | Show footer |
| `scene_highlight_seconds` | number | `8` | Seconds to highlight last activated scene |

## First Release

Version `0.1.1` focuses on a stable, dependency-free baseline:

- Lights
- Scenes
- Status
- Brightness sliders
- Visual Editor
- HACS-ready repository layout

Planned later:

- Better active-scene detection if the integration exposes active scene entities
- Color temperature controls
- RGB controls
- Switch event visualization
- Optional card_mod examples

## v0.1.1

- Fixes entity picker dropdowns closing immediately in the visual editor.
- Auto-discovery is now disabled by default.
- Auto-discovery no longer matches raw network names unless `strict_raw_match: true` is set.
- New optional `light_prefix` and `scene_prefix` filters for strict entity prefixes.

Recommended for Pascal's current Casambi BT setup:

```yaml
type: custom:casambi-bt-card
title: Casambi
style: casambi
status_entity: binary_sensor.kalli_status
network_config_entity: sensor.kalli_network_configuration
lights:
  - light.minicontroller_casambi_tw
scenes:
  - scene.kalli_an
  - scene.kalli_aus
  - scene.kalli_testszene
```
