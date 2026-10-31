// Placeholder executable required by the package manifest.
//
// An MSIX package's <Application> must declare an Executable. This package exists only to
// host a shell extension, so the application entry point is never launched -- the manifest
// sets AppListEntry="none". Startup cost is therefore irrelevant.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) { return 0; }
