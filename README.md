# Casambi BT Card v0.2.5

Adds tuning based on the discovered Casambi Bluetooth entity model.

Preferred entities:
- light.minicontroller_casambi_tw
- binary_sensor.kalli_status
- scene.kalli_an
- scene.kalli_aus
- scene.kalli_testszene

Changes:
- Keeps v0.2.4 segmented LCARS dimmer bars.
- Discovery documentation aligned with Casambi Bluetooth Revamped.
- RAW discovery remains the preferred source.
- Strict mode remains optimized for scene.kalli_* style entities.
