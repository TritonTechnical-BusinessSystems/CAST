# CAST extension — deploy (force-install) without Pulseway

Force-installing CAST just means writing one **registry policy** on the machine
(Chrome + Edge `ExtensionSettings` → `force_installed`). Pulseway is only one way
to write it. Pick whichever fits — no Pulseway required.

**Extension ID:** `cijknnchejganljdmpdmdkajcmknmdpp`
**Update URL:** `https://cast-updates.tritontechnical.com/update-manifest.xml`

## Ways to push it
| Method | How | Best for |
|---|---|---|
| **GPO** *(cleanest, you're AD-joined)* | Import the Chrome + Edge ADMX templates into the domain Central Store → set *Configure force-installed apps and extensions* to the ID+URL, domain-wide. Or push `cast-extension.reg` via a GPO "Registry" preference / login script. | All domain machines, hands-off. |
| **`cast-extension.reg`** | Double-click, or `reg import cast-extension.reg` (as admin). | Quick per-machine / testing. |
| **`Install-CAST-Extension.ps1`** | Run as admin. Same policy, scriptable + idempotent; drop it in a login/startup script or any RMM. | Scripted rollout without GPO. |
| Intune / other MDM | Deliver the same registry values or the ADMX setting. | If you have it. |

Remove with `Uninstall-CAST-Extension.ps1` (or delete the registry key).

## Two hard requirements (browser rules, not ours)
1. **The device must be enterprise-managed (AD-joined / cloud-managed).** Chrome &
   Edge refuse to force-install a *non-Web-Store* extension on unmanaged (personal)
   machines. Triton's AD join satisfies this. For truly *any* machine/user, the
   only path is an unlisted Chrome Web Store / Edge Add-ons listing (see INIT-0001).
2. **The update URL must be live** — the artifacts host (INIT-0001) must serve the
   signed `.crx` + `update-manifest.xml`. Until then the policy applies but the
   install stays pending (nothing to fetch).
