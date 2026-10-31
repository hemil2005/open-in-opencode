#include "core/settings.hpp"

#include "core/paths.hpp"

namespace oc {
namespace {

std::wstring ReadString(const json::Value& object, const wchar_t* key, const std::wstring& fallback) {
  const json::Value* value = object.Find(key);
  if (!value || !value->IsString()) return fallback;
  return value->AsString();
}

bool ReadBool(const json::Value& object, const wchar_t* key, bool fallback) {
  const json::Value* value = object.Find(key);
  if (!value) return fallback;
  return value->AsBool(fallback);
}

std::vector<std::wstring> ReadStringArray(const json::Value& object, const wchar_t* key) {
  std::vector<std::wstring> out;
  const json::Value* value = object.Find(key);
  if (!value || !value->IsArray()) return out;
  for (const auto& item : value->items()) {
    if (item.IsString()) out.push_back(item.AsString());
  }
  return out;
}

json::Value StringArray(const std::vector<std::wstring>& values) {
  json::Value array = json::Value::MakeArray();
  for (const auto& value : values) array.Push(json::Value::MakeString(value));
  return array;
}

std::vector<LaunchOption> ReadLaunchOptions(const json::Value& object) {
  std::vector<LaunchOption> out;
  const json::Value* value = object.Find(L"launchOptions");
  if (!value || !value->IsArray()) return out;

  for (const auto& item : value->items()) {
    if (!item.IsObject()) continue;
    LaunchOption option;
    option.id = ReadString(item, L"id", L"");
    option.label = ReadString(item, L"label", L"");
    option.flags = ReadString(item, L"flags", L"");
    option.builtin = ReadBool(item, L"builtin", false);
    option.hidden = ReadBool(item, L"hidden", false);
    out.push_back(option);
  }

  return out;
}

json::Value LaunchOptionsToJson(const std::vector<LaunchOption>& options) {
  json::Value array = json::Value::MakeArray();
  for (const auto& option : options) {
    json::Value item = json::Value::MakeObject();
    item.Set(L"id", json::Value::MakeString(option.id));
    item.Set(L"label", json::Value::MakeString(option.label));
    item.Set(L"flags", json::Value::MakeString(option.flags));
    item.Set(L"builtin", json::Value::MakeBool(option.builtin));
    item.Set(L"hidden", json::Value::MakeBool(option.hidden));
    array.Push(std::move(item));
  }
  return array;
}

}  // namespace

Settings DefaultSettings() { return Settings(); }

json::Value SettingsToJson(const Settings& settings) {
  json::Value root = json::Value::MakeObject();
  root.Set(L"version", json::Value::MakeNumber(settings.version));
  root.Set(L"binaryPath", json::Value::MakeString(settings.binaryPath));
  root.Set(L"updateUri", json::Value::MakeString(settings.updateUri));
  root.Set(L"continueFromProjectRoot", json::Value::MakeBool(settings.continueFromProjectRoot));
  root.Set(L"logging", json::Value::MakeBool(settings.logging));

  json::Value terminal = json::Value::MakeObject();
  terminal.Set(L"mode", json::Value::MakeString(settings.terminal.mode));
  terminal.Set(L"id", json::Value::MakeString(settings.terminal.id));
  terminal.Set(L"customPath", json::Value::MakeString(settings.terminal.customPath));
  terminal.Set(L"customArgs", StringArray(settings.terminal.customArgs));
  root.Set(L"terminal", std::move(terminal));

  root.Set(L"launchOptions",
           LaunchOptionsToJson(NormalizeLaunchOptions(settings.launchOptions)));
  return root;
}

Settings SettingsFromJson(const json::Value& value) {
  Settings settings = DefaultSettings();
  if (!value.IsObject()) return settings;

  if (const json::Value* version = value.Find(L"version"); version && version->type() == json::Type::Number) {
    settings.version = static_cast<int>(version->AsNumber(1));
  }
  settings.binaryPath = ReadString(value, L"binaryPath", settings.binaryPath);
  settings.updateUri = ReadString(value, L"updateUri", settings.updateUri);
  settings.continueFromProjectRoot =
      ReadBool(value, L"continueFromProjectRoot", settings.continueFromProjectRoot);
  settings.logging = ReadBool(value, L"logging", settings.logging);
  settings.launchOptions = NormalizeLaunchOptions(ReadLaunchOptions(value));

  if (const json::Value* terminal = value.Find(L"terminal"); terminal && terminal->IsObject()) {
    settings.terminal.mode = ReadString(*terminal, L"mode", settings.terminal.mode);
    settings.terminal.id = ReadString(*terminal, L"id", settings.terminal.id);
    settings.terminal.customPath = ReadString(*terminal, L"customPath", settings.terminal.customPath);
    settings.terminal.customArgs = ReadStringArray(*terminal, L"customArgs");
  }

  if (settings.terminal.mode != L"auto" && settings.terminal.mode != L"default" &&
      settings.terminal.mode != L"custom") {
    settings.terminal.mode = L"auto";
  }
  return settings;
}

bool LoadSettings(Settings* out, std::wstring* warning) {
  *out = DefaultSettings();
  std::wstring path = SettingsPath();
  if (path.empty()) return false;

  std::wstring text;
  if (!ReadTextFile(path, &text)) {
    // Migrate settings from the pre-rename folder once, then write them to the new path.
    std::wstring legacy = LegacySettingsPath();
    if (!legacy.empty() && ReadTextFile(legacy, &text)) {
      json::Value parsed;
      std::wstring error;
      if (json::Parse(text, &parsed, &error)) {
        *out = SettingsFromJson(parsed);
        SaveSettings(*out, nullptr);
        return true;
      }
    }
    return false;  // first run: defaults are correct
  }

  json::Value parsed;
  std::wstring error;
  if (!json::Parse(text, &parsed, &error)) {
    if (warning) *warning = L"settings.json is invalid (" + error + L"); using defaults";
    return false;
  }
  *out = SettingsFromJson(parsed);
  return true;
}

bool SaveSettings(const Settings& settings, std::wstring* error) {
  std::wstring directory = AppDataDirectory();
  if (directory.empty()) {
    if (error) *error = L"APPDATA is not set";
    return false;
  }
  if (!EnsureDirectory(directory) && GetLastError() != ERROR_ALREADY_EXISTS) {
    if (error) *error = L"cannot create " + directory;
    return false;
  }

  std::wstring text = json::Write(SettingsToJson(settings), true) + L"\n";
  if (!WriteTextFile(SettingsPath(), text)) {
    if (error) *error = L"cannot write " + SettingsPath();
    return false;
  }
  return true;
}

std::wstring DescribeSettings(const Settings& settings) {
  std::wstring out;
  out += L"settings file : " + SettingsPath() + L"\n";
  out += L"binaryPath    : " + (settings.binaryPath.empty() ? L"(auto)" : settings.binaryPath) + L"\n";
  out += L"updateUri     : " + (settings.updateUri.empty() ? L"(built-in)" : settings.updateUri) + L"\n";
  out += L"terminal.mode : " + settings.terminal.mode + L"\n";
  out += L"terminal.id   : " + (settings.terminal.id.empty() ? L"(first available)" : settings.terminal.id) + L"\n";
  if (settings.terminal.mode == L"custom") {
    out += L"terminal.exec : " + settings.terminal.customPath + L"\n";
    std::wstring args;
    for (const auto& arg : settings.terminal.customArgs) {
      if (!args.empty()) args += L" ";
      args += arg;
    }
    out += L"terminal.args : " + args + L"\n";
  }
  out += std::wstring(L"continueRoot  : ") + (settings.continueFromProjectRoot ? L"true" : L"false") + L"\n";
  out += std::wstring(L"logging       : ") + (settings.logging ? L"true" : L"false") + L"\n";
  out += L"launchOptions :\n";
  out += DescribeLaunchOptions(NormalizeLaunchOptions(settings.launchOptions));
  return out;
}

}  // namespace oc
