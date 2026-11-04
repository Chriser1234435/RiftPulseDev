#include "main.hpp"
#include "bsml/shared/BSML.hpp"
#include "bsml/shared/BSML-Lite.hpp"
#include "HMUI/CurvedTextMeshPro.hpp"
#include <cstdlib>
#include <string>

static modloader::ModInfo modInfo{MOD_ID, VERSION, 0};
static HMUI::CurvedTextMeshPro* overview = nullptr;
static UnityEngine::UI::Button* codeButton = nullptr;
static int pairingCode = 0;

static void BuildRiftPulseMenu(HMUI::ViewController* viewController,
                               bool firstActivation,
                               bool addedToHierarchy,
                               bool screenSystemEnabling) {
  if (!firstActivation) return;
  auto root = viewController->get_transform();

  // Minimal clean-room layout: remove all competing BSML Lite controls and
  // position only one text panel. Previous controls rendered outside bounds
  // and their labels collided with the parent view.
  overview = BSML::Lite::CreateText(
      root,
      "RIFTPULSE\n"
      "STREAM TOOLS FOR BEAT SABER\n\n"
      "PAIRING STATUS: LOCAL PREVIEW ONLY\n\n"
      "CHAT: DISABLED   |   BSR: DISABLED\n\n"
      "PAIRING: CODE IS NOT SENT TO API\n"
      "ACCOUNT CONNECTION NOT ENABLED",
      3.3f, {0.0f, 5.0f}, {58.0f, 26.0f});

  codeButton = BSML::Lite::CreateUIButton(
      root, "GENERATE LOCAL PREVIEW CODE", "PracticeButton",
      UnityEngine::Vector2({0.0f, -9.0f}), UnityEngine::Vector2({34.0f, 8.0f}),
      []() {
        pairingCode = (std::rand() % 90000) + 10000;
        BSML::Lite::SetButtonText(codeButton, std::to_string(pairingCode));
      });
}

MOD_EXTERN_FUNC void setup(CModInfo *info) noexcept {
  *info = modInfo.to_c();
}

MOD_EXTERN_FUNC void late_load() noexcept {
  BSML::Init();
  BSML::LateInit();
  BSML::Register::RegisterMainMenuViewControllerMethod(
      "RiftPulse", "RiftPulse", "Open RiftPulse preview",
      BuildRiftPulseMenu);
}
