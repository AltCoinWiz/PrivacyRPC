// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PrivacyRPCSDK",
    platforms: [
        .iOS(.v15),
        .macOS(.v12)
    ],
    products: [
        .library(
            name: "PrivacyRPCSDK",
            targets: ["PrivacyRPCSDK"]
        ),
    ],
    targets: [
        .target(
            name: "PrivacyRPCSDK",
            dependencies: [],
            path: "Sources/PrivacyRPCSDK"
        ),
        .testTarget(
            name: "PrivacyRPCSDKTests",
            dependencies: ["PrivacyRPCSDK"]
        ),
    ]
)
