#include "main.hpp"
#include "bsml/shared/BSML.hpp"
#include "bsml/shared/BSML-Lite.hpp"
#include "HMUI/CurvedTextMeshPro.hpp"
#include "UnityEngine/Application.hpp"
#include "System/Action_1.hpp"
#include "System/Object.hpp"
#include "System/Uri.hpp"
#include "System/Collections/Generic/List_1.hpp"
#include "System/Net/Http/HttpClient.hpp"
#include "System/Net/Http/HttpRequestMessage.hpp"
#include "System/Net/Http/HttpResponseMessage.hpp"
#include "System/Net/Http/HttpMethod.hpp"
#include "System/Net/Http/HttpCompletionOption.hpp"
#include "System/Net/Http/ByteArrayContent.hpp"
#include "System/Net/Http/Headers/HttpRequestHeaders.hpp"
#include "System/Net/Http/Headers/HttpContentHeaders.hpp"
#include "System/Net/Http/Headers/AuthenticationHeaderValue.hpp"
#include "System/Net/Http/Headers/MediaTypeHeaderValue.hpp"
#include "System/Threading/Tasks/Task_1.hpp"
#include "System/Threading/Tasks/TaskScheduler.hpp"
#include "System/Threading/SynchronizationContext.hpp"
#include "System/Threading/SendOrPostCallback.hpp"
#include "System/TimeSpan.hpp"
#include "custom-types/shared/delegate.hpp"
#include "beatsaber-hook/shared/utils/il2cpp-utils.hpp"

#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <fstream>
#include <functional>
#include <mutex>
#include <string>
#include <utility>
#include <vector>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

using HttpResponseTask = System::Threading::Tasks::Task_1<System::Net::Http::HttpResponseMessage*>*;
using HttpTextTask = System::Threading::Tasks::Task_1<StringW>*;
using HttpCompletionDelegate = System::Action_1<HttpResponseTask>*;
using UiDispatchDelegate = System::Threading::SendOrPostCallback*;
using RequestCompletion = std::function<void(int64_t, const std::string&)>;

static modloader::ModInfo modInfo{MOD_ID, VERSION, 0};
static constexpr const char* API_BASE = "https://app.riftpulse.me/api/v1";
static constexpr const char* GAME_VERSION = "1.40.8_7379";
static constexpr const char* MOD_VERSION = "0.1.26";

static HMUI::CurvedTextMeshPro* heading = nullptr;
static HMUI::CurvedTextMeshPro* instructions = nullptr;
static HMUI::CurvedTextMeshPro* overview = nullptr;
static UnityEngine::UI::Button* codeButton = nullptr;
static UnityEngine::UI::Button* checkButton = nullptr;
static UnityEngine::UI::Button* chatButton = nullptr;
static UnityEngine::UI::Button* bsrButton = nullptr;

static std::string deviceId;
static std::string deviceCredential;
static std::string challengeId;
static std::string pairingCode;
static bool requestInFlight = false;
static std::string requestDiagnostic;
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

static std::string PairingStatePath() {
  const std::string dataDir = static_cast<std::string>(UnityEngine::Application::get_persistentDataPath());
  return dataDir.empty() ? std::string{} : dataDir + "/riftpulse-pairing-state.dat";
}

static bool SavePairingState(const std::string& code, const std::string& savedChallengeId) {
  const auto path = PairingStatePath();
  if (path.empty()) return false;
  const auto temporaryPath = path + ".tmp";
  {
    std::ofstream output(temporaryPath, std::ios::binary | std::ios::trunc);
    if (!output) return false;
    output << code << std::endl << savedChallengeId << std::endl;
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

static bool LoadPairingState(std::string& savedCode, std::string& savedChallengeId) {
  savedCode.clear();
  savedChallengeId.clear();
  const auto path = PairingStatePath();
  if (path.empty()) return false;
  std::ifstream input(path, std::ios::binary);
  if (!input) return false;
  input >> savedCode >> savedChallengeId;
  if (!savedCode.empty() && savedCode.size() != 5) savedCode.clear();
  if (!savedChallengeId.empty() && savedChallengeId.size() != 36) savedChallengeId.clear();
  return !savedCode.empty() || !savedChallengeId.empty();
}

static void ClearPairingState() {
  const auto path = PairingStatePath();
  if (!path.empty()) unlink(path.c_str());
}

static System::Net::Http::HttpClient* httpClient = nullptr;
static System::Threading::SynchronizationContext* mainThreadContext = nullptr;
static UiDispatchDelegate uiDispatchDelegate = nullptr;
static std::mutex httpStateMutex;
static RequestCompletion pendingHttpCompletion;
static int64_t pendingHttpStatus = -1;
static std::string pendingHttpBody;
static std::string pendingHttpError;
static bool pendingHttpReady = false;
static std::chrono::steady_clock::time_point pendingHttpStartedAt{};
static uint64_t pendingHttpGeneration = 0;

static void RecoverStaleHttpRequest() {
  bool recovered = false;
  {
    std::lock_guard<std::mutex> lock(httpStateMutex);
    if ((pendingHttpReady || pendingHttpCompletion)
        && pendingHttpStartedAt.time_since_epoch().count() != 0
        && std::chrono::steady_clock::now() - pendingHttpStartedAt > std::chrono::seconds(30)) {
      pendingHttpCompletion = {};
      pendingHttpReady = false;
      pendingHttpBody.clear();
      pendingHttpError.clear();
      pendingHttpStartedAt = {};
      ++pendingHttpGeneration;
      recovered = true;
    }
  }
  if (recovered) {
    requestInFlight = false;
    requestDiagnostic = "The previous HTTPS request timed out. You can safely retry.";
  }
}

static void DispatchPendingHttpResponse(System::Object*) {
  RequestCompletion completion;
  int64_t status = -1;
  std::string body;
  std::string error;
  {
    std::lock_guard<std::mutex> lock(httpStateMutex);
    if (!pendingHttpReady) return;
    completion = std::move(pendingHttpCompletion);
    // A moved-from std::function is valid but unspecified; clear it so the
    // request-busy guard cannot mistake a completed callback for an active request.
    pendingHttpCompletion = {};
    status = pendingHttpStatus;
    body = std::move(pendingHttpBody);
    error = std::move(pendingHttpError);
    pendingHttpReady = false;
    pendingHttpStartedAt = {};
  }
  requestDiagnostic = error;
  if (completion) completion(status, body);
}

static bool EnsureHttpClient() {
  try {
    if (!httpClient) {
      httpClient = System::Net::Http::HttpClient::New_ctor();
      if (!httpClient) {
        requestDiagnostic = "System.Net.Http.HttpClient could not be created.";
        return false;
      }
      httpClient->set_Timeout(System::TimeSpan::FromSeconds(20.0));
    }
    if (!mainThreadContext) {
      mainThreadContext = System::Threading::SynchronizationContext::get_Current();
    }
    if (!mainThreadContext) {
      requestDiagnostic = "Unity main-thread synchronization context is unavailable.";
      return false;
    }
    if (!uiDispatchDelegate) {
      uiDispatchDelegate = custom_types::MakeDelegate<UiDispatchDelegate>(
          std::function<void(System::Object*)>(
              [](System::Object* state) { DispatchPendingHttpResponse(state); }));
    }
    if (!uiDispatchDelegate) {
      requestDiagnostic = "Could not create the main-thread HTTP callback.";
      return false;
    }
    return true;
  } catch (const std::exception& error) {
    requestDiagnostic = std::string("HTTP client initialization failed: ") + error.what();
    return false;
  } catch (...) {
    requestDiagnostic = "HTTP client initialization failed.";
    return false;
  }
}

static System::Net::Http::HttpRequestMessage* CreateHttpRequest(
    const std::string& method, const std::string& url,
    const std::string& body = {}, const std::string& credential = {}) {
  requestDiagnostic.clear();
  try {
    auto* httpMethod = method == "GET"
        ? System::Net::Http::HttpMethod::get_Get()
        : method == "POST"
            ? System::Net::Http::HttpMethod::get_Post()
            : System::Net::Http::HttpMethod::New_ctor(StringW(method));
    auto* uri = System::Uri::New_ctor(StringW(url));
    if (!httpMethod || !uri) {
      requestDiagnostic = "Could not construct the HTTPS method or URI.";
      return nullptr;
    }
    auto* request = System::Net::Http::HttpRequestMessage::New_ctor(httpMethod, uri);
    if (!request) {
      requestDiagnostic = "HttpRequestMessage construction returned null.";
      return nullptr;
    }

    if (!credential.empty()) {
      auto* authorization =
          System::Net::Http::Headers::AuthenticationHeaderValue::New_ctor(
              StringW("Bearer"), StringW(credential));
      if (!authorization) {
        requestDiagnostic = "Could not create the device authorization value.";
        request->Dispose();
        return nullptr;
      }
      request->get_Headers()->set_Authorization(authorization);
    }

    if (!body.empty()) {
      const std::vector<uint8_t> bytes(body.begin(), body.end());
      const ArrayW<uint8_t> contentBytes(bytes);
      auto* content = System::Net::Http::ByteArrayContent::New_ctor(contentBytes);
      if (!content) {
        requestDiagnostic = "ByteArrayContent construction returned null.";
        request->Dispose();
        return nullptr;
      }
      auto* contentType =
          System::Net::Http::Headers::MediaTypeHeaderValue::New_ctor(StringW("application/json"));
      if (!contentType) {
        requestDiagnostic = "Could not create JSON Content-Type.";
        request->Dispose();
        return nullptr;
      }
      content->get_Headers()->set_ContentType(contentType);
      request->set_Content(content);
    }
    return request;
  } catch (const std::exception& error) {
    requestDiagnostic = std::string("HTTPS request construction failed: ") + error.what();
    return nullptr;
  } catch (...) {
    requestDiagnostic = "HTTPS request construction failed.";
    return nullptr;
  }
}


static bool SendAsync(System::Net::Http::HttpRequestMessage* request,
                      RequestCompletion completion) {
  if (!request) return false;
  RecoverStaleHttpRequest();
  if (!EnsureHttpClient()) {
    request->Dispose();
    return false;
  }

  uint64_t requestGeneration = 0;
  {
    std::lock_guard<std::mutex> lock(httpStateMutex);
    if (pendingHttpReady || pendingHttpCompletion) {
      requestDiagnostic = "Another HTTPS request is still being processed. Wait briefly or retry after the timeout.";
      request->Dispose();
      return false;
    }
    requestGeneration = ++pendingHttpGeneration;
    pendingHttpStartedAt = std::chrono::steady_clock::now();
    pendingHttpCompletion = std::move(completion);
    pendingHttpStatus = -1;
    pendingHttpBody.clear();
    pendingHttpError.clear();
  }

  auto releaseRequestSlot = [requestGeneration]() {
    std::lock_guard<std::mutex> lock(httpStateMutex);
    if (requestGeneration == pendingHttpGeneration) {
      pendingHttpCompletion = {};
      pendingHttpReady = false;
      pendingHttpStartedAt = {};
    }
  };

  try {
    auto* task = httpClient->SendAsync(
        request, System::Net::Http::HttpCompletionOption::ResponseContentRead);
    if (!task) {
      requestDiagnostic = "HttpClient.SendAsync returned null.";
      request->Dispose();
      releaseRequestSlot();
      return false;
    }

    auto continuation = custom_types::MakeDelegate<HttpCompletionDelegate>(
        std::function<void(HttpResponseTask)>(
            [request, requestGeneration](HttpResponseTask completed) {
              int64_t status = -1;
              std::string body;
              std::string error;
              System::Net::Http::HttpResponseMessage* response = nullptr;
              try {
                if (!completed || completed->get_IsCanceled() || completed->get_IsFaulted()) {
                  throw std::runtime_error("The HTTPS task was canceled or faulted.");
                }
                response = completed->get_Result();
                if (!response) throw std::runtime_error("The server returned no response object.");
                status = static_cast<int64_t>(response->get_StatusCode().value__);
                auto* bodyTask = response->get_Content()->ReadAsStringAsync();
                if (bodyTask) {
                  bodyTask->Wait();
                  body = static_cast<std::string>(bodyTask->get_Result());
                }
              } catch (const std::exception& failure) {
                error = std::string("HTTPS transport failed: ") + failure.what();
              } catch (...) {
                error = "HTTPS transport failed with an unknown managed exception.";
              }
              if (response) response->Dispose();
              request->Dispose();

              bool shouldDispatch = false;
              {
                std::lock_guard<std::mutex> lock(httpStateMutex);
                // Ignore late completions from requests that a watchdog already retired.
                if (requestGeneration == pendingHttpGeneration && pendingHttpCompletion) {
                  pendingHttpStatus = status;
                  pendingHttpBody = std::move(body);
                  pendingHttpError = std::move(error);
                  pendingHttpReady = true;
                  shouldDispatch = true;
                }
              }
              if (shouldDispatch && mainThreadContext && uiDispatchDelegate) {
                try {
                  mainThreadContext->Post(uiDispatchDelegate, nullptr);
                } catch (...) {
                  // The watchdog retires this request if Unity never services the post.
                }
              }
            }));
    if (!continuation) {
      requestDiagnostic = "Could not create the HTTPS completion callback.";
      request->Dispose();
      releaseRequestSlot();
      return false;
    }
    task->ContinueWith(continuation, System::Threading::Tasks::TaskScheduler::get_Default());
    return true;
  } catch (const std::exception& error) {
    requestDiagnostic = std::string("Could not start HTTPS request: ") + error.what();
    request->Dispose();
    releaseRequestSlot();
    return false;
  } catch (...) {
    requestDiagnostic = "Could not start HTTPS request.";
    request->Dispose();
    releaseRequestSlot();
    return false;
  }
}

static System::Net::Http::HttpRequestMessage* CreateGetRequest(
    const std::string& url, const std::string& credential = {}) {
  return CreateHttpRequest("GET", url, {}, credential);
}

static System::Net::Http::HttpRequestMessage* CreatePairingChallengeRequest(
    const std::string& code) {
  const std::string body =
      "{\"code\":\"" + code +
      "\",\"deviceCredential\":\"" + deviceCredential +
      "\",\"deviceId\":\"" + deviceId +
      "\",\"platform\":\"quest\",\"gameVersion\":\"" +
      GAME_VERSION + "\",\"modVersion\":\"" + MOD_VERSION + "\"}";
  return CreateHttpRequest("POST", std::string(API_BASE) + "/pairing/challenges", body);
}

static System::Net::Http::HttpRequestMessage* CreatePairingResumeRequest() {
  const std::string body =
      "{\"deviceId\":\"" + deviceId +
      "\",\"deviceCredential\":\"" + deviceCredential + "\"}";
  return CreateHttpRequest("POST", std::string(API_BASE) + "/pairing/resume", body);
}

static System::Net::Http::HttpRequestMessage* CreateModuleToggleRequest(
    const std::string& module, bool enabled) {
  const std::string body = std::string("{\"enabled\":") +
                           (enabled ? "true" : "false") + "}";
  return CreateHttpRequest("PATCH",
      std::string(API_BASE) + "/device/settings/modules/" + module,
      body, deviceCredential);
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
  RecoverStaleHttpRequest();
  if (requestInFlight) return;
  requestInFlight = true;
  auto* request = CreateGetRequest(
      std::string(API_BASE) + "/device/settings/modules", deviceCredential);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        requestInFlight = false;
        if (status < 200 || status >= 300) {
          const auto code = JsonString(body, "code");
          const auto message = JsonString(body, "message");
          SetStatus("Account linked. Module settings failed (HTTP " +
                    std::to_string(status) + "). " +
                    (message.empty() ? requestDiagnostic : code + ": " + message));
          return;
        }
        chatEnabled = JsonModuleEnabled(body, "chat", true);
        bsrEnabled = JsonModuleEnabled(body, "bsr-song-request", true);
        RefreshModuleButtons();
        SetStatus("RIFTPULSE ACCOUNT LINKED\n\nCHAT AND BSR SETTINGS LOADED\n\nUse the module buttons to save changes.");
      })) {
    requestInFlight = false;
    SetStatus("Account linked, but the HTTPS settings request could not start. " + requestDiagnostic);
  }
}

static void SaveModuleSetting(const std::string& module, bool enabled) {
  RecoverStaleHttpRequest();
  if (!isPaired || requestInFlight) return;
  requestInFlight = true;
  auto* request = CreateModuleToggleRequest(module, enabled);
  if (!request || !SendAsync(request, [module, enabled](int64_t status, const std::string& response) {
        requestInFlight = false;
        if (status < 200 || status >= 300) {
          const auto code = JsonString(response, "code");
          const auto message = JsonString(response, "message");
          SetStatus("Could not save " + module + " settings (HTTP " +
                    std::to_string(status) + "). " +
                    (message.empty() ? requestDiagnostic : code + ": " + message));
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
  RecoverStaleHttpRequest();
  if (requestInFlight) return;
  if (!isPaired) {
    SetStatus("Link this installation to your RiftPulse account first.");
    return;
  }
  chatEnabled = !chatEnabled;
  RefreshModuleButtons();
  SaveModuleSetting("chat", chatEnabled);
}

static void ToggleBsr() {
  RecoverStaleHttpRequest();
  if (requestInFlight) return;
  if (!isPaired) {
    SetStatus("Link this installation to your RiftPulse account first.");
    return;
  }
  bsrEnabled = !bsrEnabled;
  RefreshModuleButtons();
  SaveModuleSetting("bsr-song-request", bsrEnabled);
}

static void ResumePairing() {
  RecoverStaleHttpRequest();
  if (requestInFlight) return;
  if (!LoadOrCreateIdentity()) {
    SetStatus("Could not load this headset's secure RiftPulse identity.");
    return;
  }

  std::string savedCode;
  std::string savedChallengeId;
  LoadPairingState(savedCode, savedChallengeId);
  pairingCode = savedCode;
  challengeId = savedChallengeId;
  if (codeButton && !pairingCode.empty()) {
    BSML::Lite::SetButtonText(codeButton, pairingCode);
  }

  requestInFlight = true;
  SetStatus("Restoring this headset's pairing with RiftPulse...");
  auto* request = CreatePairingResumeRequest();
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        requestInFlight = false;
        if (status == 404) {
          challengeId.clear();
          pairingCode.clear();
          isPaired = false;
          ClearPairingState();
          if (codeButton) BSML::Lite::SetButtonText(codeButton, "GENERATE PAIRING CODE");
          if (checkButton) BSML::Lite::SetButtonText(checkButton, "CHECK PAIRING STATUS");
          if (chatButton) BSML::Lite::SetButtonText(chatButton, "CHAT MODULE: LOCKED");
          if (bsrButton) BSML::Lite::SetButtonText(bsrButton, "BSR MODULE: LOCKED");
          SetStatus("No active pairing session was found. Generate a new five-digit code to connect this headset.");
          return;
        }
        if (status < 200 || status >= 300) {
          const auto message = JsonString(body, "message");
          SetStatus("Could not restore pairing (HTTP " + std::to_string(status) +
                    "). " + (message.empty() ? requestDiagnostic : message) +
                    "\nPress CHECK PAIRING STATUS to retry.");
          return;
        }

        challengeId = JsonString(body, "challengeId");
        const auto state = JsonString(body, "status");
        if (challengeId.empty() || (state != "pending" && state != "claimed")) {
          SetStatus("RiftPulse returned an invalid pairing recovery response. Generate a new code and retry.");
          return;
        }
        SavePairingState(pairingCode, challengeId);
        if (state == "claimed") {
          isPaired = true;
          if (checkButton) BSML::Lite::SetButtonText(checkButton, "ACCOUNT LINKED");
          SetStatus("ACCOUNT LINK CONFIRMED\n\nLoading your Chat and BSR settings...");
          LoadModuleSettings();
        } else {
          isPaired = false;
          if (checkButton) BSML::Lite::SetButtonText(checkButton, "CHECK PAIRING STATUS");
          SetStatus("PAIRING SESSION RESTORED\n\nYour five-digit code is ready. Enter it on app.riftpulse.me, then check pairing status.");
        }
      })) {
    requestInFlight = false;
    SetStatus("Could not start pairing recovery. " + requestDiagnostic +
              "\nPress CHECK PAIRING STATUS to retry.");
  }
}

static void CheckPairingStatus() {
  RecoverStaleHttpRequest();
  if (requestInFlight) return;
  if (challengeId.empty()) {
    ResumePairing();
    return;
  }
  requestInFlight = true;
  SetStatus("Checking whether the website has linked this installation...");
  auto* request = CreateGetRequest(
      std::string(API_BASE) + "/pairing/challenges/" + challengeId);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        requestInFlight = false;
        if (status == 404) {
          challengeId.clear();
          ResumePairing();
          return;
        }
        if (status < 200 || status >= 300) {
          SetStatus("Pairing check failed (HTTP " + std::to_string(status) +
                    "). " + requestDiagnostic);
          return;
        }
        const auto state = JsonString(body, "status");
        if (state == "claimed") {
          SavePairingState(pairingCode, challengeId);
          isPaired = true;
          if (checkButton) BSML::Lite::SetButtonText(checkButton, "ACCOUNT LINKED");
          SetStatus("ACCOUNT LINK CONFIRMED\n\nLoading your Chat and BSR settings...");
          LoadModuleSettings();
        } else if (state == "expired" || state == "revoked") {
          challengeId.clear();
          pairingCode.clear();
          ClearPairingState();
          if (codeButton) BSML::Lite::SetButtonText(codeButton, "GENERATE PAIRING CODE");
          SetStatus("This pairing code expired. Generate a new code to try again.");
        } else if (state == "pending") {
          SetStatus("Waiting for website confirmation. Enter the five-digit code on RiftPulse, then check again.");
        } else {
          SetStatus("RiftPulse returned an unknown pairing status. Try checking again.");
        }
      })) {
    requestInFlight = false;
    SetStatus("Could not start the pairing status request. " + requestDiagnostic);
  }
}

static void GeneratePairingCode() {
  RecoverStaleHttpRequest();
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

  pairingCode = MakePairingCode();
  if (pairingCode.empty()) {
    requestInFlight = false;
    SetStatus("Secure random number generation failed. Please restart Beat Saber and try again.");
    return;
  }
  challengeId.clear();
  SavePairingState(pairingCode, {});
  if (codeButton) BSML::Lite::SetButtonText(codeButton, pairingCode);
  SetStatus("Registering your five-digit code with RiftPulse...");

  const auto code = pairingCode;
  auto* request = CreatePairingChallengeRequest(code);
  if (!request || !SendAsync(request, [code](int64_t status, const std::string& response) {
        requestInFlight = false;
        if (status != 201) {
          const auto errorCode = JsonString(response, "code");
          const auto message = JsonString(response, "message");
          std::string detail = requestDiagnostic;
          if (!message.empty()) detail = errorCode + ": " + message;
          if (detail.size() > 180) detail.resize(180);
          SetStatus("RiftPulse registration response (HTTP " +
                    std::to_string(status) + "). " + detail +
                    "\nPress CHECK PAIRING STATUS to recover or generate a new code.");
          return;
        }
        challengeId = JsonString(response, "challengeId");
        if (challengeId.empty()) {
          SetStatus("RiftPulse registered the code but did not return its challenge ID. Checking for the saved session...");
          ResumePairing();
          return;
        }
        SavePairingState(code, challengeId);
        SetStatus("PAIRING CODE REGISTERED\n\nEnter the five-digit code shown above on the RiftPulse website. Then press CHECK PAIRING STATUS.");
        if (checkButton) BSML::Lite::SetButtonText(checkButton, "CHECK PAIRING STATUS");
      })) {
    requestInFlight = false;
    const std::string detail = requestDiagnostic.empty()
        ? "Unity could not create or start the HTTPS request."
        : requestDiagnostic;
    SetStatus("Could not start the pairing request.\n" + detail +
              "\nYou can retry with CHECK PAIRING STATUS.");
  }
}

static void BuildRiftPulseMenu(HMUI::ViewController* viewController,
                               bool firstActivation,
                               bool addedToHierarchy,
                               bool screenSystemEnabling) {
  if (!firstActivation) return;
  auto root = viewController->get_transform();

  heading = BSML::Lite::CreateText(
      root, "RIFTPULSE", 4.0f,
      {0.0f, 15.5f}, {58.0f, 7.0f});

  instructions = BSML::Lite::CreateText(
      root, "QUEST CONNECTION  â€¢  BEAT SABER 1.40.8",
      2.4f, {0.0f, 9.0f}, {58.0f, 5.0f});

  overview = BSML::Lite::CreateText(
      root,
      "Generate a secure code to link this headset.\nEnter it on app.riftpulse.me, then check pairing status.",
      2.4f, {0.0f, 0.5f}, {58.0f, 12.0f});

  // Keep every action in the same visible column as the pairing information.
  // The old x=0 button anchors were rendered far left by the PracticeButton template.
  codeButton = BSML::Lite::CreateUIButton(
      root, "GENERATE PAIRING CODE", "PracticeButton",
      UnityEngine::Vector2({22.0f, -9.0f}), UnityEngine::Vector2({42.0f, 5.5f}),
      []() { GeneratePairingCode(); });

  checkButton = BSML::Lite::CreateUIButton(
      root, "CHECK PAIRING STATUS", "PracticeButton",
      UnityEngine::Vector2({22.0f, -15.5f}), UnityEngine::Vector2({42.0f, 5.5f}),
      []() { CheckPairingStatus(); });

  chatButton = BSML::Lite::CreateUIButton(
      root, "CHAT MODULE: LOCKED", "PracticeButton",
      UnityEngine::Vector2({22.0f, -22.0f}), UnityEngine::Vector2({42.0f, 5.5f}),
      []() { ToggleChat(); });

  bsrButton = BSML::Lite::CreateUIButton(
      root, "BSR MODULE: LOCKED", "PracticeButton",
      UnityEngine::Vector2({22.0f, -28.5f}), UnityEngine::Vector2({42.0f, 5.5f}),
      []() { ToggleBsr(); });

  // Recover pending or already-linked sessions as soon as the menu opens.
  ResumePairing();
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
