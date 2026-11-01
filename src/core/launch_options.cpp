#include "core/launch_options.hpp"

#include <algorithm>
#include <cwctype>

#include "core/settings.hpp"
#include "core/terminals.hpp"

namespace oc {
namespace {

constexpr size_t kMaxCustomOptions = 3;
constexpr size_t kMaxLabelLength = 60;
constexpr size_t kMaxFlagsLength = 300;

struct Builtin {
  const wchar_t* id;
  const wchar_t* label;
  const wchar_t* flags;
};

const Builtin kBuiltins[] = {
    {L"new", L"New session", L""},
    {L"continue", L"Continue last session", L"--continue"},
    {L"skip", L"Skip permission prompts", L"--auto"},
};
constexpr size_t kBuiltinCount = sizeof(kBuiltins) / sizeof(kBuiltins[0]);

int BuiltinIndex(const std::wstring& id) {
  for (size_t i = 0; i < kBuiltinCount; ++i) {
    if (id == kBuiltins[i].id) return static_cast<int>(i);
  }
  return -1;
}

LaunchOption CanonicalBuiltin(size_t index, bool hidden = false) {
  LaunchOption option;
  option.id = kBuiltins[index].id;
  option.label = kBuiltins[index].label;
  option.flags = kBuiltins[index].flags;
  option.builtin = true;
  option.hidden = hidden;
  return option;
}

std::wstring Trim(const std::wstring& value) {
  size_t start = 0;
  while (start < value.size() && std::iswspace(value[start])) ++start;
  size_t end = value.size();
  while (end > start && std::iswspace(value[end - 1])) --end;
  return value.substr(start, end - start);
}

std::wstring NextCustomId(const std::vector<LaunchOption>& options) {
  for (size_t i = 1; i <= kMaxCustomOptions; ++i) {
    std::wstring id = L"custom-" + std::to_wstring(i);
    if (!FindLaunchOption(options, id)) return id;
  }
  return std::wstring();
}

size_t CustomCount(const std::vector<LaunchOption>& options) {
  return static_cast<size_t>(
      std::count_if(options.begin(), options.end(), [](const LaunchOption& option) {
        return !option.builtin;
      }));
}

bool HasControlCharacters(const std::wstring& value) {
  for (wchar_t c : value) {
    if (c < 32 || c == 127) return true;
  }
  return false;
}

}  // namespace

std::vector<LaunchOption> DefaultLaunchOptions() {
  std::vector<LaunchOption> options;
  for (size_t i = 0; i < kBuiltinCount; ++i) options.push_back(CanonicalBuiltin(i));
  return options;
}

std::vector<LaunchOption> NormalizeLaunchOptions(const std::vector<LaunchOption>& options) {
  std::vector<LaunchOption> out;
  bool builtin_seen[kBuiltinCount] = {};
  size_t custom_count = 0;

  for (const auto& item : options) {
    const int builtin = BuiltinIndex(item.id);
    if (builtin >= 0) {
      if (builtin_seen[builtin]) continue;
      builtin_seen[builtin] = true;
      out.push_back(CanonicalBuiltin(static_cast<size_t>(builtin), item.hidden));
      continue;
    }

    if (custom_count >= kMaxCustomOptions) continue;

    LaunchOption option;
    option.id = Trim(item.id);
    option.label = Trim(item.label);
    option.flags = Trim(item.flags);
    option.hidden = item.hidden;
    option.builtin = false;

    if (!ValidateLaunchLabel(option.label, nullptr) ||
        !ValidateLaunchFlags(option.flags, nullptr)) {
      continue;
    }

    if (option.id.empty() || BuiltinIndex(option.id) >= 0 ||
        option.id.rfind(L"custom-", 0) != 0 || FindLaunchOption(out, option.id)) {
      option.id = NextCustomId(out);
      if (option.id.empty()) continue;
    }

    out.push_back(option);
    ++custom_count;
  }

  for (size_t i = 0; i < kBuiltinCount; ++i) {
    if (!builtin_seen[i]) out.push_back(CanonicalBuiltin(i));
  }

  return out;
}

std::vector<LaunchOption> VisibleLaunchOptions(const Settings& settings) {
  const std::vector<LaunchOption> options = NormalizeLaunchOptions(settings.launchOptions);
  std::vector<LaunchOption> visible;
  for (const auto& option : options) {
    if (!option.hidden) visible.push_back(option);
  }
  return visible;
}

const LaunchOption* FindLaunchOption(const std::vector<LaunchOption>& options,
                                     const std::wstring& id) {
  for (const auto& option : options) {
    if (option.id == id) return &option;
  }
  return nullptr;
}

LaunchOption* FindLaunchOption(std::vector<LaunchOption>& options, const std::wstring& id) {
  for (auto& option : options) {
    if (option.id == id) return &option;
  }
  return nullptr;
}

bool ValidateLaunchLabel(const std::wstring& label, std::wstring* error) {
  const std::wstring trimmed = Trim(label);
  if (trimmed.empty()) {
    if (error) *error = L"Enter a name for the launch option.";
    return false;
  }
  if (trimmed.size() > kMaxLabelLength) {
    if (error) *error = L"Launch option names are limited to 60 characters.";
    return false;
  }
  if (HasControlCharacters(trimmed)) {
    if (error) *error = L"Launch option names cannot contain tabs or line breaks.";
    return false;
  }
  return true;
}

bool ValidateLaunchFlags(const std::wstring& flags, std::wstring* error) {
  const std::wstring trimmed = Trim(flags);
  if (trimmed.empty()) {
    if (error) *error = L"Enter at least one argument, for example --continue or a subcommand.";
    return false;
  }
  if (trimmed.size() > kMaxFlagsLength) {
    if (error) *error = L"Flags are limited to 300 characters.";
    return false;
  }
  if (HasControlCharacters(trimmed)) {
    if (error) *error = L"Flags cannot contain tabs or line breaks.";
    return false;
  }

  size_t quotes = 0;
  for (wchar_t c : trimmed) {
    if (c == L'"') ++quotes;
  }
  if (quotes % 2 != 0) {
    if (error) *error = L"Flags contain an unmatched quote.";
    return false;
  }

  const std::vector<std::wstring> parsed = SplitArguments(trimmed);
  if (parsed.empty()) {
    if (error) *error = L"Enter at least one argument, for example --continue or a subcommand.";
    return false;
  }
  // Any argument is accepted: flags (--continue), options with values (--model fast), and
  // subcommands (mini). The opencode prefix is added automatically.
  return true;
}

bool AddLaunchOption(Settings* settings, const std::wstring& label, const std::wstring& flags,
                     std::wstring* id, std::wstring* error) {
  if (!settings) return false;
  settings->launchOptions = NormalizeLaunchOptions(settings->launchOptions);

  if (CustomCount(settings->launchOptions) >= kMaxCustomOptions) {
    if (error) *error = L"At most 3 custom launch options can be defined.";
    return false;
  }

  const std::wstring clean_label = Trim(label);
  const std::wstring clean_flags = Trim(flags);
  if (!ValidateLaunchLabel(clean_label, error)) return false;
  if (!ValidateLaunchFlags(clean_flags, error)) return false;

  const std::wstring option_id = NextCustomId(settings->launchOptions);
  if (option_id.empty()) {
    if (error) *error = L"At most 3 custom launch options can be defined.";
    return false;
  }

  LaunchOption option;
  option.id = option_id;
  option.label = clean_label;
  option.flags = clean_flags;
  option.builtin = false;
  option.hidden = false;
  settings->launchOptions.push_back(option);

  if (id) *id = option_id;
  return true;
}

bool UpdateLaunchOption(Settings* settings, const std::wstring& id, const std::wstring& label,
                        const std::wstring& flags, std::wstring* error) {
  if (!settings) return false;
  settings->launchOptions = NormalizeLaunchOptions(settings->launchOptions);

  LaunchOption* option = FindLaunchOption(settings->launchOptions, id);
  if (!option) {
    if (error) *error = L"Launch option not found: " + id;
    return false;
  }
  if (option->builtin) {
    if (error) *error = L"Built-in launch options cannot be renamed or edited.";
    return false;
  }

  const std::wstring clean_label = Trim(label);
  const std::wstring clean_flags = Trim(flags);
  if (!ValidateLaunchLabel(clean_label, error)) return false;
  if (!ValidateLaunchFlags(clean_flags, error)) return false;

  option->label = clean_label;
  option->flags = clean_flags;
  return true;
}

bool RemoveLaunchOption(Settings* settings, const std::wstring& id, std::wstring* error) {
  if (!settings) return false;
  settings->launchOptions = NormalizeLaunchOptions(settings->launchOptions);

  LaunchOption* option = FindLaunchOption(settings->launchOptions, id);
  if (!option) {
    if (error) *error = L"Launch option not found: " + id;
    return false;
  }
  if (option->builtin) {
    if (error) *error = L"Built-in launch options can only be hidden.";
    return false;
  }

  settings->launchOptions.erase(
      std::remove_if(settings->launchOptions.begin(), settings->launchOptions.end(),
                     [&](const LaunchOption& candidate) { return candidate.id == id; }),
      settings->launchOptions.end());
  return true;
}

bool MoveLaunchOption(Settings* settings, const std::wstring& id, bool up, std::wstring* error) {
  if (!settings) return false;
  settings->launchOptions = NormalizeLaunchOptions(settings->launchOptions);

  auto it = std::find_if(settings->launchOptions.begin(), settings->launchOptions.end(),
                         [&](const LaunchOption& option) { return option.id == id; });
  if (it == settings->launchOptions.end()) {
    if (error) *error = L"Launch option not found: " + id;
    return false;
  }

  const size_t index = static_cast<size_t>(it - settings->launchOptions.begin());
  if (up && index > 0) {
    std::swap(settings->launchOptions[index], settings->launchOptions[index - 1]);
  } else if (!up && index + 1 < settings->launchOptions.size()) {
    std::swap(settings->launchOptions[index], settings->launchOptions[index + 1]);
  }
  return true;
}

bool SetLaunchOptionHidden(Settings* settings, const std::wstring& id, bool hidden,
                           std::wstring* error) {
  if (!settings) return false;
  settings->launchOptions = NormalizeLaunchOptions(settings->launchOptions);

  LaunchOption* option = FindLaunchOption(settings->launchOptions, id);
  if (!option) {
    if (error) *error = L"Launch option not found: " + id;
    return false;
  }
  option->hidden = hidden;
  return true;
}

std::wstring DescribeLaunchOptions(const std::vector<LaunchOption>& options) {
  std::wstring out;
  for (const auto& option : options) {
    out += option.hidden ? L"  [ ] " : L"  [x] ";
    out += option.label;
    if (!option.flags.empty()) out += L" (" + option.flags + L")";
    if (!option.builtin) out += L"  custom";
    out += L"\n";
  }
  return out;
}

}  // namespace oc
