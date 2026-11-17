# RiftPulse Quest alpha 0.3.15

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (1.40.8_7379). The Quest menu mirrors the PCVR RiftPulse module flow using Quest-native C++/BSML.

## Floating Chat panel

- A real world-space floating screen, not a HUD overlay, with a visible white controller grab handle.
- X/Y/Z position, width, and height are saved on the headset; the panel stays at the selected placement after leaving/restarting gameplay.
- Chat rows use local timestamp → platform-color square → sender name → message, with bold mixed-case text.
- Follow, membership, gift, bits, Super Chat, donation, like, share, raid, and member events keep their highlighted event labels.
- Chat text scales up at smaller panel sizes and new messages are placed at the bottom.

## Floating BSR queue panel

- Open **RiftPulse → Song Requests → Configure BSR** to set the viewer command, requester cooldown, queue limit, and panel display.
- X/Y/Z position and width/height are saved in Quest app storage. Re-centering keeps the selected panel size.
- The queue is a movable world-space panel with a white controller grab handle, previous/next queue pages, and automatic refresh.
- Select a request and press **YES / Download** to import it into SongCore CustomLevels. Press **NO / Remove** to remove it from the active queue.
- Text, request labels, and controls scale with panel size to remain readable.

## Pairing and modules

The mod generates its own five-digit pairing code, registers the pairing challenge, checks claim status, and loads/saves account Chat and BSR module preferences. Chat and BSR use the device-authenticated RiftPulse API.

## Alpha validation

The Quest native library and QMOD package build successfully. A real headset test is still required for QMOD import, in-game placement, grab-handle behavior, display sliders at minimum/maximum sizes, request approvals/rejections, and BeatSaver installation into SongCore CustomLevels. Platform availability and live provider events remain dependent on connected provider services.