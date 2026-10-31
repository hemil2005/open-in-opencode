// ocshell.exe - settings, diagnostics and the launcher used by the Windows 10 registry verbs.
#include <windows.h>
#include <shobjidl.h>
#include <shlobj.h>

#include <cwchar>
#include <string>
#include <vector>

#include "generated/identity.h"
#include "core/binary.hpp"
#include "core/json.hpp"
#include "core/launch.hpp"
#include "core/log.hpp"
#include "core/paths.hpp"
#include "core/registry.hpp"
#include "core/settings.hpp"
#include "core/terminals.hpp"
#include "core/update.hpp"

namespace {

void Write(const std::wstring& text, bool to_error = false) {
  HANDLE handle = GetStdHandle(to_error ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);
  std::string utf8 = oc::Utf8FromWide(text);
  DWORD written = 0;
  WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
}

void Line(const std::wstring& text = L"") { Write(text + L"\r\n"); }

void Error(const std::wstring& text) { Write(text + L"\r\n", true); }

std::vector<std::wstring> Arguments() {
  std::vector<std::wstring> out;
  int count = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!argv) return out;
  for (int i = 0; i < count; ++i) out.emplace_back(argv[i]);
  LocalFree(argv);
  return out;
}

bool HasFlag(const std::vector<std::wstring>& arguments, const std::wstring& flag) {
  for (const auto& argument : arguments) {
    if (argument == flag) return true;
  }
  return false;
}

int Fail(const std::wstring& message) {
  Error(L"error: " + message);
  return 1;
}

int CommandLaunch(const std::vector<std::wstring>& arguments) {
  std::wstring directory;
  std::wstring flags;

  for (size_t i = 2; i < arguments.size(); ++i) {
    const std::wstring& argument = arguments[i];
    if (argument == L"--continue") {
      flags += L" --continue";
    } else if (argument == L"--auto") {
      flags += L" --auto";
    } else if (directory.empty()) {
      directory = argument;
    }
  }

  if (directory.empty()) return Fail(L"launch requires a directory");

  oc::Settings settings;
  std::wstring warning;
  oc::LoadSettings(&settings, &warning);
  oc::SetVerboseLogging(settings.logging);
  if (!warning.empty()) oc::Log(oc::LogLevel::Warn, warning);

  std::wstring detail;
  std::wstring error;
  if (!oc::Launch(settings, directory, flags, &detail, &error)) {
    oc::Log(oc::LogLevel::Error, error);
    return Fail(error);
  }
  oc::Log(oc::LogLevel::Info, L"launch " + detail);
  return 0;
}

int CommandSettingsList(const std::vector<std::wstring>& arguments) {
  oc::Settings settings;
  std::wstring warning;
  oc::LoadSettings(&settings, &warning);
  if (!warning.empty()) Error(L"warning: " + warning);

  if (HasFlag(arguments, L"--json")) {
    Line(oc::json::Write(oc::SettingsToJson(settings), true));
  } else {
    Write(oc::DescribeSettings(settings));
  }
  return 0;
}

bool ParseBool(const std::wstring& value, bool* out) {
  if (value == L"true" || value == L"1" || value == L"yes" || value == L"on") {
    *out = true;
    return true;
  }
  if (value == L"false" || value == L"0" || value == L"no" || value == L"off") {
    *out = false;
    return true;
  }
  return false;
}

int CommandSettingsSet(const std::vector<std::wstring>& arguments) {
  if (arguments.size() < 5) {
    return Fail(L"usage: ocshell settings set <key> <value>");
  }
  const std::wstring& key = arguments[3];
  std::wstring value = arguments[4];
  for (size_t i = 5; i < arguments.size(); ++i) value += L" " + arguments[i];

  oc::Settings settings;
  std::wstring warning;
  oc::LoadSettings(&settings, &warning);

  if (key == L"binaryPath") {
    settings.binaryPath = value == L"-" ? L"" : value;
  } else if (key == L"updateUri") {
    settings.updateUri = value == L"-" ? L"" : value;
  } else if (key == L"terminal.mode") {
    if (value != L"auto" && value != L"default" && value != L"custom") {
      return Fail(L"terminal.mode must be auto, default or custom");
    }
    settings.terminal.mode = value;
  } else if (key == L"terminal.id") {
    settings.terminal.id = value == L"-" ? L"" : value;
  } else if (key == L"terminal.customPath") {
    settings.terminal.customPath = value == L"-" ? L"" : value;
  } else if (key == L"terminal.customArgs") {
    settings.terminal.customArgs = oc::SplitArguments(value);
  } else if (key == L"continueFromProjectRoot") {
    bool parsed = false;
    if (!ParseBool(value, &parsed)) return Fail(L"expected true or false");
    settings.continueFromProjectRoot = parsed;
  } else if (key == L"logging") {
    bool parsed = false;
    if (!ParseBool(value, &parsed)) return Fail(L"expected true or false");
    settings.logging = parsed;
  } else {
    return Fail(L"unknown key: " + key);
  }

  std::wstring error;
  if (!oc::SaveSettings(settings, &error)) return Fail(error);
  Line(L"updated " + key);
  return 0;
}

int CommandSettingsTerminals(const std::vector<std::wstring>& arguments) {
  std::vector<oc::Terminal> terminals = oc::DiscoverTerminals();
  if (HasFlag(arguments, L"--json")) {
    oc::json::Value root = oc::json::Value::MakeArray();
    for (const auto& terminal : terminals) {
      oc::json::Value item = oc::json::Value::MakeObject();
      item.Set(L"id", oc::json::Value::MakeString(terminal.id));
      item.Set(L"name", oc::json::Value::MakeString(terminal.name));
      item.Set(L"path", oc::json::Value::MakeString(terminal.path));
      item.Set(L"supported", oc::json::Value::MakeBool(terminal.supported));
      root.Push(std::move(item));
    }
    Line(oc::json::Write(root, true));
    return 0;
  }

  if (terminals.empty()) {
    Line(L"no terminals detected");
    return 0;
  }
  for (const auto& terminal : terminals) {
    std::wstring mark = terminal.supported ? L"  " : L"* ";
    Line(L"  " + mark + terminal.id + L"  (" + terminal.name + L")  " + terminal.path +
         (terminal.supported ? L"" : L"   [detected, no template]"));
  }
  Line();
  Line(L"* = detected but no command template; select another or use terminal.mode=custom");
  return 0;
}

int CommandSettingsLocate() {
  if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE))) {
    return Fail(L"CoInitializeEx failed");
  }

  IFileOpenDialog* dialog = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog));
  if (FAILED(hr) || !dialog) {
    CoUninitialize();
    return Fail(L"could not open the file picker");
  }

  COMDLG_FILTERSPEC filters[] = {{L"opencode", L"opencode.exe"}, {L"Programs", L"*.exe"}};
  dialog->SetFileTypes(2, filters);
  dialog->SetTitle(L"Locate opencode.exe");

  int status = 1;
  if (SUCCEEDED(dialog->Show(nullptr))) {
    IShellItem* item = nullptr;
    if (SUCCEEDED(dialog->GetResult(&item)) && item) {
      PWSTR path = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
        oc::Settings settings;
        std::wstring warning;
        oc::LoadSettings(&settings, &warning);
        settings.binaryPath = path;
        std::wstring error;
        if (oc::SaveSettings(settings, &error)) {
          Line(std::wstring(L"saved: ") + path);
          status = 0;
        } else {
          Error(L"error: " + error);
        }
        CoTaskMemFree(path);
      }
      item->Release();
    }
  }
  dialog->Release();
  CoUninitialize();
  return status;
}

std::wstring PackageState() {
  const std::wstring root =
      L"SOFTWARE\\Classes\\PackagedCom\\Package";
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, root.c_str(), 0, KEY_READ, &key) != ERROR_SUCCESS) {
    return L"unknown";
  }
  std::wstring found;
  for (DWORD index = 0;; ++index) {
    wchar_t name[512] = {};
    DWORD length = 512;
    if (RegEnumKeyExW(key, index, name, &length, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    if (std::wstring(name).find(OC_IDENTITY_NAME) == 0) {
      found = name;
      break;
    }
  }
  RegCloseKey(key);
  return found.empty() ? L"not installed" : found;
}

std::wstring CertificateState() {
  std::wstring publisher = OC_IDENTITY_PUBLISHER;
  std::wstring cn = publisher;
  if (cn.rfind(L"CN=", 0) == 0) cn = cn.substr(3);

  HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0,
                                   CERT_SYSTEM_STORE_LOCAL_MACHINE | CERT_STORE_READONLY_FLAG,
                                   L"TrustedPeople");
  if (!store) return L"unknown (cannot open LocalMachine\\TrustedPeople)";

  bool found = false;
  for (PCCERT_CONTEXT context = nullptr;
       (context = CertEnumCertificatesInStore(store, context)) != nullptr;) {
    wchar_t name[512] = {};
    if (CertGetNameStringW(context, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nullptr, name, 512) > 1) {
      if (_wcsicmp(name, cn.c_str()) == 0) {
        found = true;
        break;
      }
    }
  }
  CertCloseStore(store, 0);
  return found ? L"trusted" : L"not trusted (run the installer, or import the .cer)";
}

int CommandDoctor(const std::vector<std::wstring>& arguments) {
  oc::Settings settings;
  std::wstring warning;
  bool loaded = oc::LoadSettings(&settings, &warning);

  std::wstring binary;
  std::wstring source;
  bool has_binary = oc::ResolveBinaryPath(settings, &binary, &source);

  std::vector<oc::Terminal> terminals = oc::DiscoverTerminals();
  const oc::Terminal* chosen = nullptr;
  if (settings.terminal.mode == L"auto") {
    if (!settings.terminal.id.empty()) chosen = oc::FindTerminal(terminals, settings.terminal.id);
    if (!chosen || !chosen->supported) {
      for (const auto& terminal : terminals) {
        if (terminal.supported) {
          chosen = &terminal;
          break;
        }
      }
    }
  }

  std::wstring package = PackageState();
  std::wstring certificate = CertificateState();

  if (HasFlag(arguments, L"--json")) {
    oc::json::Value root = oc::json::Value::MakeObject();
    root.Set(L"version", oc::json::Value::MakeString(OC_IDENTITY_VERSION));
    root.Set(L"settingsPath", oc::json::Value::MakeString(oc::SettingsPath()));
    root.Set(L"settingsLoaded", oc::json::Value::MakeBool(loaded));
    root.Set(L"settingsWarning", oc::json::Value::MakeString(warning));
    root.Set(L"binaryFound", oc::json::Value::MakeBool(has_binary));
    root.Set(L"binaryPath", oc::json::Value::MakeString(binary));
    root.Set(L"binarySource", oc::json::Value::MakeString(source));
    root.Set(L"package", oc::json::Value::MakeString(package));
    root.Set(L"certificate", oc::json::Value::MakeString(certificate));
    root.Set(L"terminalCount", oc::json::Value::MakeNumber(static_cast<double>(terminals.size())));
    root.Set(L"terminal", oc::json::Value::MakeString(chosen ? chosen->id : L""));
    Line(oc::json::Write(root, true));
    return has_binary ? 0 : 1;
  }

  Line(L"OpenCodeShell " + std::wstring(OC_IDENTITY_VERSION));
  Line(L"package      : " + package);
  Line(L"certificate  : " + certificate);
  Line(L"settings     : " + oc::SettingsPath() + (loaded ? L"" : L"  (defaults)"));
  if (!warning.empty()) Line(L"               " + warning);
  Line(L"opencode     : " + (has_binary ? binary + L"  (" + source + L")" : L"NOT FOUND"));
  Line(L"terminals    : " + std::to_wstring(terminals.size()) + L" detected, using " +
       (chosen ? chosen->id : L"direct launch"));
  Line(L"log          : " + oc::LogPath());
  return has_binary ? 0 : 1;
}

int CommandSelfTest() {
  int failures = 0;
  auto check = [&](const wchar_t* name, bool passed) {
    Line(std::wstring(passed ? L"PASS  " : L"FAIL  ") + name);
    if (!passed) ++failures;
  };

  // JSON round trip
  {
    oc::json::Value parsed;
    std::wstring error;
    bool ok = oc::json::Parse(L"{\"a\":1,\"b\":[true,\"x\"],\"c\":null}", &parsed, &error);
    check(L"json parse", ok);
    std::wstring text = oc::json::Write(parsed, false);
    oc::json::Value again;
    check(L"json round trip", oc::json::Parse(text, &again, &error) && again.Find(L"a") != nullptr);
  }

  // Settings round trip
  {
    oc::Settings settings;
    settings.binaryPath = L"C:\\Program Files\\opencode\\opencode.exe";
    settings.terminal.mode = L"custom";
    settings.terminal.customPath = L"C:\\term.exe";
    settings.terminal.customArgs = {L"--dir", L"{dir}", L"-e", L"{command}"};
    settings.continueFromProjectRoot = true;
    settings.logging = true;

    oc::Settings restored = oc::SettingsFromJson(oc::SettingsToJson(settings));
    check(L"settings round trip", restored.binaryPath == settings.binaryPath &&
                                      restored.terminal.mode == L"custom" &&
                                      restored.terminal.customArgs.size() == 4 &&
                                      restored.continueFromProjectRoot &&
                                      restored.logging);
  }

  // Argument splitting and command line quoting
  {
    std::vector<std::wstring> split = oc::SplitArguments(L"a \"b c\" d");
    check(L"split arguments", split.size() == 3 && split[1] == L"b c");

    std::wstring quoted = oc::JoinCommandLine({L"C:\\a b\\x.exe", L"plain"});
    check(L"quote spaced path", quoted == L"\"C:\\a b\\x.exe\" plain");

    std::wstring trailing = oc::JoinCommandLine({L"C:\\a b\\"});
    check(L"quote trailing backslash", trailing == L"\"C:\\a b\\\\\"");
  }

  // Terminal templates
  {
    oc::Terminal alacritty;
    alacritty.id = L"alacritty";
    alacritty.path = L"C:\\term\\alacritty.exe";
    alacritty.args = {L"--working-directory", L"{dir}", L"-e", L"{command}"};

    std::vector<std::wstring> argv;
    std::wstring error;
    bool ok = oc::BuildTerminalArgv(alacritty, L"C:\\work", {L"C:\\oc.exe", L"--continue"}, &argv, &error);
    check(L"alacritty template", ok && argv.size() == 6 && argv[1] == L"--working-directory" &&
                                     argv[2] == L"C:\\work" && argv[5] == L"--continue");

    oc::Terminal cmd;
    cmd.id = L"cmd";
    cmd.path = L"C:\\Windows\\System32\\cmd.exe";
    cmd.args = {L"/k", L"{commandline}"};
    ok = oc::BuildTerminalArgv(cmd, L"C:\\work", {L"C:\\oc.exe"}, &argv, &error);
    check(L"cmd template", ok && argv.size() == 3 && argv[2] == L"C:\\oc.exe");
  }

  // Unsupported terminal is reported, not silently launched
  {
    oc::Terminal tabby;
    tabby.id = L"tabby";
    tabby.path = L"C:\\tabby.exe";
    tabby.supported = false;
    std::vector<std::wstring> argv;
    std::wstring error;
    check(L"unsupported terminal rejected", !oc::BuildTerminalArgv(tabby, L"C:\\work", {L"x"}, &argv, &error));
  }

  Line();
  Line(failures == 0 ? L"all checks passed" : std::to_wstring(failures) + L" check(s) failed");
  return failures == 0 ? 0 : 1;
}

std::wstring EncodePowerShell(const std::wstring& script) {
  // PowerShell -EncodedCommand takes base64 of UTF-16LE. Avoids every quoting problem with
  // paths containing spaces or quotes.
  std::vector<unsigned char> bytes;
  bytes.reserve(script.size() * 2);
  for (wchar_t c : script) {
    bytes.push_back(static_cast<unsigned char>(c & 0xFF));
    bytes.push_back(static_cast<unsigned char>((c >> 8) & 0xFF));
  }

  static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < bytes.size(); i += 3) {
    const unsigned v = (static_cast<unsigned>(bytes[i]) << 16) |
                       (i + 1 < bytes.size() ? static_cast<unsigned>(bytes[i + 1]) << 8 : 0) |
                       (i + 2 < bytes.size() ? static_cast<unsigned>(bytes[i + 2]) : 0);
    out.push_back(table[(v >> 18) & 63]);
    out.push_back(table[(v >> 12) & 63]);
    out.push_back(i + 1 < bytes.size() ? table[(v >> 6) & 63] : '=');
    out.push_back(i + 2 < bytes.size() ? table[v & 63] : '=');
  }
  return std::wstring(out.begin(), out.end());
}

std::wstring ResolveUpdateUri(const oc::Settings& settings) {
  if (!settings.updateUri.empty()) return settings.updateUri;
  return OC_IDENTITY_UPDATE_URI;
}

int CommandUpdateCheck(const std::vector<std::wstring>& arguments) {
  oc::Settings settings;
  std::wstring warning;
  oc::LoadSettings(&settings, &warning);

  const std::wstring uri = ResolveUpdateUri(settings);
  if (uri.empty()) {
    return Fail(L"no update source configured; set updateUri with `ocshell settings set updateUri <url>`");
  }

  oc::UpdateInfo info;
  std::wstring error;
  if (!oc::FetchUpdateInfo(uri, &info, &error)) return Fail(error);

  const bool available = oc::CompareVersions(info.version, OC_IDENTITY_VERSION) > 0;

  if (HasFlag(arguments, L"--json")) {
    oc::json::Value root = oc::json::Value::MakeObject();
    root.Set(L"current", oc::json::Value::MakeString(OC_IDENTITY_VERSION));
    root.Set(L"available", oc::json::Value::MakeString(info.version));
    root.Set(L"updateAvailable", oc::json::Value::MakeBool(available));
    root.Set(L"bundleUri", oc::json::Value::MakeString(info.bundleUri));
    root.Set(L"installerUri", oc::json::Value::MakeString(info.installerUri));
    Line(oc::json::Write(root, true));
    return 0;
  }

  Line(L"current   : " + std::wstring(OC_IDENTITY_VERSION));
  Line(L"available : " + info.version);
  Line(L"source    : " + uri);
  Line(available ? L"update available: run `ocshell update apply`" : L"up to date");
  return 0;
}

int CommandUpdateApply() {
  oc::Settings settings;
  std::wstring warning;
  oc::LoadSettings(&settings, &warning);

  const std::wstring uri = ResolveUpdateUri(settings);
  if (uri.empty()) {
    return Fail(L"no update source configured; set updateUri with `ocshell settings set updateUri <url>`");
  }

  oc::UpdateInfo info;
  std::wstring error;
  if (!oc::FetchUpdateInfo(uri, &info, &error)) return Fail(error);

  if (oc::CompareVersions(info.version, OC_IDENTITY_VERSION) <= 0) {
    Line(L"already up to date (" + std::wstring(OC_IDENTITY_VERSION) + L")");
    return 0;
  }

  wchar_t temp[MAX_PATH] = {};
  GetTempPathW(MAX_PATH, temp);
  const std::wstring bundle = std::wstring(temp) + L"OpenCodeShell_" + info.version + L".msixbundle";

  Line(L"downloading " + info.bundleUri);
  if (!oc::DownloadFile(info.bundleUri, bundle, &error)) return Fail(error);

  Line(L"installing " + info.version);
  const std::wstring script = L"Add-AppxPackage -Path '" + bundle + L"'";
  std::wstring command = L"powershell.exe -NoProfile -NonInteractive -EncodedCommand " +
                         EncodePowerShell(script);

  // Capture PowerShell output: an exit code alone is not diagnosable.
  wchar_t temp_dir[MAX_PATH] = {};
  GetTempPathW(MAX_PATH, temp_dir);
  const std::wstring console_log = std::wstring(temp_dir) + L"OpenCodeShell_update.log";

  SECURITY_ATTRIBUTES inherit;
  ZeroMemory(&inherit, sizeof(inherit));
  inherit.nLength = sizeof(inherit);
  inherit.bInheritHandle = TRUE;
  HANDLE output = CreateFileW(console_log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inherit, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  if (output != INVALID_HANDLE_VALUE) {
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdOutput = output;
    startup.hStdError = output;
  }

  PROCESS_INFORMATION process;
  ZeroMemory(&process, sizeof(process));
  if (!CreateProcessW(nullptr, &command[0], nullptr, nullptr, output != INVALID_HANDLE_VALUE,
                      CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
    if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
    return Fail(L"could not start PowerShell");
  }
  WaitForSingleObject(process.hProcess, 180000);
  DWORD exit_code = 1;
  GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
  DeleteFileW(bundle.c_str());

  std::wstring details;
  if (exit_code != 0) oc::ReadTextFile(console_log, &details);
  DeleteFileW(console_log.c_str());

  if (exit_code != 0) {
    std::wstring message = L"package installation failed (PowerShell exit " + std::to_wstring(exit_code) + L")";
    if (!details.empty()) message += L"\n" + details;
    return Fail(message);
  }

  Line(L"updated to " + info.version);
  return 0;
}

int CommandRegistry(const std::vector<std::wstring>& arguments) {
  if (arguments.size() < 3) return Fail(L"usage: ocshell registry install|uninstall|status [--force]");

  const std::wstring& action = arguments[2];

  if (action == L"status") {
    Line(oc::RegistryVerbsInstalled() ? L"registry verbs: installed" : L"registry verbs: not installed");
    return 0;
  }

  if (action == L"install") {
    if (oc::IsWindows11OrGreater() && !HasFlag(arguments, L"--force")) {
      return Fail(L"registry verbs target Windows 10; Windows 11 uses the packaged menu.\n"
                  L"Pass --force to add the classic entry as well (it shows under Show more options).");
    }
    std::wstring error;
    if (!oc::InstallRegistryVerbs(&error)) return Fail(error);
    Line(L"registry verbs installed");
    return 0;
  }

  if (action == L"uninstall") {
    std::wstring error;
    if (!oc::UninstallRegistryVerbs(&error)) return Fail(error);
    Line(L"registry verbs removed");
    return 0;
  }

  return Fail(L"unknown registry action: " + action);
}

void Usage() {
  Line(L"OpenCodeShell " + std::wstring(OC_IDENTITY_VERSION));
  Line(L"");
  Line(L"  ocshell launch <dir> [--continue] [--auto]");
  Line(L"  ocshell settings list [--json]");
  Line(L"  ocshell settings set <key> <value>");
  Line(L"  ocshell settings terminals [--json]");
  Line(L"  ocshell settings locate-binary");
  Line(L"  ocshell doctor [--json]");
  Line(L"  ocshell update check [--json]");
  Line(L"  ocshell update apply");
  Line(L"  ocshell registry install|uninstall|status [--force]");
  Line(L"  ocshell selftest");
  Line(L"  ocshell version");
  Line(L"");
  Line(L"keys: binaryPath, updateUri, terminal.mode, terminal.id, terminal.customPath,");
  Line(L"      terminal.customArgs, continueFromProjectRoot, logging");
}

}  // namespace

int main() {
  std::vector<std::wstring> arguments = Arguments();
  if (arguments.size() < 2) {
    Usage();
    return 1;
  }

  const std::wstring& command = arguments[1];
  if (command == L"launch") return CommandLaunch(arguments);
  if (command == L"registry") return CommandRegistry(arguments);
  if (command == L"doctor") return CommandDoctor(arguments);
  if (command == L"update") {
    if (arguments.size() < 3) {
      Usage();
      return 1;
    }
    if (arguments[2] == L"check") return CommandUpdateCheck(arguments);
    if (arguments[2] == L"apply") return CommandUpdateApply();
  }
  if (command == L"selftest") return CommandSelfTest();
  if (command == L"version") {
    Line(OC_IDENTITY_VERSION);
    return 0;
  }
  if (command == L"settings") {
    if (arguments.size() < 3) {
      Usage();
      return 1;
    }
    const std::wstring& sub = arguments[2];
    if (sub == L"list") return CommandSettingsList(arguments);
    if (sub == L"set") return CommandSettingsSet(arguments);
    if (sub == L"terminals") return CommandSettingsTerminals(arguments);
    if (sub == L"locate-binary") return CommandSettingsLocate();
  }

  Usage();
  return 1;
}
