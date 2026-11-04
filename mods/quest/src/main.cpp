#include "main.hpp"
#include "bsml/shared/BSML.hpp"
#include "bsml/shared/BSML-Lite.hpp"
#include "HMUI/CurvedTextMeshPro.hpp"
#include "UnityEngine/Application.hpp"
#include "UnityEngine/AsyncOperation.hpp"
#include "UnityEngine/Networking/UnityWebRequest.hpp"
#include "UnityEngine/Networking/UnityWebRequestAsyncOperation.hpp"
#include "UnityEngine/Networking/DownloadHandlerBuffer.hpp"
#include "System/Action_1.hpp"
#include "custom-types/shared/delegate.hpp"
#include "beatsaber-hook/shared/utils/il2cpp-utils.hpp"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <string>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

using UnityEngine::Networking::UnityWebRequest;
using UnityEngine::Networking::DownloadHandlerBuffer;
using UnityEngine::Networking::DownloadHandler;
using UnityEngine::AsyncOperation;

static modloader::ModInfo modInfo{MOD_ID, VERSION, 0};
static constexpr const char* API_BASE = "https://riftpulse-dev.chrismeten0.workers.dev/api/v1";
static constexpr const char* GAME_VERSION = "1.40.8_7379";
static constexpr const char* MOD_VERSION = "0.1.17";

static HMUI::CurvedTextMeshPro* overview = nullptr;
static UnityEngine::UI::Button* codeButton = nullptr;
static UnityEngine::UI::Button* checkButton = nullptr;
static UnityEngine::UI::Button* chatButton = nullptr;
static UnityEngine::UI::Button* bsrButton = nullptr;

static std::string deviceId;
static std::string deviceCredential;
static std::string challengeId;
static bool requestInFlight = false;
static bool isPaired = false;
static bool chatEnabled = true;
static bool bsrEnabled = true;

static void SetStatus(const std::string& text) {
  if (overview) overview->set_text(StringW(text));
}

static bool RandomBytes(uint8_t* destination, size_t length) {
  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return false;
  size_t offset = 0;
  while (offset < length) {
    const auto count = read(fd, destination + offset, length - offset);
    if (count <= 0) {
      close(fd);
      return false;
    }
    offset += static_cast<size_t>(count);
  }
  close(fd);
  return true;
}

static std::string Hex(const uint8_t* bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    result.push_back(digits[bytes[i] >> 4]);
    result.push_back(digits[bytes[i] & 0x0f]);
  }
  return result;
}

static std::string MakeUuid() {
  uint8_t bytes[16]{};
  if (!RandomBytes(bytes, sizeof(bytes))) return {};
  bytes[6] = static_cast<uint8_t>((bytes[6] & 0x0f) | 0x40);
  bytes[8] = static_cast<uint8_t>((bytes[8] & 0x3f) | 0x80);
  const auto h = Hex(bytes, sizeof(bytes));
  return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" +
         h.substr(16, 4) + "-" + h.substr(20, 12);
}

static std::string MakePairingCode() {
  uint8_t bytes[4]{};
  if (!RandomBytes(bytes, sizeof(bytes))) return {};
  const uint32_t value = (static_cast<uint32_t>(bytes[0]) << 24) |
                         (static_cast<uint32_t>(bytes[1]) << 16) |
                         (static_cast<uint32_t>(bytes[2]) << 8) |
                         static_cast<uint32_t>(bytes[3]);
  return std::to_string((value % 90000U) + 10000U);
}

static bool LoadOrCreateIdentity() {
  const std::string dataDir = static_cast<std::string>(UnityEngine::Application::get_persistentDataPath());
  if (dataDir.empty()) return false;
  const std::string path = dataDir + "/riftpulse-device-identity.dat";

  {
    std::ifstream input(path);
    std::string savedId;
    std::string savedCredential;
    if (input >> savedId >> savedCredential) {
      if (savedId.size() == 36 && savedCredential.size() == 64) {
        deviceId = savedId;
        deviceCredential = savedCredential;
        return true;
      }
    }
  }

  deviceId = MakeUuid();
  uint8_t secret[32]{};
  if (deviceId.empty() || !RandomBytes(secret, sizeof(secret))) return false;
  deviceCredential = Hex(secret, sizeof(secret));

  const std::string temporaryPath = path + ".tmp";
  {
    std::ofstream output(temporaryPath, std::ios::binary | std::ios::trunc);
    if (!output) return false;
    output << deviceId << "\n" << deviceCredential << "\n";
    output.flush();
    if (!output.good()) return false;
  }
  chmod(temporaryPath.c_str(), S_IRUSR | S_IWUSR);
  if (rename(temporaryPath.c_str(), path.c_str()) != 0) {
    unlink(temporaryPath.c_str());
    return false;
  }
  chmod(path.c_str(), S_IRUSR | S_IWUSR);
  return true;
}

static const MethodInfo* FindRequestMethod(const char* name,
                                           std::array<const Il2CppType*, 2> argumentTypes) {
  return il2cpp_utils::FindMethod(
      il2cpp_utils::il2cpp_type_check::il2cpp_no_arg_class<UnityWebRequest*>::get(),
      name, std::array<Il2CppClass*, 0>{}, argumentTypes);
}

static bool SetRequestHeader(UnityWebRequest* request,
                             const std::string& name,
                             const std::string& value) {
  try {
    const auto* method = FindRequestMethod(
        "SetRequestHeader",
        {il2cpp_utils::il2cpp_type_check::il2cpp_no_arg_type<StringW>::get(),
         il2cpp_utils::il2cpp_type_check::il2cpp_no_arg_type<StringW>::get()});
    if (!method) return false;
    cordl_internals::RunMethodRethrow<void, false>(
        request, method, StringW(name), StringW(value));
    return true;
  } catch (...) {
    return false;
  }
}

static UnityWebRequest* CreateGetRequest(const std::string& url,
                                         const std::string& credential = {}) {
  auto* request = UnityWebRequest::Get(StringW(url));
  if (!request) return nullptr;
  request->set_downloadHandler(DownloadHandlerBuffer::New_ctor());
  SetRequestHeader(request, "Accept", "application/json");
  if (!credential.empty() &&
      !SetRequestHeader(request, "Authorization", "Bearer " + credential)) {
    request->Dispose();
    return nullptr;
  }
  return request;
}

static UnityWebRequest* CreateJsonRequest(const std::string& url,
                                          const std::string& methodName,
                                          const std::string& body,
                                          const std::string& credential = {}) {
  try {
    const auto* postMethod = FindRequestMethod(
        "Post",
        {il2cpp_utils::il2cpp_type_check::il2cpp_no_arg_type<StringW>::get(),
         il2cpp_utils::il2cpp_type_check::il2cpp_no_arg_type<StringW>::get()});
    if (!postMethod) return nullptr;
    auto* request = cordl_internals::RunMethodRethrow<UnityWebRequest*, false>(
        nullptr, postMethod, StringW(url), StringW(body));
    if (!request) return nullptr;

    if (methodName != "POST") request->SetCustomMethod(StringW(methodName));
    request->set_downloadHandler(DownloadHandlerBuffer::New_ctor());
    if (!SetRequestHeader(request, "Content-Type", "application/json") ||
        !SetRequestHeader(request, "Accept", "application/json")) {
      request->Dispose();
      return nullptr;
    }
    if (!credential.empty() &&
        !SetRequestHeader(request, "Authorization", "Bearer " + credential)) {
      request->Dispose();
      return nullptr;
    }
    return request;
  } catch (...) {
    return nullptr;
  }
}

static std::string GetResponseText(DownloadHandler* handler) {
  if (!handler) return {};
  return static_cast<std::string>(handler->get_text());
}

static std::string JsonString(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  auto position = json.find(marker);
  if (position == std::string::npos) return {};
  position = json.find(':', position + marker.size());
  if (position == std::string::npos) return {};
  position = json.find('\"', position + 1);
  if (position == std::string::npos) return {};
  const auto end = json.find('\"', position + 1);
  if (end == std::string::npos) return {};
  return json.substr(position + 1, end - position - 1);
}

static bool JsonModuleEnabled(const std::string& json, const std::string& module,
                              bool fallback) {
  const std::string marker = "\"" + module + "\"";
  auto position = json.find(marker);
  if (position == std::string::npos) return fallback;
  const auto end = json.find('}', position);
  const auto enabled = json.find("\"enabled\"", position);
  if (enabled == std::string::npos || (end != std::string::npos && enabled > end)) return fallback;
  const auto colon = json.find(':', enabled);
  if (colon == std::string::npos) return fallback;
  const auto value = json.find_first_not_of(" \t\r\n", colon + 1);
  if (value == std::string::npos) return fallback;
  if (json.compare(value, 4, "true") == 0) return true;
  if (json.compare(value, 5, "false") == 0) return false;
  return fallback;
}

using RequestCompletion = std::function<void(int64_t, const std::string&)>;

static bool SendAsync(UnityWebRequest* request, RequestCompletion completion) {
  if (!request) return false;
  auto* downloadHandler = request->get_downloadHandler();
  auto* operation = request->SendWebRequest();
  if (!operation) {
    request->Dispose();
    return false;
  }

  using CompletionDelegate = System::Action_1<AsyncOperation*>*;
  auto callback = custom_types::MakeDelegate<CompletionDelegate>(
      std::function<void(AsyncOperation*)>(
          [request, downloadHandler, completion](AsyncOperation*) {
            const int64_t responseCode = request->get_responseCode();
            const std::string responseBody = GetResponseText(downloadHandler);
            request->Dispose();
            if (completion) completion(responseCode, responseBody);
          }));
  operation->add_completed(callback);
  return true;
}

static void RefreshModuleButtons() {
  if (chatButton) {
    BSML::Lite::SetButtonText(chatButton,
        chatEnabled ? "CHAT MODULE: ON" : "CHAT MODULE: OFF");
  }
  if (bsrButton) {
    BSML::Lite::SetButtonText(bsrButton,
        bsrEnabled ? "BSR MODULE: ON" : "BSR MODULE: OFF");
  }
}

static void LoadModuleSettings() {
  auto* request = CreateGetRequest(
      std::string(API_BASE) + "/device/settings/modules", deviceCredential);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        if (status < 200 || status >= 300) {
          SetStatus("Account linked. Could not load module settings (HTTP " +
                    std::to_string(status) + ").");
          return;
        }
        chatEnabled = JsonModuleEnabled(body, "chat", true);
        bsrEnabled = JsonModuleEnabled(body, "bsr-song-request", true);
        RefreshModuleButtons();
        SetStatus("RIFTPULSE ACCOUNT LINKED\n\nCHAT AND BSR SETTINGS LOADED\n\nUse the module buttons to save changes.");
      })) {
    SetStatus("Account linked, but the settings request could not start.");
  }
}

static void SaveModuleSetting(const std::string& module, bool enabled) {
  if (!isPaired || requestInFlight) return;
  requestInFlight = true;
  const std::string body = std::string("{\"enabled\":") +
                           (enabled ? "true" : "false") + "}";
  auto* request = CreateJsonRequest(
      std::string(API_BASE) + "/device/settings/modules/" + module,
      "PATCH", body, deviceCredential);
  if (!request || !SendAsync(request, [module, enabled](int64_t status, const std::string&) {
        requestInFlight = false;
        if (status < 200 || status >= 300) {
          SetStatus("Could not save " + module + " settings (HTTP " +
                    std::to_string(status) + ").");
          if (module == "chat") chatEnabled = !enabled;
          if (module == "bsr-song-request") bsrEnabled = !enabled;
          RefreshModuleButtons();
          return;
        }
        SetStatus("Module setting saved to your RiftPulse account.");
        RefreshModuleButtons();
      })) {
    requestInFlight = false;
    SetStatus("Could not start the module settings request.");
  }
}

static void ToggleChat() {
  if (!isPaired) {
    SetStatus("Link this installation to your RiftPulse account first.");
    return;
  }
  chatEnabled = !chatEnabled;
  RefreshModuleButtons();
  SaveModuleSetting("chat", chatEnabled);
}

static void ToggleBsr() {
  if (!isPaired) {
    SetStatus("Link this installation to your RiftPulse account first.");
    return;
  }
  bsrEnabled = !bsrEnabled;
  RefreshModuleButtons();
  SaveModuleSetting("bsr-song-request", bsrEnabled);
}

static void CheckPairingStatus() {
  if (challengeId.empty() || requestInFlight) return;
  requestInFlight = true;
  SetStatus("Checking whether the website has linked this installation...");
  auto* request = CreateGetRequest(
      std::string(API_BASE) + "/pairing/challenges/" + challengeId);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        requestInFlight = false;
        if (status < 200 || status >= 300) {
          SetStatus("Pairing check failed (HTTP " + std::to_string(status) + ").");
          return;
        }
        const auto state = JsonString(body, "status");
        if (state == "claimed") {
          isPaired = true;
          if (checkButton) BSML::Lite::SetButtonText(checkButton, "ACCOUNT LINKED");
          SetStatus("ACCOUNT LINK CONFIRMED\n\nLoading your Chat and BSR settings...");
          LoadModuleSettings();
        } else if (state == "expired" || state == "revoked") {
          challengeId.clear();
          SetStatus("This pairing code expired. Generate a new code to try again.");
        } else if (state == "pending") {
          SetStatus("Waiting for website confirmation. Enter the five-digit code on RiftPulse, then check again.");
        } else {
          SetStatus("RiftPulse returned an unknown pairing status. Try checking again.");
        }
      })) {
    requestInFlight = false;
    SetStatus("Could not start the pairing status request.");
  }
}

static void GeneratePairingCode() {
  if (requestInFlight) return;
  requestInFlight = true;
  challengeId.clear();
  isPaired = false;
  if (checkButton) BSML::Lite::SetButtonText(checkButton, "CHECK PAIRING STATUS");
  if (chatButton) BSML::Lite::SetButtonText(chatButton, "CHAT MODULE: LOCKED");
  if (bsrButton) BSML::Lite::SetButtonText(bsrButton, "BSR MODULE: LOCKED");

  if (!LoadOrCreateIdentity()) {
    requestInFlight = false;
    SetStatus("Could not securely create this installation identity. Check Quest storage permissions.");
    return;
  }

  const std::string code = MakePairingCode();
  if (code.empty()) {
    requestInFlight = false;
    SetStatus("Secure random number generation failed. Please restart Beat Saber and try again.");
    return;
  }
  if (codeButton) BSML::Lite::SetButtonText(codeButton, code);
  SetStatus("Registering your five-digit code with RiftPulse...");

  const std::string body =
      "{\"code\":\"" + code +
      "\",\"deviceCredential\":\"" + deviceCredential +
      "\",\"deviceId\":\"" + deviceId +
      "\",\"platform\":\"quest\",\"gameVersion\":\"" +
      GAME_VERSION + "\",\"modVersion\":\"" + MOD_VERSION + "\"}";

  auto* request = CreateJsonRequest(
      std::string(API_BASE) + "/pairing/challenges", "POST", body);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& response) {
        requestInFlight = false;
        if (status != 201) {
          SetStatus("RiftPulse could not register the code (HTTP " +
                    std::to_string(status) + "). Generate a new code and retry.");
          return;
        }
        challengeId = JsonString(response, "challengeId");
        if (challengeId.empty()) {
          SetStatus("RiftPulse returned an invalid pairing response. Generate a new code and retry.");
          return;
        }
        SetStatus("PAIRING CODE REGISTERED\n\nEnter the five-digit code shown above on the RiftPulse website. Then press CHECK PAIRING STATUS.");
        if (checkButton) BSML::Lite::SetButtonText(checkButton, "CHECK PAIRING STATUS");
      })) {
    requestInFlight = false;
    SetStatus("Could not start the pairing request. Check the Quest internet connection.");
  }
}

static void BuildRiftPulseMenu(HMUI::ViewController* viewController,
                               bool firstActivation,
                               bool addedToHierarchy,
                               bool screenSystemEnabling) {
  if (!firstActivation) return;
  auto root = viewController->get_transform();

  overview = BSML::Lite::CreateText(
      root,
      "RIFTPULSE\nSTREAM TOOLS FOR BEAT SABER\n\nGenerate a secure pairing code to link this Quest installation.",
      2.7f, {0.0f, 9.0f}, {58.0f, 24.0f});

  codeButton = BSML::Lite::CreateUIButton(
      root, "GENERATE PAIRING CODE", "PracticeButton",
      UnityEngine::Vector2({0.0f, -7.0f}), UnityEngine::Vector2({34.0f, 6.5f}),
      []() { GeneratePairingCode(); });

  checkButton = BSML::Lite::CreateUIButton(
      root, "CHECK PAIRING STATUS", "PracticeButton",
      UnityEngine::Vector2({0.0f, -14.0f}), UnityEngine::Vector2({34.0f, 6.5f}),
      []() { CheckPairingStatus(); });

  chatButton = BSML::Lite::CreateUIButton(
      root, "CHAT MODULE: LOCKED", "PracticeButton",
      UnityEngine::Vector2({0.0f, -21.0f}), UnityEngine::Vector2({34.0f, 6.0f}),
      []() { ToggleChat(); });

  bsrButton = BSML::Lite::CreateUIButton(
      root, "BSR MODULE: LOCKED", "PracticeButton",
      UnityEngine::Vector2({0.0f, -27.5f}), UnityEngine::Vector2({34.0f, 6.0f}),
      []() { ToggleBsr(); });
}

MOD_EXTERN_FUNC void setup(CModInfo *info) noexcept {
  *info = modInfo.to_c();
}

MOD_EXTERN_FUNC void late_load() noexcept {
  BSML::Init();
  BSML::LateInit();
  BSML::Register::RegisterMainMenuViewControllerMethod(
      "RiftPulse", "RiftPulse", "Connect Quest to RiftPulse",
      BuildRiftPulseMenu);
}
