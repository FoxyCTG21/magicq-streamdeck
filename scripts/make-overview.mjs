// Generates docs/img/keys-overview.svg: a mock Stream Deck XL (4 x 8 keys) drawn with the plugin's own
// renderer, using made-up show data. Used by the README. Run with: node scripts/make-overview.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShow, buttonFor } from "../src/show.js";
import { renderExec, renderNav, renderPb, renderPageInfo } from "../src/render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// N,<page>,<item>,<flags>,<type>,<id>,<?>,<solo group>,"<name>"  (flags: 0x400 SOLO, 0x200 Flash, 0x100 Fader, low byte = colour)
const rec = (item, flags, type, group, name) =>
	`N,0001,${item.toString(16).padStart(4, "0")},${flags.toString(16).padStart(8, "0")},${type.toString(16).padStart(4, "0")},00000001,00000000,${group.toString(16).padStart(4, "0")},"${name}","",00000000,00000000,;`;
const show = parseShow([
	rec(0, 0x400, 2, 1, "Wash Warm"), rec(1, 0x400, 2, 1, "Wash Cool"), rec(2, 0x400, 2, 1, "Wash Red"),
	rec(3, 0x400 | 9, 2, 2, "Spots Amber"), rec(4, 0x400 | 9, 2, 2, "Spots White"),
	rec(5, 0x203, 2, 0, "Strobe"), rec(6, 0x205, 2, 0, "Blinder"), rec(7, 0x104, 2, 0, "Haze Level"),
	rec(8, 0x01, 2, 0, "Chase 1"), rec(9, 0x02, 2, 0, "Chase 2"), rec(10, 0x07, 2, 0, "Pink Wash"), rec(11, 0x06, 2, 0, "Sunset"),
	rec(12, 0x805, 2, 0, "Fan"), rec(13, 0x08, 2, 0, "Intro"), rec(14, 0x0a, 2, 0, "Outro"),
].join("\n"));

const active = new Set([1, 6]); // executors drawn as active
const keys = [];
for (let n = 1; n <= 15; n++) {
	keys.push(renderExec({ number: n, button: buttonFor(show, 1, n), active: active.has(n), level: n === 8 ? 0.6 : undefined }));
}
keys.push(renderNav({ label: "PAGE -", sub: "1/5", link: true }), renderNav({ label: "PAGE +", sub: "1/5", link: true }));
for (const t of [1, 2, 3]) keys.push(renderNav({ label: `PAGE ${t}`, highlight: t === 1, link: true }));
keys.push(renderPageInfo({ what: "both", execPage: 1, execTotal: 5, pbPage: 2, ofLabel: "of", link: true }));
keys.push(renderPb({ number: 1, fn: "go", active: true, level: 0.8 }), renderPb({ number: 1, fn: "pause", active: false }));
keys.push(renderPb({ number: 1, fn: "flash", active: false }), renderPb({ number: 1, fn: "release", active: false }));
keys.push(renderNav({ label: "PB PAGE -", sub: "2", link: true }), renderNav({ label: "PB PAGE +", sub: "2", link: true }));
keys.push(renderNav({ label: "PAGE 4", disabled: true, link: true }), renderNav({ label: "PAGE 5", link: true }));

const K = 96, GAP = 10, PAD = 18, COLS = 8;
const w = PAD * 2 + COLS * K + (COLS - 1) * GAP;
const h = PAD * 2 + 4 * K + 3 * GAP;
const cells = keys.slice(0, 32).map((svg, i) => {
	const x = PAD + (i % COLS) * (K + GAP);
	const y = PAD + Math.floor(i / COLS) * (K + GAP);
	const inner = svg.replace(/^<svg [^>]*>/, "").replace(/<\/svg>$/, "");
	return `<svg x="${x}" y="${y}" width="${K}" height="${K}" viewBox="0 0 144 144"><clipPath id="c${i}"><rect width="144" height="144" rx="14"/></clipPath><g clip-path="url(#c${i})">${inner}</g></svg>`;
}).join("\n");

const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="${w}" height="${h}" rx="22" fill="#101010"/>\n${cells}\n</svg>\n`;
mkdirSync(join(root, "docs", "img"), { recursive: true });
writeFileSync(join(root, "docs", "img", "keys-overview.svg"), out);
console.log(`docs/img/keys-overview.svg written (${w}x${h})`);
