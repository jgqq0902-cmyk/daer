@echo off
setlocal

set "BRIDGE_ROOT=%~dp0"
set "NODE_EXE=%BRIDGE_ROOT%runtime\node.exe"
set "BRIDGE_ENTRY=%BRIDGE_ROOT%bridge-server.mjs"
if not defined DAER_GODOT_STATE_FILE set "DAER_GODOT_STATE_FILE=%LOCALAPPDATA%\DaerTraining\bridge\godot-game-state.json"

if not exist "%NODE_EXE%" (
  echo [daer-ai] Missing bundled Node runtime: "%NODE_EXE%" 1>&2
  exit /b 1
)

if not exist "%BRIDGE_ENTRY%" (
  echo [daer-ai] Missing bundled Bridge entry: "%BRIDGE_ENTRY%" 1>&2
  exit /b 1
)

if not exist "%LOCALAPPDATA%\DaerTraining\bridge" mkdir "%LOCALAPPDATA%\DaerTraining\bridge"

"%NODE_EXE%" "%BRIDGE_ENTRY%"
exit /b %ERRORLEVEL%
