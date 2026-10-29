# RiftPulse API contracts

V1 contract definitions live in `src/v1.ts`. Keep the shared vocabulary stable and version API changes deliberately. Runtime validation is implemented next to the relevant request contracts so the Worker does not trust JSON supplied by clients.

Only V1 modules are in scope: `chat` and `bsr-song-request`.
