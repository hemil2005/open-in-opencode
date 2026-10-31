#pragma once

#include <string>
#include <vector>

#include "core/json.hpp"

namespace oc {

struct TerminalChoice {
  std::wstring mode = L"auto";  // auto | default | custom
  std::wstring id;              // terminal id when mode == auto
  std::wstring customPath;      // executable when mode == custom
  std::vector<std::wstring> customArgs;  // argument template for a custom terminal
};

struct Settings {
  int version = 1;
  std::wstring binaryPath;  // empty means auto-discovery
  std::wstring updateUri;   // empty means use the URI baked in at build time
  TerminalChoice terminal;
  bool continueFromProjectRoot = false;
  bool logging = false;
};

Settings DefaultSettings();

// Missing file yields defaults and no error. Malformed file yields defaults plus a warning so
// the caller can surface it without failing the launch.
bool LoadSettings(Settings* out, std::wstring* warning);
bool SaveSettings(const Settings& settings, std::wstring* error);

json::Value SettingsToJson(const Settings& settings);
Settings SettingsFromJson(const json::Value& value);

// Human-readable summary for `ocshell settings list`.
std::wstring DescribeSettings(const Settings& settings);

}  // namespace oc
