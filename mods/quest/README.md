# RiftPulse Quest adapter - alpha 0.1.15

Native Scotland2/Quest adapter for Beat Saber 1.40.8. Includes the BSML main-menu side panel and dashboard preview with Chat/BSR toggles, ASCII-safe labels, and the revised control layout.

The 0.1.8 QMOD now declares its actual Scotland2 dependency set (Beat Saber Hook, BSML, Custom Types, and Paper2) using the versions resolved in qpm.shared.json. The modloader is explicitly Scotland2. The QPM schema versions remain separate from the mod release version.

Preview limitations: module toggles are in-memory only; the pairing button generates a local test code and does not register it with the website/API. The button and status copy explicitly identify this as a local preview. Quest pairing still requires UnityWebRequest POST registration, credential persistence, and claim-status polling against the API. Authentication, persisted settings, live chat, viewer aggregation, BSR queue/request flow, and headset runtime validation remain unfinished.