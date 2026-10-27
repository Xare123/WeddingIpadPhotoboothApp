// swift-tools-version: 5.9
import PackageDescription

// Independent research target; no app/autolinking target consumes this package.
let package = Package(
  name: "FaceEffectsPrototype",
  platforms: [.macOS(.v13), .iOS(.v16)],
  products: [.library(name: "FaceEffectsPrototype", targets: ["FaceEffectsPrototype"])],
  dependencies: [],
  targets: [
    .target(name: "FaceEffectsPrototype"),
    .testTarget(name: "FaceEffectsPrototypeTests", dependencies: ["FaceEffectsPrototype"],
                resources: [.copy("Fixtures")])
  ]
)
