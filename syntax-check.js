const fs = require("fs");
const code = fs.readFileSync(require('path').join(__dirname, "estatebuilder-ai.html"), "utf8");
const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let ok = true;
let i = 0;
while ((match = re.exec(code)) !== null) {
  const js = match[1].trim();
  if (!js) { i++; continue; }
  try {
    new Function(js);
  } catch (e) {
    console.log("Block " + i + ": " + e.message.substring(0, 200));
    ok = false;
  }
  i++;
}
if (ok) console.log("ALL SCRIPT BLOCKS OK");
