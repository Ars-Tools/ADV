# ADV project notes

- Personal Safari ad blocker for macOS 13+ and iOS 16+. SwiftPM manages native code; `Tools/package.py` produces app bundles without an Xcode project. Keep one Safari Web Extension (`ADV.appex`).
- `Sources/` contains the native app, rule storage, CloudKit bridge, and checks. `WebExtension/` contains request blocking, cosmetic filters, the multi-element picker, popup, and experimental YouTube handling.
- Cosmetic filters persist per exact hostname in browser-local JSON or signed App Group JSON. Global provider blocks persist separately in browser storage and dynamic DNR rules. Saving source blocks does not save cosmetic selections.
- Prefer stable CSS classes/ad attributes over generated IDs. Saved CSS applies to newly inserted matching elements. Selector generation is heuristic; YouTube ad removal is best effort.
- Reusable class/tag picking is explicit; preview all matches before saving. Personal CSS repairs page tampering and restores owned inline display overrides on removal. Keep style-attribute predicates stylesheet-only to avoid self-changing selectors; Shadow DOM and blank/srcdoc frames remain outside scope.
- CloudKit synchronization is manual and covers personal cosmetic filters only; signed App Groups and CloudKit provisioning are required. SwiftData is not implemented; real cross-device sync remains unverified.
- Keep UI and documentation in English with the existing Bauhaus design. Preserve the extension identifier `local.adv.YouTube` for stored settings and the README's LLM-assistance note.
- Build: `python3 Tools/package.py macos` or `ios`. Run `swift test`; use the README's `Tools/demo_server.py --verify` command for WebKit integration checks. iOS unsigned builds validate compilation only.
- DNR is the canonical network rule format. `ADVCheck export [output.json]` exports it; only the WebKit harness translates it into Content Blocker rules. Each signed executable target owns its `macOS.entitlements` file; keep Safari state and CloudKit services separate.
- App artwork lives in `Sources/ADVApp/AppIcon.icon` as SVG plus Icon Composer metadata. Xcode 26+ `actool` compiles it during packaging for both bundles, including older-OS fallbacks; do not commit generated PNG, ICNS, or CAR files. The Safari toolbar uses a separate monochrome SVG.
- Toolbar lid state reflects observed per-page cosmetic/YouTube/DNR blocking, not extension enablement. Network feedback can be unavailable; keep the unknown state truthful, respect API quotas, clear stale activity, and retain no browsing history. Safari controls tint.
- After replacing the Mac bundle, refresh LaunchServices/PlugInKit registration if needed (commands in README). Safari resets **Allow unsigned extensions** on quit; leave permission changes to the user.
