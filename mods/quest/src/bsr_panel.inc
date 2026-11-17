// RiftPulse Quest standalone BSR queue and importer.
struct BsrQueueRequest {
  std::string id;
  std::string key;
  std::string song;
  std::string requester;
  std::string provider;
  std::string status;
};

static void RefreshBsrQueuePanel();
static void ApproveBsrPanelRequest();
static void RejectBsrPanelRequest();
static BSML::FloatingScreen* worldBsrPanel = nullptr;
static TMPro::TextMeshProUGUI* worldBsrHeader = nullptr;
static TMPro::TextMeshProUGUI* worldBsrDetail = nullptr;
static TMPro::TextMeshProUGUI* worldBsrStatus = nullptr;
static UnityEngine::UI::Button* worldBsrPrevious = nullptr;
static UnityEngine::UI::Button* worldBsrNext = nullptr;
static UnityEngine::UI::Button* worldBsrYes = nullptr;
static UnityEngine::UI::Button* worldBsrNo = nullptr;
static std::vector<UnityEngine::UI::Button*> worldBsrRows;
static std::vector<BsrQueueRequest> worldBsrRequests;
static int worldBsrSelectedIndex = -1;
static int worldBsrPage = 0;
static float worldBsrNextPoll = 0.0f;
static float worldBsrNextPlacementSave = 0.0f;
static bool worldBsrPollInFlight = false;
static bool worldBsrActionInFlight = false;
static bool worldBsrPanelRequested = false;
static UnityEngine::GameObject* worldBsrDriverObject = nullptr;

struct BsrPanelPose {
  float x = 0.0f;
  float y = 0.0f;
  float z = 2.35f;
  UnityEngine::Quaternion rotationOffset = UnityEngine::Quaternion(0.0f, 0.0f, 0.0f, 1.0f);
  bool hasRotationOffset = false;
};
static BsrPanelPose worldBsrPose;
static UnityEngine::Vector3 worldBsrLastSavedPosition;
static UnityEngine::Quaternion worldBsrLastSavedRotation = UnityEngine::Quaternion(0.0f, 0.0f, 0.0f, 1.0f);
static bool worldBsrHasSavedPose = false;

static std::string BsrPanelPosePath() {
  const std::string dataDir = static_cast<std::string>(UnityEngine::Application::get_persistentDataPath());
  return dataDir.empty() ? std::string{} : dataDir + "/riftpulse-bsr-panel-pose.dat";
}

static void LoadBsrPanelPose() {
  const auto path = BsrPanelPosePath();
  if (path.empty()) return;
  std::ifstream input(path);
  float x = 0.0f, y = 0.0f, z = 2.35f;
  float qx = 0.0f, qy = 0.0f, qz = 0.0f, qw = 1.0f;
  int hasRotation = 0;
  if (!(input >> x >> y >> z >> qx >> qy >> qz >> qw >> hasRotation)) return;
  worldBsrPose.x = std::clamp(x, -2.5f, 2.5f);
  worldBsrPose.y = std::clamp(y, -2.0f, 2.0f);
  worldBsrPose.z = std::clamp(z, 0.8f, 4.5f);
  worldBsrPose.rotationOffset = UnityEngine::Quaternion(qx, qy, qz, qw);
  worldBsrPose.hasRotationOffset = hasRotation != 0;
}

static void SaveBsrPanelPose() {
  if (!worldBsrPanel) return;
  const auto position = worldBsrPanel->get_ScreenPosition();
  const auto rotation = worldBsrPanel->get_ScreenRotation();
  if (!worldBsrHasSavedPose) {
    worldBsrLastSavedPosition = position;
    worldBsrLastSavedRotation = rotation;
    worldBsrHasSavedPose = true;
    return;
  }
  const float dx = position.x - worldBsrLastSavedPosition.x;
  const float dy = position.y - worldBsrLastSavedPosition.y;
  const float dz = position.z - worldBsrLastSavedPosition.z;
  const bool positionChanged = (dx * dx + dy * dy + dz * dz) >= 0.000025f;
  float dot = rotation.x * worldBsrLastSavedRotation.x +
      rotation.y * worldBsrLastSavedRotation.y +
      rotation.z * worldBsrLastSavedRotation.z +
      rotation.w * worldBsrLastSavedRotation.w;
  if (dot < 0.0f) dot = -dot;
  const bool rotationChanged = (1.0f - dot) >= 0.00002f;
  if (!positionChanged && !rotationChanged) return;
  const float now = UnityEngine::Time::get_realtimeSinceStartup();
  if (now < worldBsrNextPlacementSave) return;
  auto camera = UnityEngine::Camera::get_main();
  if (!camera || !camera->get_transform()) return;
  auto cameraTransform = camera->get_transform();
  const auto cameraPosition = cameraTransform->get_position();
  const auto right = WorldChatHorizontalRight(cameraTransform);
  const auto forward = WorldChatHorizontalForward(cameraTransform);
  worldBsrPose.x = std::clamp((position.x - cameraPosition.x) * right.x +
      (position.z - cameraPosition.z) * right.z, -2.5f, 2.5f);
  worldBsrPose.y = std::clamp(position.y - cameraPosition.y, -2.0f, 2.0f);
  worldBsrPose.z = std::clamp((position.x - cameraPosition.x) * forward.x +
      (position.z - cameraPosition.z) * forward.z, 0.8f, 4.5f);
  worldBsrPose.rotationOffset = UnityEngine::Quaternion::op_Multiply(
      UnityEngine::Quaternion::Inverse(WorldChatHorizontalCameraRotation(cameraTransform)), rotation);
  worldBsrPose.hasRotationOffset = true;
  const auto path = BsrPanelPosePath();
  const auto temporaryPath = path + ".tmp";
  {
    std::ofstream output(temporaryPath, std::ios::binary | std::ios::trunc);
    if (output) {
      output << worldBsrPose.x << " " << worldBsrPose.y << " " << worldBsrPose.z << " "
          << worldBsrPose.rotationOffset.x << " " << worldBsrPose.rotationOffset.y << " "
          << worldBsrPose.rotationOffset.z << " " << worldBsrPose.rotationOffset.w << " "
          << (worldBsrPose.hasRotationOffset ? 1 : 0) << std::endl;
      output.flush();
      if (output.good()) {
        chmod(temporaryPath.c_str(), S_IRUSR | S_IWUSR);
        if (rename(temporaryPath.c_str(), path.c_str()) == 0)
          chmod(path.c_str(), S_IRUSR | S_IWUSR);
        else unlink(temporaryPath.c_str());
      }
    }
  }
  worldBsrLastSavedPosition = position;
  worldBsrLastSavedRotation = rotation;
  worldBsrHasSavedPose = true;
  worldBsrNextPlacementSave = now + 0.25f;
}

static void SetBsrPanelStatus(const std::string& value) {
  if (!worldBsrStatus) return;
  std::string compact = value;
  compact.erase(std::remove_if(compact.begin(), compact.end(),
      [](unsigned char ch) { return ch == '\r' || ch == '\n'; }), compact.end());
  if (compact.size() > 110) compact = compact.substr(0, 107) + "...";
  worldBsrStatus->set_text(StringW(compact));
}

static TMPro::TextMeshProUGUI* CreateBsrPanelText(
    UnityEngine::Transform* parent, const std::string& name, const std::string& text,
    float fontSize, UnityEngine::Vector2 position, UnityEngine::Vector2 size,
    TMPro::TextAlignmentOptions alignment = TMPro::TextAlignmentOptions::Left) {
  if (!parent) return nullptr;
  ArrayW<System::Type*> componentTypes{
      static_cast<System::Type*>(csTypeOf(UnityEngine::RectTransform*)),
      static_cast<System::Type*>(csTypeOf(TMPro::TextMeshProUGUI*))
  };
  auto* object = UnityEngine::GameObject::New_ctor(StringW(name), componentTypes);
  if (!object) return nullptr;
  auto* rect = object->GetComponent<UnityEngine::RectTransform*>();
  auto* label = object->GetComponent<TMPro::TextMeshProUGUI*>();
  if (!rect || !label) {
    UnityEngine::Object::Destroy(object);
    return nullptr;
  }
  rect->SetParent(parent, false);
  rect->set_anchorMin(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchorMax(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_pivot(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchoredPosition(position);
  rect->set_sizeDelta(size);
  auto* font = ResolveWorldChatFont();
  if (font) label->set_font(font);
  label->set_enabled(true);
  label->set_text(StringW(text));
  label->set_fontSize(fontSize);
  label->set_enableWordWrapping(true);
  label->set_alignment(alignment);
  label->set_richText(false);
  label->set_raycastTarget(false);
  label->set_color(UnityEngine::Color(0.92f, 0.95f, 1.0f, 1.0f));
  object->SetActive(true);
  return label;
}

static UnityEngine::UI::Button* CreateBsrPanelButton(
    UnityEngine::Transform* parent, const std::string& text,
    UnityEngine::Vector2 position, UnityEngine::Vector2 size,
    std::function<void()> onClick) {
  if (!parent) return nullptr;
  auto* button = BSML::Lite::CreateUIButton(parent, StringW(text), "PracticeButton",
      position, size, std::move(onClick));
  if (button) {
    BSML::Lite::ToggleButtonWordWrapping(button, false);
    BSML::Lite::SetButtonTextSize(button, 2.7f);
  }
  return button;
}

static void SetBsrPanelActionsEnabled(bool enabled) {
  if (worldBsrYes) worldBsrYes->set_interactable(enabled);
  if (worldBsrNo) worldBsrNo->set_interactable(enabled);
}

static std::string BsrEscapeRichText(std::string value, size_t maxLength) {
  if (value.size() > maxLength) value.resize(maxLength);
  std::string safe;
  safe.reserve(value.size() + 8);
  for (char ch : value) {
    if (ch == '<') safe += "&lt;";
    else if (ch == '>') safe += "&gt;";
    else if (ch == '&') safe += "&amp;";
    else if (ch == '\r' || ch == '\n') safe.push_back(' ');
    else if (static_cast<unsigned char>(ch) >= 0x20) safe.push_back(ch);
  }
  return safe;
}

static void RenderBsrQueuePanel() {
  if (!worldBsrPanel) return;
  for (auto* button : worldBsrRows) {
    if (button && button->get_gameObject()) UnityEngine::Object::Destroy(button->get_gameObject());
  }
  worldBsrRows.clear();

  const int pageSize = 4;
  const int maxPage = worldBsrRequests.empty() ? 0 :
      static_cast<int>((worldBsrRequests.size() - 1) / pageSize);
  worldBsrPage = std::clamp(worldBsrPage, 0, maxPage);
  const int start = worldBsrPage * pageSize;
  const int end = std::min(static_cast<int>(worldBsrRequests.size()), start + pageSize);
  if (worldBsrHeader) {
    worldBsrHeader->set_text(StringW("RIFTPULSE  /  SONG REQUESTS   •   " +
        std::to_string(worldBsrRequests.size()) + " IN QUEUE"));
  }

  for (int index = start; index < end; ++index) {
    const auto& item = worldBsrRequests[static_cast<size_t>(index)];
    std::string song = item.song.empty() ? "BeatSaver " + item.key : item.song;
    if (song.size() > 34) song = song.substr(0, 31) + "...";
    const bool selected = index == worldBsrSelectedIndex;
    const std::string rowText = std::string(selected ? "▶  " : "♫  ") +
        std::to_string(index + 1) + "  " + song +
        (item.status == "playing" ? "  /  READY" : "");
    auto* button = CreateBsrPanelButton(worldBsrPanel->get_transform(), rowText,
        UnityEngine::Vector2(-35.0f, 23.0f - static_cast<float>(index - start) * 12.0f),
        UnityEngine::Vector2(70.0f, 10.5f),
        [index]() {
          if (index < 0 || index >= static_cast<int>(worldBsrRequests.size())) return;
          worldBsrSelectedIndex = index;
          worldBsrPage = index / 4;
          RenderBsrQueuePanel();
        });
    if (button) worldBsrRows.push_back(button);
  }

  if (worldBsrRequests.empty()) {
    if (worldBsrDetail) worldBsrDetail->set_text(StringW(
        "♫  NO REQUESTS YET\n\nRequests from Twitch, YouTube, and TikTok appear here as viewers use your BSR command."));
    SetBsrPanelActionsEnabled(false);
  } else {
    if (worldBsrSelectedIndex < 0 || worldBsrSelectedIndex >= static_cast<int>(worldBsrRequests.size()))
      worldBsrSelectedIndex = start;
    const auto& selected = worldBsrRequests[static_cast<size_t>(worldBsrSelectedIndex)];
    if (worldBsrDetail) {
      std::string detail = "♫  SELECTED REQUEST\n\n" +
          BsrEscapeRichText(selected.song.empty() ? ("BeatSaver " + selected.key) : selected.song, 90) +
          "\n\nREQUESTED BY\n" + BsrEscapeRichText(selected.requester, 40) +
          "\n\nPLATFORM  /  " + BsrEscapeRichText(selected.provider, 18) +
          "\nMAP KEY  /  " + BsrEscapeRichText(selected.key, 12);
      if (selected.status == "playing")
        detail += "\n\nDOWNLOADED  /  OPEN SOLO > CUSTOM LEVELS TO PLAY";
      else
        detail += "\n\nYES downloads and installs this map. NO removes the request.";
      worldBsrDetail->set_text(StringW(detail));
    }
    SetBsrPanelActionsEnabled(!worldBsrActionInFlight && selected.status != "playing");
  }

  if (worldBsrPrevious) worldBsrPrevious->set_interactable(worldBsrPage > 0);
  if (worldBsrNext) worldBsrNext->set_interactable(end < static_cast<int>(worldBsrRequests.size()));
  SetBsrPanelStatus(worldBsrRequests.empty()
      ? "Queue empty  /  auto refresh every 5 seconds"
      : "Showing " + std::to_string(start + 1) + "–" + std::to_string(end) +
        " of " + std::to_string(worldBsrRequests.size()) + "  /  select a song, then YES or NO");
}

static void ChangeBsrPanelPage(int delta) {
  const int maxPage = worldBsrRequests.empty() ? 0 :
      static_cast<int>((worldBsrRequests.size() - 1) / 4);
  worldBsrPage = std::clamp(worldBsrPage + delta, 0, maxPage);
  worldBsrSelectedIndex = worldBsrRequests.empty() ? -1 : worldBsrPage * 4;
  RenderBsrQueuePanel();
}

static bool EnsureBsrQueuePanel() {
  if (worldBsrPanel) return true;
  auto camera = UnityEngine::Camera::get_main();
  if (!camera || !camera->get_transform()) return false;
  LoadBsrPanelPose();
  auto cameraTransform = camera->get_transform();
  const auto cameraPosition = cameraTransform->get_position();
  const auto right = WorldChatHorizontalRight(cameraTransform);
  const auto forward = WorldChatHorizontalForward(cameraTransform);
  const auto position = UnityEngine::Vector3(
      cameraPosition.x + right.x * worldBsrPose.x + forward.x * worldBsrPose.z,
      cameraPosition.y + worldBsrPose.y,
      cameraPosition.z + right.z * worldBsrPose.x + forward.z * worldBsrPose.z);
  const auto rotation = worldBsrPose.hasRotationOffset
      ? UnityEngine::Quaternion::op_Multiply(
          WorldChatHorizontalCameraRotation(cameraTransform), worldBsrPose.rotationOffset)
      : UnityEngine::Quaternion::LookRotation(
          UnityEngine::Vector3(cameraPosition.x - position.x,
              cameraPosition.y - position.y, cameraPosition.z - position.z),
          UnityEngine::Vector3(0.0f, 1.0f, 0.0f));
  worldBsrPanel = BSML::FloatingScreen::CreateFloatingScreen(
      UnityEngine::Vector2(142.0f, 86.0f), true, position, rotation, 0.0f, true);
  if (!worldBsrPanel) return false;
  worldBsrPanel->set_ShowHandle(true);
  worldBsrPanel->set_HighlightHandle(true);
  UnityEngine::Object::DontDestroyOnLoad(worldBsrPanel->get_gameObject());
  auto root = worldBsrPanel->get_transform();
  worldBsrHeader = CreateBsrPanelText(root, "RiftPulse BSR Title", "RIFTPULSE  /  SONG REQUESTS",
      4.1f, {0.0f, 37.0f}, {130.0f, 7.0f}, TMPro::TextAlignmentOptions::Center);
  worldBsrDetail = CreateBsrPanelText(root, "RiftPulse BSR Details", "Select a request to review it.",
      2.8f, {35.0f, 3.0f}, {60.0f, 47.0f});
  worldBsrStatus = CreateBsrPanelText(root, "RiftPulse BSR Status", "Connecting to your live queue...",
      2.45f, {0.0f, -39.0f}, {130.0f, 4.5f}, TMPro::TextAlignmentOptions::Center);
  worldBsrPrevious = CreateBsrPanelButton(root, "UP / PAGE",
      {-49.0f, -33.0f}, {27.0f, 7.0f}, []() { ChangeBsrPanelPage(-1); });
  worldBsrNext = CreateBsrPanelButton(root, "DOWN / PAGE",
      {-20.0f, -33.0f}, {27.0f, 7.0f}, []() { ChangeBsrPanelPage(1); });
  CreateBsrPanelButton(root, "REFRESH",
      {9.0f, -33.0f}, {24.0f, 7.0f}, []() { RefreshBsrQueuePanel(); });
  worldBsrYes = CreateBsrPanelButton(root, "YES  /  DOWNLOAD",
      {35.0f, -23.0f}, {48.0f, 8.5f}, []() { ApproveBsrPanelRequest(); });
  worldBsrNo = CreateBsrPanelButton(root, "NO  /  REMOVE",
      {35.0f, -33.0f}, {48.0f, 8.5f}, []() { RejectBsrPanelRequest(); });
  worldBsrLastSavedPosition = worldBsrPanel->get_ScreenPosition();
  worldBsrLastSavedRotation = worldBsrPanel->get_ScreenRotation();
  worldBsrHasSavedPose = true;
  RenderBsrQueuePanel();
  return true;
}

static size_t BsrFindJsonArrayEnd(const std::string& json, size_t start) {
  return FindMatchingJsonArrayEnd(json, start);
}

static void RefreshBsrQueuePanel() {
  RecoverStaleHttpRequest();
  if (!worldBsrPanel || !isPaired || deviceCredential.empty()) {
    SetBsrPanelStatus(!isPaired ? "Pair this headset to view song requests." :
        "Open the BSR panel to connect to the queue.");
    return;
  }
  if (requestInFlight || worldBsrPollInFlight || worldBsrActionInFlight) return;
  requestInFlight = true;
  worldBsrPollInFlight = true;
  SetBsrPanelStatus("Loading viewer song requests...");
  auto* request = CreateGetRequest(std::string(API_BASE) + "/device/song-requests", deviceCredential);
  if (!request || !SendAsync(request, [](int64_t status, const std::string& body) {
        requestInFlight = false;
        worldBsrPollInFlight = false;
        if (status < 200 || status >= 300) {
          SetBsrPanelStatus("Song queue unavailable. Refresh to retry.");
          return;
        }
        const auto requestsMarker = body.find("\"requests\"");
        const auto arrayStart = requestsMarker == std::string::npos
            ? std::string::npos : body.find('[', requestsMarker);
        const auto arrayEnd = arrayStart == std::string::npos
            ? std::string::npos : BsrFindJsonArrayEnd(body, arrayStart);
        if (arrayEnd == std::string::npos) {
          SetBsrPanelStatus("RiftPulse returned an invalid queue response.");
          return;
        }
        const std::string previousSelection =
            worldBsrSelectedIndex >= 0 && worldBsrSelectedIndex < static_cast<int>(worldBsrRequests.size())
                ? worldBsrRequests[static_cast<size_t>(worldBsrSelectedIndex)].id : std::string{};
        std::vector<BsrQueueRequest> next;
        size_t cursor = arrayStart + 1;
        while (cursor < arrayEnd && next.size() < 50) {
          while (cursor < arrayEnd && (std::isspace(static_cast<unsigned char>(body[cursor])) || body[cursor] == ',')) ++cursor;
          if (cursor >= arrayEnd || body[cursor] == ']') break;
          if (body[cursor] != '{') { ++cursor; continue; }
          const auto objectEnd = FindMatchingJsonObjectEnd(body, cursor);
          if (objectEnd == std::string::npos || objectEnd > arrayEnd) break;
          const auto object = body.substr(cursor, objectEnd - cursor + 1);
          cursor = objectEnd + 1;
          BsrQueueRequest item;
          item.id = ReadJsonStringField(object, "id");
          item.key = ReadJsonStringField(object, "beatsaverKey");
          item.song = ReadJsonStringField(object, "songName");
          item.requester = ReadJsonStringField(object, "requesterName");
          item.provider = ReadJsonStringField(object, "provider");
          item.status = ReadJsonStringField(object, "status");
          if (!item.id.empty()) next.push_back(std::move(item));
        }
        worldBsrRequests = std::move(next);
        worldBsrSelectedIndex = -1;
        if (!previousSelection.empty()) {
          for (size_t i = 0; i < worldBsrRequests.size(); ++i) {
            if (worldBsrRequests[i].id == previousSelection) {
              worldBsrSelectedIndex = static_cast<int>(i);
              break;
            }
          }
        }
        if (worldBsrSelectedIndex < 0 && !worldBsrRequests.empty())
          worldBsrSelectedIndex = worldBsrPage * 4;
        worldBsrPage = std::clamp(worldBsrPage, 0,
            worldBsrRequests.empty() ? 0 : static_cast<int>((worldBsrRequests.size() - 1) / 4));
        RenderBsrQueuePanel();
      })) {
    requestInFlight = false;
    worldBsrPollInFlight = false;
    SetBsrPanelStatus("Could not start the queue refresh.");
  }
}

static uint16_t BsrRead16(const std::vector<uint8_t>& data, size_t offset) {
  if (offset + 2 > data.size()) return 0;
  return static_cast<uint16_t>(data[offset]) |
      (static_cast<uint16_t>(data[offset + 1]) << 8);
}

static uint32_t BsrRead32(const std::vector<uint8_t>& data, size_t offset) {
  if (offset + 4 > data.size()) return 0;
  return static_cast<uint32_t>(data[offset]) |
      (static_cast<uint32_t>(data[offset + 1]) << 8) |
      (static_cast<uint32_t>(data[offset + 2]) << 16) |
      (static_cast<uint32_t>(data[offset + 3]) << 24);
}

static bool BsrDecodeBase64(const std::string& input, std::vector<uint8_t>& output) {
  static const std::string alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  output.clear();
  if (input.size() > 30 * 1024 * 1024) return false;
  int accumulator = 0;
  int bits = -8;
  for (unsigned char ch : input) {
    if (ch == '=' || ch == '\r' || ch == '\n' || ch == ' ' || ch == '\t') continue;
    const auto value = alphabet.find(static_cast<char>(ch));
    if (value == std::string::npos) return false;
    accumulator = (accumulator << 6) | static_cast<int>(value);
    bits += 6;
    if (bits >= 0) {
      output.push_back(static_cast<uint8_t>((accumulator >> bits) & 0xff));
      bits -= 8;
    }
    if (output.size() > 20 * 1024 * 1024) return false;
  }
  return output.size() >= 100;
}

static bool BsrEnsureDirectories(const std::string& path) {
  if (path.empty() || path[0] != '/') return false;
  std::string current;
  for (size_t i = 0; i < path.size(); ++i) {
    current.push_back(path[i]);
    if (path[i] != '/' && i + 1 != path.size()) continue;
    if (current.size() <= 1) continue;
    if (mkdir(current.c_str(), 0755) != 0 && errno != EEXIST) return false;
  }
  struct stat info {};
  return stat(path.c_str(), &info) == 0 && S_ISDIR(info.st_mode);
}

static std::string BsrCustomLevelsPath() {
  return "/sdcard/ModData/com.beatgames.beatsaber/Mods/SongCore/CustomLevels";
}

static bool BsrSafeArchivePath(std::string& name) {
  std::replace(name.begin(), name.end(), '\\', '/');
  if (name.empty() || name[0] == '/' || name.find(':') != std::string::npos) return false;
  if (name.find('\0') != std::string::npos) return false;
  size_t cursor = 0;
  while (cursor < name.size()) {
    const auto end = name.find('/', cursor);
    const auto segment = name.substr(cursor, end == std::string::npos ? std::string::npos : end - cursor);
    if (segment.empty() || segment == "." || segment == "..") return false;
    cursor = end == std::string::npos ? name.size() : end + 1;
  }
  return true;
}

static bool BsrWriteFile(const std::string& path, const uint8_t* bytes, size_t length) {
  const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
  if (fd < 0) return false;
  size_t offset = 0;
  while (offset < length) {
    const auto written = write(fd, bytes + offset, length - offset);
    if (written <= 0) { close(fd); return false; }
    offset += static_cast<size_t>(written);
  }
  fsync(fd);
  close(fd);
  return true;
}

struct BsrZipFile {
  std::string name;
  uint16_t flags = 0;
  uint16_t method = 0;
  uint32_t crc = 0;
  uint32_t compressed = 0;
  uint32_t uncompressed = 0;
  uint32_t localOffset = 0;
};

static bool BsrExtractQuestArchive(const std::vector<uint8_t>& archive,
                                   const BsrQueueRequest& item,
                                   std::string& installedPath,
                                   std::string& error) {
  if (archive.size() < 22 || archive.size() > 20 * 1024 * 1024) {
    error = "The BeatSaver ZIP archive has an invalid size.";
    return false;
  }
  const size_t searchStart = archive.size() > 65557 ? archive.size() - 65557 : 0;
  size_t eocd = std::string::npos;
  for (size_t i = archive.size() - 22; ; --i) {
    if (BsrRead32(archive, i) == 0x06054b50U) { eocd = i; break; }
    if (i == searchStart) break;
  }
  if (eocd == std::string::npos) { error = "The map archive is missing its ZIP directory."; return false; }
  const uint16_t entries = BsrRead16(archive, eocd + 10);
  const uint32_t directoryOffset = BsrRead32(archive, eocd + 16);
  if (entries == 0 || entries > 1000 || directoryOffset >= archive.size()) {
    error = "The map archive contains an unsupported ZIP directory.";
    return false;
  }

  std::vector<BsrZipFile> files;
  files.reserve(entries);
  size_t cursor = directoryOffset;
  for (uint16_t i = 0; i < entries; ++i) {
    if (cursor + 46 > archive.size() || BsrRead32(archive, cursor) != 0x02014b50U) {
      error = "The map archive's file list is damaged.";
      return false;
    }
    BsrZipFile file;
    file.flags = BsrRead16(archive, cursor + 8);
    file.method = BsrRead16(archive, cursor + 10);
    file.crc = BsrRead32(archive, cursor + 16);
    file.compressed = BsrRead32(archive, cursor + 20);
    file.uncompressed = BsrRead32(archive, cursor + 24);
    const uint16_t nameLength = BsrRead16(archive, cursor + 28);
    const uint16_t extraLength = BsrRead16(archive, cursor + 30);
    const uint16_t commentLength = BsrRead16(archive, cursor + 32);
    file.localOffset = BsrRead32(archive, cursor + 42);
    const size_t nameStart = cursor + 46;
    const size_t recordEnd = nameStart + nameLength + extraLength + commentLength;
    if (recordEnd > archive.size()) { error = "The map archive's file path is invalid."; return false; }
    file.name.assign(reinterpret_cast<const char*>(archive.data() + nameStart), nameLength);
    cursor = recordEnd;
    if (!file.name.empty() && file.name.back() == '/') continue;
    if (!BsrSafeArchivePath(file.name)) { error = "The map archive contained an unsafe file path."; return false; }
    if ((file.flags & 1u) != 0 || (file.method != 0 && file.method != 8) ||
        file.uncompressed > 30 * 1024 * 1024 || file.compressed > archive.size()) {
      error = "This map uses an unsupported or encrypted ZIP entry.";
      return false;
    }
    files.push_back(std::move(file));
  }
  if (files.empty()) { error = "The map archive contained no files."; return false; }

  // BeatSaver archives sometimes wrap the map in one top-level folder. Flatten
  // that shared wrapper so Info.dat lives at the CustomLevels folder root.
  std::string commonRoot;
  bool canStripRoot = true;
  for (const auto& file : files) {
    const auto slash = file.name.find('/');
    if (slash == std::string::npos) { canStripRoot = false; break; }
    const auto root = file.name.substr(0, slash + 1);
    if (commonRoot.empty()) commonRoot = root;
    else if (commonRoot != root) { canStripRoot = false; break; }
  }
  if (!canStripRoot) commonRoot.clear();

  const std::string levelsRoot = BsrCustomLevelsPath();
  if (!BsrEnsureDirectories(levelsRoot)) {
    error = "SongCore's CustomLevels folder is not accessible on this headset.";
    return false;
  }
  std::string safeName = item.song.empty() ? "BeatSaver Map" : item.song;
  for (char& ch : safeName) {
    if (!(std::isalnum(static_cast<unsigned char>(ch)) || ch == ' ' || ch == '_' || ch == '-')) ch = '_';
  }
  if (safeName.size() > 42) safeName.resize(42);
  const std::string folderName = item.key + " (" + safeName + ")";
  installedPath = levelsRoot + "/" + folderName;
  if (!BsrEnsureDirectories(installedPath)) {
    error = "Could not create this map's CustomLevels folder.";
    return false;
  }

  size_t totalExpanded = 0;
  bool infoFound = false;
  for (const auto& file : files) {
    if (file.localOffset + 30 > archive.size() ||
        BsrRead32(archive, file.localOffset) != 0x04034b50U) {
      error = "The map archive contains an invalid local file header.";
      return false;
    }
    const uint16_t localNameLength = BsrRead16(archive, file.localOffset + 26);
    const uint16_t localExtraLength = BsrRead16(archive, file.localOffset + 28);
    const size_t dataOffset = static_cast<size_t>(file.localOffset) + 30 +
        localNameLength + localExtraLength;
    if (dataOffset + file.compressed > archive.size()) {
      error = "The map archive contains truncated file data.";
      return false;
    }
    totalExpanded += file.uncompressed;
    if (totalExpanded > 100 * 1024 * 1024) {
      error = "The unpacked map is too large for the in-game importer.";
      return false;
    }

    std::vector<uint8_t> decoded(file.uncompressed);
    const auto* source = archive.data() + dataOffset;
    if (file.method == 0) {
      if (file.compressed != file.uncompressed) { error = "A stored ZIP entry has inconsistent sizes."; return false; }
      if (file.uncompressed) std::copy(source, source + file.uncompressed, decoded.begin());
    } else {
      z_stream stream{};
      stream.next_in = const_cast<Bytef*>(reinterpret_cast<const Bytef*>(source));
      stream.avail_in = file.compressed;
      stream.next_out = reinterpret_cast<Bytef*>(decoded.data());
      stream.avail_out = file.uncompressed;
      if (inflateInit2(&stream, -MAX_WBITS) != Z_OK) { error = "Could not initialize ZIP decompression."; return false; }
      const int result = inflate(&stream, Z_FINISH);
      inflateEnd(&stream);
      if (result != Z_STREAM_END || stream.total_out != file.uncompressed) {
        error = "A song file could not be decompressed.";
        return false;
      }
    }
    const auto calculatedCrc = static_cast<uint32_t>(crc32(0,
        reinterpret_cast<const Bytef*>(decoded.data()), static_cast<uInt>(decoded.size())));
    if (calculatedCrc != file.crc) { error = "A song file failed ZIP integrity verification."; return false; }

    std::string relative = file.name;
    if (!commonRoot.empty() && relative.rfind(commonRoot, 0) == 0) relative.erase(0, commonRoot.size());
    if (relative.empty() || !BsrSafeArchivePath(relative)) continue;
    const std::string target = installedPath + "/" + relative;
    const auto slash = target.find_last_of('/');
    if (slash == std::string::npos || !BsrEnsureDirectories(target.substr(0, slash))) {
      error = "Could not create a song file folder.";
      return false;
    }
    if (!BsrWriteFile(target, decoded.data(), decoded.size())) {
      error = "Could not write a song file to CustomLevels.";
      return false;
    }
    if (relative == "Info.dat" || relative == "info.dat") infoFound = true;
  }
  if (!infoFound) {
    error = "The BeatSaver archive did not contain Info.dat at its song root.";
    return false;
  }
  return true;
}

static void PatchBsrRequestStatus(const std::string& requestId, const std::string& status,
                                  std::function<void(bool, const std::string&)> completion) {
  const std::string body = "{\"status\":\"" + status + "\"}";
  auto* request = CreateHttpRequest("PATCH",
      std::string(API_BASE) + "/device/song-requests/" + requestId,
      body, deviceCredential);
  if (!request || !SendAsync(request, [completion = std::move(completion)](int64_t code, const std::string& response) {
        if (code < 200 || code >= 300) {
          const auto message = ReadJsonStringField(response, "message");
          completion(false, message.empty() ? ("Queue update failed (HTTP " + std::to_string(code) + ").") : message);
          return;
        }
        completion(true, "Request status updated.");
      })) {
    completion(false, "Could not start the queue update request.");
  }
}

static void RejectBsrPanelRequest() {
  if (worldBsrActionInFlight || worldBsrSelectedIndex < 0 ||
      worldBsrSelectedIndex >= static_cast<int>(worldBsrRequests.size())) return;
  const auto item = worldBsrRequests[static_cast<size_t>(worldBsrSelectedIndex)];
  worldBsrActionInFlight = true;
  requestInFlight = true;
  SetBsrPanelActionsEnabled(false);
  SetBsrPanelStatus("Removing " + item.song + " from the queue...");
  PatchBsrRequestStatus(item.id, "rejected", [item](bool success, const std::string& message) {
    requestInFlight = false;
    worldBsrActionInFlight = false;
    if (!success) {
      SetBsrPanelStatus("Could not remove request: " + message);
      RenderBsrQueuePanel();
      return;
    }
    worldBsrRequests.erase(std::remove_if(worldBsrRequests.begin(), worldBsrRequests.end(),
        [&item](const BsrQueueRequest& request) { return request.id == item.id; }),
        worldBsrRequests.end());
    if (worldBsrSelectedIndex >= static_cast<int>(worldBsrRequests.size()))
      worldBsrSelectedIndex = static_cast<int>(worldBsrRequests.size()) - 1;
    SetBsrPanelStatus("Request removed from the live queue.");
    RenderBsrQueuePanel();
    worldBsrNextPoll = 0.0f;
  });
}

static void ApproveBsrPanelRequest() {
  if (worldBsrActionInFlight || worldBsrSelectedIndex < 0 ||
      worldBsrSelectedIndex >= static_cast<int>(worldBsrRequests.size())) return;
  const auto item = worldBsrRequests[static_cast<size_t>(worldBsrSelectedIndex)];
  if (item.status == "playing") return;
  if (item.key.size() < 5 || item.key.size() > 8 ||
      !std::all_of(item.key.begin(), item.key.end(), [](unsigned char ch) { return std::isxdigit(ch) != 0; })) {
    SetBsrPanelStatus("This request has an invalid BeatSaver map key.");
    return;
  }
  worldBsrActionInFlight = true;
  requestInFlight = true;
  SetBsrPanelActionsEnabled(false);
  SetBsrPanelStatus("Downloading " + item.song + "...");
  auto* request = CreateGetRequest(
      std::string(API_BASE) + "/device/song-requests/" + item.id + "/archive",
      deviceCredential);
  if (!request || !SendAsync(request, [item](int64_t code, const std::string& response) {
        requestInFlight = false;
        if (code < 200 || code >= 300) {
          worldBsrActionInFlight = false;
          auto message = ReadJsonStringField(response, "message");
          if (message.empty()) message = "Archive download failed (HTTP " + std::to_string(code) + ").";
          SetBsrPanelStatus(message);
          RenderBsrQueuePanel();
          return;
        }
        const auto archiveText = ReadJsonStringField(response, "archiveBase64");
        std::vector<uint8_t> archive;
        if (archiveText.empty() || !BsrDecodeBase64(archiveText, archive)) {
          worldBsrActionInFlight = false;
          SetBsrPanelStatus("The Quest download response did not contain a valid ZIP archive.");
          RenderBsrQueuePanel();
          return;
        }
        std::string installedPath;
        std::string error;
        if (!BsrExtractQuestArchive(archive, item, installedPath, error)) {
          worldBsrActionInFlight = false;
          SetBsrPanelStatus(error.empty() ? "Could not install the song on this headset." : error);
          RenderBsrQueuePanel();
          return;
        }
        requestInFlight = true;
        PatchBsrRequestStatus(item.id, "downloaded", [item, installedPath](bool success, const std::string& message) {
          requestInFlight = false;
          worldBsrActionInFlight = false;
          if (!success) {
            SetBsrPanelStatus("Song installed, but the queue could not be updated: " + message);
            RenderBsrQueuePanel();
            return;
          }
          SetBsrPanelStatus("Installed to SongCore CustomLevels. Open Solo > Custom Levels to select it.");
          worldBsrRequests.erase(std::remove_if(worldBsrRequests.begin(), worldBsrRequests.end(),
              [&item](const BsrQueueRequest& request) { return request.id == item.id; }),
              worldBsrRequests.end());
          if (worldBsrSelectedIndex >= static_cast<int>(worldBsrRequests.size()))
            worldBsrSelectedIndex = static_cast<int>(worldBsrRequests.size()) - 1;
          RenderBsrQueuePanel();
          worldBsrNextPoll = 0.0f;
        });
      })) {
    requestInFlight = false;
    worldBsrActionInFlight = false;
    SetBsrPanelStatus("Could not start the Quest map download.");
    RenderBsrQueuePanel();
  }
}

static void EnsureBsrPanelDriver() {
  if (worldBsrDriverObject) return;
  auto* driverObject = UnityEngine::GameObject::New_ctor(StringW("RiftPulse BSR Queue Driver"));
  if (!driverObject) return;
  auto* driver = driverObject->AddComponent<RiftPulse::BsrPanelDriver*>();
  if (!driver) {
    UnityEngine::Object::Destroy(driverObject);
    return;
  }
  UnityEngine::Object::DontDestroyOnLoad(driverObject);
  worldBsrDriverObject = driverObject;
}

static void ShowBsrQueuePanel() {
  try {
    custom_types::Register::AutoRegister();
    worldBsrPanelRequested = true;
    EnsureBsrPanelDriver();
    if (!worldBsrDriverObject) {
      SetStatus("Could not start the 3D song queue on this headset.");
      return;
    }
    if (worldBsrPanel) worldBsrPanel->get_gameObject()->SetActive(true);
    SetStatus("Song request queue opened. Grab the top handle to move it.");
    if (isPaired) worldBsrNextPoll = 0.0f;
  } catch (...) {
    SetStatus("The 3D song queue could not start. The RiftPulse menu remains available.");
  }
}

static void RecenterBsrQueuePanel() {
  const auto posePath = BsrPanelPosePath();
  if (!posePath.empty()) std::remove(posePath.c_str());
  worldBsrPose = BsrPanelPose{};
  worldBsrHasSavedPose = false;
  if (worldBsrPanel && worldBsrPanel->get_gameObject())
    UnityEngine::Object::Destroy(worldBsrPanel->get_gameObject());
  worldBsrPanel = nullptr;
  worldBsrHeader = nullptr;
  worldBsrDetail = nullptr;
  worldBsrStatus = nullptr;
  worldBsrPrevious = nullptr;
  worldBsrNext = nullptr;
  worldBsrYes = nullptr;
  worldBsrNo = nullptr;
  worldBsrRows.clear();
  worldBsrPanelRequested = true;
  worldBsrNextPoll = 0.0f;
  ShowBsrQueuePanel();
}
void RiftPulse::RecenterBsrQueuePanel() {
  ::RecenterBsrQueuePanel();
}

void RiftPulse::ShowBsrQueuePanel() {
  ::ShowBsrQueuePanel();
}

void RiftPulse::BsrPanelDriver::Update() {
  if (!worldBsrPanelRequested) return;
  if (!worldBsrPanel && !EnsureBsrQueuePanel()) return;
  if (worldBsrPanel) worldBsrPanel->get_gameObject()->SetActive(true);
  SaveBsrPanelPose();
  const float now = UnityEngine::Time::get_realtimeSinceStartup();
  if (!isPaired) {
    SetBsrPanelStatus("Pair this headset at app.riftpulse.me to receive live song requests.");
    SetBsrPanelActionsEnabled(false);
    return;
  }
  if (now >= worldBsrNextPoll && !requestInFlight && !worldBsrActionInFlight) {
    worldBsrNextPoll = now + 5.0f;
    RefreshBsrQueuePanel();
  }
}

