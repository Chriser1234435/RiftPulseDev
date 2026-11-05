# RiftPulse Quest adapter — alpha 0.1.22

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). This alpha generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and after linking loads and saves the account's Chat and BSR module preferences.

Fix in 0.1.22: corrected the QMOD manifest encoding. The embedded `mod.json` is UTF-8 without a BOM and begins directly with `{`, as expected by QuestPatcher/MBF import. It also includes the previous UnityWebRequest pairing fix removing the rejected `Accept` header.

Pairing status is checked manually using CHECK PAIRING STATUS after entering the code on https://app.riftpulse.me. The Quest menu's pairing information and action buttons are arranged in one aligned column.

This is an alpha candidate. Headset installation, menu layout, pairing and preference-save runtime validation remain for testers. Module switches persist preferences only; actual live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.