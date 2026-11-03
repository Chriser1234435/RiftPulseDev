#include "main.hpp"
#include "scotland2/shared/modloader.h"

static modloader::ModInfo modInfo{MOD_ID, VERSION, 0};

Configuration &getConfig() {
  static Configuration config(modInfo);
  return config;
}

MOD_EXTERN_FUNC void setup(CModInfo *info) noexcept {
  *info = modInfo.to_c();
  getConfig().Load();
  Paper::Logger::RegisterFileContextId(PaperLogger.tag);
  PaperLogger.info("RiftPulse Quest adapter bootstrap loaded. V1 modules: Chat and BSR Song Request.");
}

MOD_EXTERN_FUNC void late_load() noexcept {
  il2cpp_functions::Init();
  PaperLogger.info("RiftPulse Quest adapter initialized. In-game UI and realtime integration are pending.");
}