// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ADV",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "BlockerCore", targets: ["BlockerCore"]),
        .executable(name: "ADVApp", targets: ["ADVApp"]),
        .executable(name: "ADVWebExtension", targets: ["ADVWebExtension"]),
        .executable(name: "ADVCheck", targets: ["ADVCheck"]),
    ],
    targets: [
        .target(name: "BlockerCore"),
        .target(name: "SafariStateBridge", linkerSettings: [.linkedFramework("SafariServices")]),
        .executableTarget(name: "ADVApp", dependencies: ["BlockerCore", "SafariStateBridge"], exclude: ["macOS.entitlements"]),
        .target(name: "WebExtensionHandler", dependencies: ["BlockerCore"], swiftSettings: [.unsafeFlags(["-application-extension"])]),
        .executableTarget(
            name: "ADVWebExtension", dependencies: ["WebExtensionHandler"],
            exclude: ["macOS.entitlements"],
            cSettings: [.unsafeFlags(["-fapplication-extension"])],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-application_extension"]), .linkedFramework("Foundation")]
        ),
        .executableTarget(name: "ADVCheck", dependencies: ["BlockerCore"]),
        .testTarget(name: "BlockerCoreTests", dependencies: ["BlockerCore"]),
    ]
)
