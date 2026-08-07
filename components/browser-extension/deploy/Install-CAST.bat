@echo off
title CAST Browser Extension - Installer

:: Self-elevate (writing the browser policy needs admin — one UAC click).
:: fltmc requires admin and has NO service dependency. (net session depends on
:: the Server service, which many hardened/managed environments disable — when
:: it's off, net session fails even AFTER elevation, so the script thinks it's
:: still unelevated and relaunches itself again: repeat UAC prompts + cmd windows.)
::
:: The %1==""  guard makes this a ONE-SHOT attempt: only the original,
:: argument-less launch can trigger a relaunch. The relaunched copy runs with
:: "elevated" as %1, so even if the admin check ever misfires again, it cannot
:: re-elevate a second time — no loop is possible.
if "%~1"=="" (
  fltmc >nul 2>&1
  if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -Command "Start-Process -FilePath '%~f0' -ArgumentList 'elevated' -Verb RunAs"
    exit /b
  )
)

set "EXTID=cijknnchejganljdmpdmdkajcmknmdpp"
set "UPDATE=https://cast.tritontechnical.com/api/extension/update.xml"

echo.
echo   Installing the CAST browser extension for Chrome and Edge...
for %%B in ("HKLM\SOFTWARE\Policies\Google\Chrome" "HKLM\SOFTWARE\Policies\Microsoft\Edge") do (
  reg add "%%~B\ExtensionSettings\%EXTID%" /v installation_mode  /t REG_SZ   /d force_installed /f >nul
  reg add "%%~B\ExtensionSettings\%EXTID%" /v update_url         /t REG_SZ   /d "%UPDATE%"       /f >nul
  reg add "%%~B\ExtensionSettings\%EXTID%" /v override_update_url /t REG_DWORD /d 1              /f >nul
  rem Stamp the machine name into the extension's managed storage so it can report
  rem which device it runs on (a sandboxed extension can't read the hostname itself).
  reg add "%%~B\3rdparty\extensions\%EXTID%\policy" /v deviceName /t REG_SZ /d "%COMPUTERNAME%" /f >nul
)

echo.
echo   Done!  Last step: restart your browser (Chrome or Edge) and
echo   CAST installs automatically.
echo.
pause
