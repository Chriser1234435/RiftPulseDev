#pragma once

#include "UnityEngine/MonoBehaviour.hpp"
#include "custom-types/shared/macros.hpp"
#include "custom-types/shared/register.hpp"

DECLARE_CLASS_CODEGEN(RiftPulse, ChatPanelDriver, UnityEngine::MonoBehaviour) {
  DECLARE_DEFAULT_CTOR();
  DECLARE_INSTANCE_METHOD(void, Update);
};

namespace RiftPulse {
void RequestChatPanelReposition();
}
