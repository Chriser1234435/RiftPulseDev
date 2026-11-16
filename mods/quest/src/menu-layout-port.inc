static HMUI::ImageView* CreateQuestLayoutSurface(
    UnityEngine::Transform* parent, UnityEngine::Vector2 size,
    UnityEngine::Color tint, bool visible) {
  if (!parent || !visible) return nullptr;
  auto* sprite = BSML::Utilities::ImageResources::GetWhitePixel();
  if (!sprite) sprite = BSML::Utilities::ImageResources::GetBlankSprite();
  if (!sprite) return nullptr;

  // Use Beat Saber's own HMUI ImageView and material for standalone menu
  // surfaces. Raw Unity Images in this view are rendering as un-tinted white.
  auto* image = BSML::Lite::CreateImage(
      parent, sprite, UnityEngine::Vector2(0.0f, 0.0f), size);
  if (!image) return nullptr;

  auto* rect = image->GetComponent<UnityEngine::RectTransform*>();
  if (rect) {
    rect->set_anchorMin(UnityEngine::Vector2(0.0f, 0.0f));
    rect->set_anchorMax(UnityEngine::Vector2(1.0f, 1.0f));
    rect->set_pivot(UnityEngine::Vector2(0.5f, 0.5f));
    rect->set_offsetMin(UnityEngine::Vector2(0.0f, 0.0f));
    rect->set_offsetMax(UnityEngine::Vector2(0.0f, 0.0f));
  }
  auto* layout = image->GetComponent<UnityEngine::UI::LayoutElement*>();
  if (!layout) layout = image->get_gameObject()->AddComponent<UnityEngine::UI::LayoutElement*>();
  if (layout) layout->set_ignoreLayout(true);

  image->set_useScriptableObjectColors(false);
  image->set_gradient(false);
  image->set_color(tint);
  image->set_raycastTarget(false);
  image->get_transform()->SetAsFirstSibling();
  TrackMainMenuObject(image->get_gameObject());
  return image;
}
static void ConfigureQuestLayoutElement(
    UnityEngine::GameObject* object, float preferredWidth, float preferredHeight) {
  if (!object) return;
  auto* element = object->GetComponent<UnityEngine::UI::LayoutElement*>();
  if (!element) element = object->AddComponent<UnityEngine::UI::LayoutElement*>();
  if (!element) return;
  element->set_preferredWidth(preferredWidth);
  element->set_preferredHeight(preferredHeight);
  element->set_flexibleWidth(0.0f);
  element->set_flexibleHeight(0.0f);
}

static UnityEngine::UI::VerticalLayoutGroup* CreateQuestVerticalLayout(
    UnityEngine::Component* parent, const std::string& name,
    float width, float height, float spacing,
    UnityEngine::Color surfaceColor, bool drawSurface, int padding) {
  ArrayW<System::Type*> componentTypes{
      static_cast<System::Type*>(csTypeOf(UnityEngine::RectTransform*)),
      static_cast<System::Type*>(csTypeOf(UnityEngine::UI::VerticalLayoutGroup*)),
      static_cast<System::Type*>(csTypeOf(UnityEngine::UI::LayoutElement*))
  };
  auto* object = UnityEngine::GameObject::New_ctor(StringW(name), componentTypes);
  if (!object) return nullptr;
  auto* rect = object->GetComponent<UnityEngine::RectTransform*>();
  auto* group = object->GetComponent<UnityEngine::UI::VerticalLayoutGroup*>();
  if (!rect || !group) {
    UnityEngine::Object::Destroy(object);
    return nullptr;
  }
  rect->SetParent(parent->get_transform(), false);
  rect->set_anchorMin(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchorMax(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_pivot(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchoredPosition(UnityEngine::Vector2(0.0f, 0.0f));
  rect->set_sizeDelta(UnityEngine::Vector2(width, height));
  CreateQuestLayoutSurface(object->get_transform(), UnityEngine::Vector2(width, height), surfaceColor, drawSurface);
  group->set_spacing(spacing);
  group->set_childControlWidth(true);
  group->set_childControlHeight(false);
  group->set_childForceExpandWidth(true);
  group->set_childForceExpandHeight(false);
  group->set_padding(UnityEngine::RectOffset::New_ctor(padding, padding, padding, padding));
  ConfigureQuestLayoutElement(object, width, height);
  TrackMainMenuObject(object);
  return group;
}

static UnityEngine::UI::HorizontalLayoutGroup* CreateQuestHorizontalLayout(
    UnityEngine::Component* parent, const std::string& name,
    float width, float height, float spacing,
    UnityEngine::Color surfaceColor, bool drawSurface, int padding) {
  ArrayW<System::Type*> componentTypes{
      static_cast<System::Type*>(csTypeOf(UnityEngine::RectTransform*)),
      static_cast<System::Type*>(csTypeOf(UnityEngine::UI::HorizontalLayoutGroup*)),
      static_cast<System::Type*>(csTypeOf(UnityEngine::UI::LayoutElement*))
  };
  auto* object = UnityEngine::GameObject::New_ctor(StringW(name), componentTypes);
  if (!object) return nullptr;
  auto* rect = object->GetComponent<UnityEngine::RectTransform*>();
  auto* group = object->GetComponent<UnityEngine::UI::HorizontalLayoutGroup*>();
  if (!rect || !group) {
    UnityEngine::Object::Destroy(object);
    return nullptr;
  }
  rect->SetParent(parent->get_transform(), false);
  rect->set_anchorMin(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchorMax(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_pivot(UnityEngine::Vector2(0.5f, 0.5f));
  rect->set_anchoredPosition(UnityEngine::Vector2(0.0f, 0.0f));
  rect->set_sizeDelta(UnityEngine::Vector2(width, height));
  CreateQuestLayoutSurface(object->get_transform(), UnityEngine::Vector2(width, height), surfaceColor, drawSurface);
  group->set_spacing(spacing);
  group->set_childControlWidth(false);
  group->set_childControlHeight(true);
  group->set_childForceExpandWidth(false);
  group->set_childForceExpandHeight(true);
  group->set_padding(UnityEngine::RectOffset::New_ctor(padding, padding, padding, padding));
  ConfigureQuestLayoutElement(object, width, height);
  TrackMainMenuObject(object);
  return group;
}

static HMUI::CurvedTextMeshPro* CreateQuestLayoutText(
    UnityEngine::Component* parent, StringW text, float fontSize,
    float width, float height,
    TMPro::TextAlignmentOptions alignment = TMPro::TextAlignmentOptions::Left) {
  auto* label = BSML::Lite::CreateText(
      parent->get_transform(), text, fontSize, UnityEngine::Vector2(0.0f, 0.0f),
      UnityEngine::Vector2(width, height));
  if (!label) return nullptr;
  label->set_alignment(alignment);
  ConfigureQuestLayoutElement(label->get_gameObject(), width, height);
  TrackMainMenuObject(label->get_gameObject());
  return label;
}

static UnityEngine::UI::Button* CreateQuestLayoutButton(
    UnityEngine::Component* parent, StringW text, float width, float height,
    std::function<void()> onClick) {
  auto* button = BSML::Lite::CreateUIButton(
      parent->get_transform(), text, "PracticeButton",
      UnityEngine::Vector2(0.0f, 0.0f), UnityEngine::Vector2(width, height),
      std::move(onClick));
  if (!button) return nullptr;
  ConfigureQuestLayoutElement(button->get_gameObject(), width, height);
  BSML::Lite::ToggleButtonWordWrapping(button, false);
  BSML::Lite::SetButtonTextSize(button, 2.35f);
  TrackMainMenuObject(button->get_gameObject());
  return button;
}

static void BuildRiftPulseMenuPcvrLayout(UnityEngine::Transform* root) {
  const auto clear = UnityEngine::Color(0.0f, 0.0f, 0.0f, 0.0f);
  const auto surface = UnityEngine::Color(0.022f, 0.035f, 0.068f, 0.985f);
  const auto headerSurface = UnityEngine::Color(0.035f, 0.055f, 0.105f, 0.99f);

  // A wider, taller Quest-first layout with short copy and deliberately
  // generous control rows. The previous compact grid caused labels and
  // buttons to collide at headset scale.
  auto* page = CreateQuestVerticalLayout(
      root, "RiftPulse Quest Command Page", 82.0f, 68.0f,
      0.9f, clear, false, 2);
  if (!page) return;

  auto* header = CreateQuestHorizontalLayout(
      page, "RiftPulse Brand Header", 78.0f, 7.0f,
      1.0f, headerSurface, true, 0);
  if (header) {
    auto* brand = CreateQuestVerticalLayout(
        header, "RiftPulse Brand Block", 38.0f, 6.2f,
        0.1f, clear, false, 0);
    auto* game = CreateQuestVerticalLayout(
        header, "RiftPulse Game Descriptor", 38.0f, 6.2f,
        0.1f, clear, false, 0);
    if (brand) {
      heading = CreateQuestLayoutText(
          brand, "RIFTPULSE", 4.3f, 37.0f, 3.5f);
      instructions = CreateQuestLayoutText(
          brand, "QUEST STREAM CONTROL", 2.2f, 37.0f, 2.0f);
    }
    if (game) {
      CreateQuestLayoutText(
          game, "BEAT SABER / QUEST", 2.45f, 37.0f, 2.4f,
          TMPro::TextAlignmentOptions::Right);
      CreateQuestLayoutText(
          game, "CHAT AND SONG REQUESTS", 2.05f, 37.0f, 2.0f,
          TMPro::TextAlignmentOptions::Right);
    }
  }

  auto* body = CreateQuestHorizontalLayout(
      page, "RiftPulse Two Column Body", 78.0f, 48.0f,
      1.0f, clear, false, 0);
  if (body) {
    auto* leftColumn = CreateQuestVerticalLayout(
        body, "RiftPulse Left Column", 38.5f, 48.0f,
        0.8f, clear, false, 0);
    auto* rightColumn = CreateQuestVerticalLayout(
        body, "RiftPulse Right Column", 38.5f, 48.0f,
        0.8f, clear, false, 0);

    if (leftColumn) {
      auto* deviceCard = CreateQuestVerticalLayout(
          leftColumn, "01 Device Link Card", 38.5f, 29.5f,
          0.35f, surface, true, 1);
      if (deviceCard) {
        CreateQuestLayoutText(
            deviceCard, "01 / DEVICE LINK", 3.25f, 36.5f, 2.8f);
        CreateQuestLayoutText(
            deviceCard, "PAIRING CODE", 2.15f, 36.5f, 1.7f,
            TMPro::TextAlignmentOptions::Center);
        const StringW displayCode =
            pairingCode.empty() ? StringW("-----") : StringW(pairingCode);
        pairingCodeLabel = CreateQuestLayoutText(
            deviceCard, displayCode, 5.8f, 36.5f, 4.4f,
            TMPro::TextAlignmentOptions::Center);
        overview = CreateQuestLayoutText(
            deviceCard, "Generate a code to pair this headset.",
            2.05f, 36.5f, 2.2f,
            TMPro::TextAlignmentOptions::Center);
        codeButton = CreateQuestLayoutButton(
            deviceCard, "GENERATE CODE", 36.2f, 2.9f,
            []() { GeneratePairingCode(); });
        checkButton = CreateQuestLayoutButton(
            deviceCard, "CHECK LINK STATUS", 36.2f, 2.9f,
            []() { CheckPairingStatus(); });
        CreateQuestLayoutText(
            deviceCard, "Enter your five-digit code at app.riftpulse.me.",
            1.85f, 36.5f, 1.7f,
            TMPro::TextAlignmentOptions::Center);
      }

      auto* spatialCard = CreateQuestVerticalLayout(
          leftColumn, "04 Chat Display Card", 38.5f, 16.0f,
          0.4f, surface, true, 1);
      if (spatialCard) {
        CreateQuestLayoutText(
            spatialCard, "04 / CHAT DISPLAY", 3.0f, 36.5f, 2.6f);
        CreateQuestLayoutText(
            spatialCard, "Move and resize your floating chat panel.",
            2.0f, 36.5f, 2.4f);
        CreateQuestLayoutButton(
            spatialCard, "DISPLAY SETTINGS", 36.2f, 2.8f,
            []() { ShowChatPanelSettingsModal(); });
        CreateQuestLayoutButton(
            spatialCard, "RE-CENTER PANEL", 36.2f, 2.8f,
            []() { ShowWorldChatPanel(); });
      }
    }

    if (rightColumn) {
      auto* chatCard = CreateQuestVerticalLayout(
          rightColumn, "02 Live Chat Card", 38.5f, 22.8f,
          0.6f, surface, true, 1);
      if (chatCard) {
        CreateQuestLayoutText(
            chatCard, "02 / LIVE CHAT", 3.25f, 36.5f, 2.9f);
        CreateQuestLayoutText(
            chatCard, "Messages and supported stream events from your connected platforms.",
            2.1f, 36.5f, 4.0f);
        chatButton = CreateQuestLayoutButton(
            chatCard, "CHAT MODULE: LOCKED", 36.2f, 3.0f,
            []() { ToggleChat(); });
      }

      auto* songCard = CreateQuestVerticalLayout(
          rightColumn, "03 Song Requests Card", 38.5f, 22.8f,
          0.6f, surface, true, 1);
      if (songCard) {
        CreateQuestLayoutText(
            songCard, "03 / SONG REQUESTS", 3.1f, 36.5f, 2.9f);
        CreateQuestLayoutText(
            songCard, "Let viewers request songs through connected chat.",
            2.1f, 36.5f, 4.0f);
        bsrButton = CreateQuestLayoutButton(
            songCard, "SONG REQUESTS: LOCKED", 36.2f, 3.0f,
            []() { ToggleBsr(); });
      }
    }
  }

  auto* footer = CreateQuestVerticalLayout(
      page, "RiftPulse Device Status Footer", 78.0f, 4.0f,
      0.1f, headerSurface, true, 0);
  if (footer) {
    modulePreviewStatusLabel = CreateQuestLayoutText(
        footer, "DEVICE STATUS / PAIR THIS HEADSET TO SYNC ITS MODULES.",
        1.75f, 76.0f, 2.0f,
        TMPro::TextAlignmentOptions::Center);
  }
}