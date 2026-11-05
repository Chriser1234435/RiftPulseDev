# RiftPulse Quest adapter — alpha 0.1.21

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). This alpha generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and after linking loads and saves the account's Chat and BSR module preferences.

Fix in 0.1.21: removed the `Accept: application/json` request header that UnityWebRequest rejects in this Quest runtime. The API responds with JSON by default. Quest requests use UnityWebRequest HTTPS with validated pairing/device headers. Device credentials and pairing metadata are sent in headers, never URL query parameters.

Pairing status is checked manually using CHECK PAIRING STATUS after entering the code on https://app.riftpulse.me. The Quest menu's pairing information and action buttons are arranged in one aligned column.

This is an alpha candidate. Headset installation, menu layout, pairing and preference-save runtime validation remain for testers. Module switches persist preferences only; actual live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.
