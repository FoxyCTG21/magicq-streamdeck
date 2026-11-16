// Generates preview/deck.html: simulates 4x8 Stream Deck XL keys with a real show.
// Usage: node tools-preview.mjs <path-to-show.shw>
import { writeFileSync } from "node:fs";
import { loadShow, buttonFor, pageNumbers } from "./src/show.js";
import { renderExec, renderNav } from "./src/render.js";
const showPath = process.argv[2];
if (!showPath) {
  console.error("Usage: node tools-preview.mjs <path-to-show.shw>");
  process.exit(1);
}
const show = loadShow(showPath);
const pages = pageNumbers(show);
const active = new Set(["2:4", "5:12", "1:1"]);
let html = `<body style="background:#111;color:#ccc;font:14px Arial;margin:12px">`;
for (const p of [1, 2, 5]) {
  const keys = [];
  for (let n = 1; n <= 24; n++) keys.push(renderExec({ number: n, button: buttonFor(show, p, n), active: active.has(`${p}:${n}`) }));
  keys.push(renderNav({ label: "PAG -", sub: `${p}/${pages.at(-1)}` }), renderNav({ label: "PAG +", sub: `${p}/${pages.at(-1)}` }));
  pages.slice(0, 6).forEach((t) => keys.push(renderNav({ label: `PAG ${t}`, highlight: t === p })));
  html += `<h3>Page ${p} (activos simulados: ${[...active].filter((a) => a.startsWith(p + ":")).join(" ") || "-"})</h3><div style="display:grid;grid-template-columns:repeat(8,96px);gap:6px">` +
    keys.slice(0, 32).map((k) => `<div style="width:96px;height:96px">${k.replace('width="144" height="144"', 'width="96" height="96"')}</div>`).join("") + `</div>`;
}
writeFileSync("preview/deck.html", html + "</body>");
console.log("ok");
