// Builds the plugin and packs it into dist/com.foxy.magicqdeck.streamDeckPlugin.
// That file is a zip with the .sdPlugin folder at its root; double-clicking it installs it in Stream Deck.
// No dependencies: a tiny zip writer based on node:zlib.
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = "com.foxy.magicqdeck.sdPlugin";
const out = join(root, "dist", "com.foxy.magicqdeck.streamDeckPlugin");

console.log("Building...");
execSync("npx rollup -c", { cwd: root, stdio: "inherit" });

// Collect the files to ship (logs and other runtime leftovers are left out).
const skip = (rel) => rel.startsWith("logs/") || rel.endsWith(".log") || rel.endsWith(".map") || rel === ".gitkeep";
function walk(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files;
}
const base = join(root, pluginDir);
const entries = walk(base)
	.map((full) => ({ full, rel: relative(base, full).split(sep).join("/") }))
	.filter((e) => !skip(e.rel));

// --- minimal zip writer (deflate) ---
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed timestamp keeps the build reproducible

const chunks = [];
const central = [];
let offset = 0;
const push = (buf) => { chunks.push(buf); offset += buf.length; };

function addEntry(name, data, isDir = false) {
	const nameBuf = Buffer.from(name, "utf8");
	const body = isDir ? Buffer.alloc(0) : deflateRawSync(data);
	const method = isDir ? 0 : 8;
	const crc = isDir ? 0 : crc32(data);
	const headerOffset = offset;
	push(Buffer.concat([
		u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(DOS_TIME), u16(DOS_DATE),
		u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, body,
	]));
	central.push(Buffer.concat([
		u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(DOS_TIME), u16(DOS_DATE),
		u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
		u32(isDir ? 0x10 : 0), u32(headerOffset), nameBuf,
	]));
}

addEntry(`${pluginDir}/`, Buffer.alloc(0), true);
addEntry(`${pluginDir}/logs/`, Buffer.alloc(0), true); // the plugin writes its log here
const dirs = new Set();
for (const e of entries) {
	const parts = e.rel.split("/").slice(0, -1);
	for (let i = 1; i <= parts.length; i++) {
		const d = `${pluginDir}/${parts.slice(0, i).join("/")}/`;
		if (!dirs.has(d)) { dirs.add(d); addEntry(d, Buffer.alloc(0), true); }
	}
	addEntry(`${pluginDir}/${e.rel}`, readFileSync(e.full));
}

const cdStart = offset;
for (const c of central) push(c);
push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - cdStart), u32(cdStart), u16(0)]));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat(chunks));
console.log(`\nCreated ${relative(root, out)} (${(statSync(out).size / 1024).toFixed(0)} KB, ${entries.length} files)`);
