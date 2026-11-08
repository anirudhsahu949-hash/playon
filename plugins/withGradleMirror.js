// Downloads Gradle from a mirror instead of GitHub (GitHub was timing out
// with 504 on EAS). The checksum line makes Gradle verify the file is the
// official Gradle 8.14.3.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withGradleMirror(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "gradle", "wrapper", "gradle-wrapper.properties");
      if (fs.existsSync(file)) {
        let txt = fs.readFileSync(file, "utf8");
        txt = txt.replace(
          /^distributionUrl=.*$/m,
          "distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-bin.zip"
        );
        txt = txt.replace(/^networkTimeout=.*$/m, "networkTimeout=60000");
        if (!/distributionSha256Sum=/.test(txt)) {
          txt += "\ndistributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531\n";
        }
        fs.writeFileSync(file, txt);
      }
      return cfg;
    },
  ]);
};