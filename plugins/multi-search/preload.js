const fs = require("node:fs");
const path = require("node:path");

window.multiSearchApi = {
  loadDefaultConfig() {
    const filePath = path.join(__dirname, "default-config.json");
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  }
};
