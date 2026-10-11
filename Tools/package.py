#!/usr/bin/env python3
"""SwiftPM builds the products; this tool assembles/signs Apple's bundles.

No Xcode project is generated. Uses only Python's standard library.
"""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(*command, capture=False):
    if not capture:
        print("+", " ".join(str(x) for x in command), flush=True)
    return subprocess.run([str(x) for x in command], cwd=ROOT, check=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def write_plist(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(value, sort_keys=False))


def profile_entitlements(path, bundle_id):
    profile = plistlib.loads(run("security", "cms", "-D", "-i", path, capture=True))
    if profile["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
        raise ValueError(f"Expired provisioning profile: {path}")
    entitlements = profile["Entitlements"].copy()
    key = "application-identifier" if "application-identifier" in profile["Entitlements"] else "com.apple.application-identifier"
    allowed = entitlements[key]
    prefix = profile["ApplicationIdentifierPrefix"][0]
    expected = prefix + "." + bundle_id
    if not re.fullmatch(re.escape(allowed).replace(r"\*", ".*"), expected):
        raise ValueError(f"Profile {path} does not allow {bundle_id}")
    entitlements[key] = expected
    entitlements.pop("com.apple.developer.associated-domains", None)
    entitlements["keychain-access-groups"] = [expected]
    return entitlements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=["macos", "ios", "simulator"], nargs="?", default="macos")
    parser.add_argument("--bundle-id", default="local.adv")
    parser.add_argument("--identity", help="codesign identity; default is ad-hoc signing on Mac/simulator")
    parser.add_argument("--app-profile", type=Path)
    parser.add_argument("--extension-profile", type=Path)
    parser.add_argument("--app-group", help="Shared App Group identifier, enabled in both profiles")
    parser.add_argument("--cloud-container", help="CloudKit container identifier, enabled in the app profile")
    parser.add_argument("--cloud-environment", choices=["Development", "Production"], default="Development")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", args.bundle_id):
        parser.error("--bundle-id must be a reverse-DNS identifier")
    if args.platform == "ios" and args.identity and not (args.app_profile and args.extension_profile):
        parser.error("Signed iOS builds require --app-profile, --extension-profile")
    if not args.identity and (args.app_profile or args.extension_profile):
        parser.error("Provisioning profiles also require --identity")
    profiles = [args.extension_profile, args.app_profile]
    if any(profiles) and not all(profiles):
        parser.error("Provide both provisioning profiles")
    if args.platform == "simulator" and (any(profiles) or args.app_group or args.cloud_container):
        parser.error("Cloud/shared builds require macOS or iOS device signing")
    if args.cloud_container and not args.app_group:
        parser.error("--cloud-container also requires --app-group")
    if args.app_group and not (args.identity and all(profiles)):
        parser.error("App sharing requires --identity and both provisioning profiles")
    if args.app_group and not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", args.app_group):
        parser.error("Invalid App Group identifier")
    if args.cloud_container and not re.fullmatch(r"iCloud\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*", args.cloud_container):
        parser.error("CloudKit container must start with iCloud.")
    signing_entitlements = []
    if all(profiles):
        for profile, suffix in zip(profiles, [".YouTube", ""]):
            ent = profile_entitlements(profile, args.bundle_id + suffix)
            if args.app_group:
                if args.app_group not in ent.get("com.apple.security.application-groups", []):
                    parser.error(f"Profile {profile} does not enable App Group {args.app_group}")
                ent["com.apple.security.application-groups"] = [args.app_group]
            if args.cloud_container and not suffix:
                if args.cloud_container not in ent.get("com.apple.developer.icloud-container-identifiers", []):
                    parser.error("App profile does not enable the selected CloudKit container")
                if "CloudKit" not in ent.get("com.apple.developer.icloud-services", []):
                    parser.error("App profile does not enable CloudKit")
                environment = ent.get("com.apple.developer.icloud-container-environment")
                if environment != args.cloud_environment:
                    parser.error(f"App profile environment is {environment}, not {args.cloud_environment}")
                ent["com.apple.developer.icloud-container-identifiers"] = [args.cloud_container]
                ent["com.apple.developer.icloud-services"] = ["CloudKit"]
            if args.platform == "macos":
                target = "ADVWebExtension" if suffix else "ADVApp"
                ent.update(plistlib.loads((ROOT / "Sources" / target / "macOS.entitlements").read_bytes()))
                if not suffix: ent["com.apple.security.network.client"] = True
            signing_entitlements.append(ent)
        teams = {ent.get("com.apple.developer.team-identifier") for ent in signing_entitlements}
        if len(teams) != 1 or None in teams:
            parser.error("All profiles must belong to the same team")

    # Export rules using the host tool, even when the app is cross-compiled.
    run("swift", "build", "-c", "release", "--product", "ADVCheck")
    host_bin = Path(run("swift", "build", "-c", "release", "--show-bin-path", capture=True).decode().strip())
    build = ["swift", "build", "-c", "release"]
    if args.platform != "macos":
        sdk_name = "iphoneos" if args.platform == "ios" else "iphonesimulator"
        sdk = run("xcrun", "--sdk", sdk_name, "--show-sdk-path", capture=True).decode().strip()
        arch = "arm64" if args.platform == "ios" else os.uname().machine
        triple = f"{arch}-apple-ios16.0" + ("-simulator" if args.platform == "simulator" else "")
        build += ["--scratch-path", f".build/{args.platform}", "--triple", triple, "--sdk", sdk]
    for product in ["ADVApp", "ADVWebExtension"]:
        run(*build, "--product", product)
    binary_dir = Path(run(*build, "--show-bin-path", capture=True).decode().strip())

    output = ROOT / "dist" / args.platform
    output.mkdir(parents=True, exist_ok=True)
    # Assemble a fresh bundle: removed/renamed resources never survive a rebuild.
    with tempfile.TemporaryDirectory(prefix="adv-package-", dir=output) as temporary:
        staging = Path(temporary)
        app = staging / "ADV.app"
        mac = args.platform == "macos"
        app_root = app / "Contents" if mac else app
        app_executable = app_root / "MacOS" if mac else app_root
        app_executable.mkdir(parents=True, exist_ok=True)
        shutil.copy2(binary_dir / "ADVApp", app_executable / "ADVApp")
        youtube = app_root / "PlugIns" / "ADV.appex"
        youtube_root = youtube / "Contents" if mac else youtube
        youtube_executable = youtube_root / "MacOS" if mac else youtube_root
        youtube_executable.mkdir(parents=True, exist_ok=True)
        shutil.copy2(binary_dir / "ADVWebExtension", youtube_executable / "ADVWebExtension")
        youtube_resources = youtube_root / "Resources" if mac else youtube_root
        shutil.copytree(ROOT / "WebExtension", youtube_resources, dirs_exist_ok=True)

        run(host_bin / "ADVCheck", "export", youtube_resources / "networkRules.json")

        common = {
            "CFBundleDevelopmentRegion": "en", "CFBundleDisplayName": "ADV",
            "CFBundleName": "ADV", "CFBundleShortVersionString": "0.4.0",
            "CFBundleVersion": "4", "CFBundleInfoDictionaryVersion": "6.0",
        }
        app_info = dict(common, CFBundleIdentifier=args.bundle_id, CFBundleExecutable="ADVApp", CFBundlePackageType="APPL")
        youtube_info = dict(common, CFBundleDisplayName="ADV", CFBundleName="ADV",
                            CFBundleIdentifier=args.bundle_id + ".YouTube", CFBundleExecutable="ADVWebExtension",
                            CFBundlePackageType="XPC!", NSExtension={
                                "NSExtensionPointIdentifier": "com.apple.Safari.web-extension",
                                "NSExtensionPrincipalClass": "ADVWebExtensionRequestHandler"})
        if args.app_group:
            for info in [app_info, youtube_info]: info["ADVAppGroup"] = args.app_group
        if args.cloud_container:
            app_info["ADVCloudContainer"] = args.cloud_container
            youtube_info["ADVCloudContainer"] = args.cloud_container
        if mac:
            app_info.update(LSMinimumSystemVersion="13.0", NSPrincipalClass="NSApplication",
                            NSHighResolutionCapable=True)
            youtube_info.update(LSMinimumSystemVersion="13.0")
        else:
            platform_name = "iPhoneOS" if args.platform == "ios" else "iPhoneSimulator"
            for info in [app_info, youtube_info]:
                info.update(MinimumOSVersion="16.0", CFBundleSupportedPlatforms=[platform_name], UIDeviceFamily=[1, 2])
            app_info.update(UILaunchScreen={}, UIApplicationSceneManifest={"UIApplicationSupportsMultipleScenes": False},
                            UISupportedInterfaceOrientations=["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"])
        write_plist(app_root / "Info.plist", app_info)
        write_plist(youtube_root / "Info.plist", youtube_info)

        if all(profiles):
            for bundle, profile, entitlements in zip([youtube, app], profiles, signing_entitlements):
                entitlements_path = staging / (bundle.stem + ".entitlements")
                write_plist(entitlements_path, entitlements)
                profile_destination = bundle / "Contents/embedded.provisionprofile" if mac else bundle / "embedded.mobileprovision"
                shutil.copy2(profile, profile_destination)
                run("codesign", "--force", "--sign", args.identity, "--timestamp=none", "--entitlements", entitlements_path, bundle)
        elif args.platform != "ios":
            identity = args.identity or "-"
            for bundle, target in [(youtube, "ADVWebExtension"), (app, "ADVApp")]:
                command = ["codesign", "--force", "--sign", identity, "--timestamp=none"]
                if mac:
                    command += ["--entitlements", ROOT / "Sources" / target / "macOS.entitlements"]
                run(*command, bundle)
        if args.platform != "ios" or args.identity:
            run("codesign", "--verify", "--deep", "--strict", app)

        destination = output / "ADV.app"
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(app), destination)
        print(f"\nBuilt: {destination}")
        if mac:
            print("Open the rebuilt ADV.app to refresh macOS extension registration before checking Safari settings.")
        if args.platform == "ios" and not args.identity:
            print("UNSIGNED iOS bundle: compile validation only; not installable on an iPhone.")
        elif mac and not args.identity:
            print("Ad-hoc signed: enable Safari Settings → Developer → Allow unsigned extensions for local testing. Safari resets this option whenever it quits.")


if __name__ == "__main__":
    main()
