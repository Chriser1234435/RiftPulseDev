# RiftPulse Quest adapter — alpha 0.1.20

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). This alpha generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and after linking loads and saves the account's Chat and BSR module preferences.

Quest uses UnityWebRequest HTTPS calls with validated request headers for pairing registration and module-toggle saves. This avoids the `UploadHandlerRaw` class, which is stripped from the Quest Unity runtime. Device credentials and pairing metadata are sent in headers, never URL query parameters. The API keeps JSON POST/PATCH routes for web and PCVR clients.

Pairing status is checked manually using CHECK PAIRING STATUS after entering the code on https://app.riftpulse.me. The Quest menu's pairing information and action buttons are arranged in one aligned column.

This is an alpha candidate. Headset installation, menu layout, pairing and preference-save runtime validation remain for testers. Module switches persist preferences only; actual live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.
