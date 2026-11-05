# RiftPulse Quest adapter — alpha 0.1.22

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). This alpha generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and after linking loads and saves the account Chat and BSR module preferences.

Fix in 0.1.22: the embedded `mod.json` is now written as UTF-8 without a byte-order mark. QuestPatcher requires the first byte to be the opening `{` of the JSON object; the BOM in 0.1.21 caused the import error at line 1 column 1. The package was checked directly at the byte level.

The 0.1.21 request-header fix is retained: Quest does not send Unity's rejected `Accept` header. Pairing metadata and device credentials are sent in HTTPS headers, not URL query parameters.

Pairing status is checked manually using CHECK PAIRING STATUS after entering the code on https://app.riftpulse.me. The Quest menu keeps pairing information and actions in one aligned column.

This is an alpha candidate. Headset installation, menu layout, pairing and preference-save runtime validation remain for testers. Module switches persist preferences only; actual live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.
