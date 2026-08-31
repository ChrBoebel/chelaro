module.exports = {
  appId: "com.chelaro.desktop",
  productName: "Chelaro",
  asar: true,
  directories: {
    output: "dist",
    buildResources: "build",
  },
  files: [
    "assets/**/*",
    "src/**/*",
    "package.json",
    "!test/**/*",
  ],
  extraResources: [
    {
      from: ".runtime",
      to: "runtime",
      filter: ["**/*"],
    },
  ],
  mac: {
    category: "public.app-category.finance",
    icon: "assets/icon.icns",
    minimumSystemVersion: "12.0",
    identity: null,
    hardenedRuntime: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    notarize: false,
    target: [{ target: "dmg", arch: ["arm64"] }],
  },
  dmg: {
    artifactName: "Chelaro-${version}-${arch}.${ext}",
    sign: false,
  },
  artifactName: "Chelaro-${version}-${arch}.${ext}",
  afterPack: require("./scripts/adhoc-sign-macos.cjs"),
};
