# RiftPulse Quest adapter — alpha 0.1.20

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). The client creates a persistent installation identity, generates and registers a five-digit pairing code with the RiftPulse production API at https://app.riftpulse.me, checks website claim status, and loads/saves account Chat and BSR module preferences.

Quest uses UnityWebRequest GET calls with validated HTTPS request headers for pairing registration and module-toggle updates. This avoids the `UploadHandlerRaw` type, which is stripped from the target Quest Unity runtime. The device credential and pairing metadata are sent in headers, never URL query parameters. The API retains its JSON POST/PATCH routes for the web and PCVR clients.

The Quest menu now places pairing information and all four actions in one aligned column. Pairing uses the manual CHECK PAIRING STATUS action after the five-digit code is entered on the website. Module switches persist account preferences; they do not yet activate live chat, provider events, combined viewer counts, configurable ChatIntegrations command execution, or BSR song-request fulfillment. A headset install-and-pair run is still required for final runtime validation by alpha testers.
