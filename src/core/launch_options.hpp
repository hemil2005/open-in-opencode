#pragma once

#include <string>
#include <vector>

namespace oc {

// One entry in the Explorer context-menu submenu. Built-ins keep their canonical label and
// flags; custom entries use the user's label and flags. Both can be reordered and hidden.
struct LaunchOption {
  std::wstring id;
  std::wstring label;
  std::wstring flags;  // passed to `ocshell launch` after the folder; the opencode prefix is automatic
  bool builtin = false;
  bool hidden = false;
};

struct Settings;

std::vector<LaunchOption> DefaultLaunchOptions();

// Returns a stable, valid list: built-ins are always present, custom ids are unique, custom
// entries are limited to three, and malformed entries are dropped.
std::vector<LaunchOption> NormalizeLaunchOptions(const std::vector<LaunchOption>& options);

std::vector<LaunchOption> VisibleLaunchOptions(const Settings& settings);

const LaunchOption* FindLaunchOption(const std::vector<LaunchOption>& options, const std::wstring& id);
LaunchOption* FindLaunchOption(std::vector<LaunchOption>& options, const std::wstring& id);

bool ValidateLaunchLabel(const std::wstring& label, std::wstring* error);
bool ValidateLaunchFlags(const std::wstring& flags, std::wstring* error);

bool AddLaunchOption(Settings* settings, const std::wstring& label, const std::wstring& flags,
                     std::wstring* id, std::wstring* error);
bool UpdateLaunchOption(Settings* settings, const std::wstring& id, const std::wstring& label,
                        const std::wstring& flags, std::wstring* error);
bool RemoveLaunchOption(Settings* settings, const std::wstring& id, std::wstring* error);
bool MoveLaunchOption(Settings* settings, const std::wstring& id, bool up, std::wstring* error);
bool SetLaunchOptionHidden(Settings* settings, const std::wstring& id, bool hidden,
                           std::wstring* error);

std::wstring DescribeLaunchOptions(const std::vector<LaunchOption>& options);

}  // namespace oc
