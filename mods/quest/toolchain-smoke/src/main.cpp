#include <android/log.h>

extern "C" __attribute__((visibility("default"))) int riftpulse_quest_toolchain_smoke() {
    __android_log_print(ANDROID_LOG_INFO, "RiftPulseDev", "Quest native toolchain smoke test");
    return 1;
}
