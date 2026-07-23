# Uninstall-CAST-Extension.ps1
# Removes the CAST force-install policy (Chrome + Edge). The extension is removed
# from the browser on next restart. Run as Administrator.
$ErrorActionPreference = "SilentlyContinue"
$ExtId = "cijknnchejganljdmpdmdkajcmknmdpp"
foreach ($base in @("HKLM:\SOFTWARE\Policies\Google\Chrome",
                    "HKLM:\SOFTWARE\Policies\Microsoft\Edge")) {
    Remove-Item -Path (Join-Path $base "ExtensionSettings\$ExtId") -Recurse -Force
    Write-Host "  Removed policy under $base"
}
Write-Host "Done. Restart Chrome/Edge to fully remove CAST."
