# RiftPulse Quest adapter — alpha 0.1.19

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). The client creates a persistent installation identity, generates and registers a five-digit pairing code with the RiftPulse production API, checks website claim status, and loads/saves account Chat and BSR module preferences.

The request path introduced in 0.1.18 constructs UnityWebRequest with an explicit method and a raw UTF-8 `UploadHandlerRaw` JSON body. Request construction and HTTP failures now surface a specific diagnostic in the in-game status area.

Pairing still uses the manual CHECK PAIRING STATUS button. Module controls save account preferences only; they do not yet activate live chat, provider events, combined viewer counts, configurable ChatIntegrations command execution, or BSR song-request fulfillment. Headset runtime validation is required before calling this build verified on device.
