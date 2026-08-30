const productionSigning = process.env.FINANCE_OS_SIGN_BUILD === "1";

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
    identity: productionSigning ? undefined : null,
    hardenedRuntime: productionSigning,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    notarize: productionSigning,
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
  },
  dmg: {
    artifactName: "Chelaro-${version}-${arch}.${ext}",
    sign: false,
  },
  artifactName: "Chelaro-${version}-${arch}.${ext}",
  publish: [
    {
      provider: "github",
      owner: "ChrBoebel",
      repo: "chelaro",
      releaseType: "release",
    },
  ],
};
