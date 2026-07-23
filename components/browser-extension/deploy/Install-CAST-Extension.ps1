# Install-CAST-Extension.ps1
# Force-installs the CAST browser extension on this machine (Chrome + Edge) via
# enterprise policy. No Pulseway required — this just writes the same registry
# policy Pulseway would. Distribute however you like: run by hand as admin, push
# via a GPO/Intune/login script, or any RMM.
#
# REQUIREMENT: the device must be enterprise-managed (AD-joined / cloud-managed).
# Chrome & Edge ignore force-install of a NON-Web-Store extension on unmanaged
# (personal) machines — that's a browser security rule, not our choice.
#
# Run as Administrator.
$ErrorActionPreference = "Stop"

$ExtId  = "cijknnchejganljdmpdmdkajcmknmdpp"
$Update = "https://cast.tritontechnical.com/api/extension/update.xml"

foreach ($base in @("HKLM:\SOFTWARE\Policies\Google\Chrome",
                    "HKLM:\SOFTWARE\Policies\Microsoft\Edge")) {
    $key = Join-Path $base "ExtensionSettings\$ExtId"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "installation_mode"  -Value "force_installed" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name "update_url"         -Value $Update           -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name "override_update_url" -Value 1                -PropertyType DWord  -Force | Out-Null
    Write-Host "  Configured force-install: $base"
}

Write-Host ""
Write-Host "Done. Restart Chrome/Edge (or wait a few minutes) — CAST installs automatically."
Write-Host "NOTE: the update URL must be live (the artifacts host) for the install to fetch, else it stays pending."
