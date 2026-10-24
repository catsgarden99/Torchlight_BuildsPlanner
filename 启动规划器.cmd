@echo off
rem Open the planner in a chromeless app window (no address bar, no tabs).
rem Falls back to the default browser if Edge/Chrome are not found.
setlocal
set "TARGET=%~dp0index.html"
set "URL=file:///%TARGET:\=/%"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app="%URL%"
  exit /b
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app="%URL%"
  exit /b
)

start "" "%TARGET%"
