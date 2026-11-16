import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { parseShow, loadShow, styleFor, buttonFor, pageNumbers, COLOUR_TABLE, soloPeers, tagFor } from "../src/show.js";
import { encode, decode, parseExecFeedback, MagicQLink } from "../src/osc.js";
import { renderExec, renderNav, renderPb, renderPageInfo, renderConfig, wrap } from "../src/render.js";

// Sample records modelled on a real show file (pages 1, 2 and 5) plus a palette from page 3.
const FIXTURE = [
	'N,0001,0000,00000203,0002,00000091,00000000,0002,"SMOKE INT","",00000000,00000000,;',
	'N,0001,0001,00000400,0002,0000008f,00000000,0002,"SMOKE SP2","",00000000,00000000,;',
	'N,0002,0003,00000407,0002,00000009,00000000,0001,"2 col fade","",00000000,00000000,;',
	'N,0002,005c,01000000,001a,00000007,00000000,000f,"Div SP1 ","",00000000,00000000,;',
	'N,0002,0068,00000000,0013,00000000,00000000,0000,"","",00000000,00000000,;',
	'N,0003,0002,00000000,0006,00000001,00000000,0000,"Red","",00000000,00000000,;',
	'N,0005,000c,00000001,0002,000000b3,00000000,0000,"2-1","",00000000,00000000,;',
	// Test row on page 5 (screenshot: 1-SO, 1-SO, normal, FL, F, E)
	'N,0007,0000,00000400,0002,000000a7,00000000,0001,"1-0","",00000000,00000000,;',
	'N,0007,0001,00000401,0002,000000a8,00000000,0001,"2-0","",00000000,00000000,;',
	'N,0007,0002,00000002,0002,000000a9,00000000,0000,"3-0","",00000000,00000000,;',
	'N,0007,0003,00000203,0002,000000aa,00000000,0000,"4-0","",00000000,00000000,;',
	'N,0007,0004,00000104,0002,000000ab,00000000,0000,"5-0","",00000000,00000000,;',
	'N,0007,0005,00000805,0002,000000ac,00000000,0000,"6-0","",00000000,00000000,;',
	'N,0007,000a,00000400,0002,000000b1,00000000,0002,"otro grupo","",00000000,00000000,;',
	'N,0005,0014,00000009,0002,000000bb,00000000,0000,"10-1","",00000000,00000000,;',
].join("\n");

test("parser reads pages, items, names and colour", () => {
	const show = parseShow(FIXTURE);
	assert.deepEqual(pageNumbers(show), [1, 2, 3, 5, 7]);
	assert.equal(buttonFor(show, 1, 1).name, "SMOKE INT");
	assert.equal(buttonFor(show, 1, 1).colourIndex, 3);
	assert.equal(buttonFor(show, 2, 4).colourIndex, 7); // 2 col fade = pink
	assert.equal(buttonFor(show, 5, 13).colourIndex, 1);
});

test("colours: default blue, functions red, manually chosen, empty", () => {
	const show = parseShow(FIXTURE);
	assert.deepEqual(styleFor(buttonFor(show, 1, 2)), { empty: false, off: COLOUR_TABLE[0][0], on: COLOUR_TABLE[0][1] });
	assert.equal(styleFor(buttonFor(show, 1, 1)).on, COLOUR_TABLE[3][1]);
	assert.equal(styleFor(buttonFor(show, 2, 4)).on, COLOUR_TABLE[7][1]); // pink
	assert.equal(styleFor(buttonFor(show, 2, 0x5c + 1)).on, COLOUR_TABLE[1][1]); // function -> red
	assert.equal(styleFor(buttonFor(show, 2, 0x68 + 1)).empty, true);
	assert.equal(styleFor(undefined).empty, true);
	assert.equal(styleFor(buttonFor(show, 3, 3)).on, "#d01020"); // "Red" palette
});

test("OSC: encode/decode round trip", () => {
	const m = decode(encode("/exec/2/13", 1));
	assert.deepEqual(m, { address: "/exec/2/13", args: [1] });
	assert.deepEqual(decode(encode("/feedback/exec")), { address: "/feedback/exec", args: [] });
	assert.deepEqual(decode(encode("/exec/1/1", 0.5)).args[0], 0.5);
	assert.equal(decode(Buffer.from("garbage")), null);
});

test("OSC: exact bytes of the press message", () => {
	// "/exec/1/1" + pad -> 12 bytes, ",i" + pad -> 4 bytes, int32 -> 4 bytes
	const b = encode("/exec/1/1", 1);
	assert.equal(b.length, 20);
	assert.equal(b.readInt32BE(16), 1);
});

test("executor feedback", () => {
	assert.deepEqual(parseExecFeedback({ address: "/exec/2/13", args: [1] }), { page: 2, number: 13, value: 1 });
	assert.equal(parseExecFeedback({ address: "/pb/1", args: [0.2] }), null);
});

test("render: valid SVG, with name and distinct active state", () => {
	const show = parseShow(FIXTURE);
	const b = buttonFor(show, 1, 1);
	const off = renderExec({ number: 1, button: b, active: false });
	const on = renderExec({ number: 1, button: b, active: true });
	assert.match(off, /^<svg /);
	assert.ok(off.includes("SMOKE"));
	assert.notEqual(off, on);
	assert.ok(on.includes('stroke="#ffffff"'));
	assert.match(renderNav({ label: "PAG +", sub: "2/5" }), /PAG \+/);
	assert.deepEqual(wrap("BARS/BLIN DIMME", 9, 3), ["BARS/BLIN", "DIMME"]);
});

test("button kinds and SOLO groups", () => {
	const show = parseShow(FIXTURE);
	const kinds = [1, 2, 3, 4, 5, 6].map((n) => buttonFor(show, 7, n).kind);
	assert.deepEqual(kinds, ["solo", "solo", "button", "flash", "fader", "encoder"]);
	assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => tagFor(buttonFor(show, 7, n))), ["1-SO", "1-SO", "", "FL", "F", "E"]);
	assert.deepEqual(soloPeers(show, 7, 1), [2]); // 1-0 and 2-0 are the same group
	assert.deepEqual(soloPeers(show, 7, 2), [1]);
	assert.deepEqual(soloPeers(show, 7, 11), []); // different group (2)
	assert.deepEqual(soloPeers(show, 7, 3), []); // not SOLO
	assert.equal(styleFor(buttonFor(show, 7, 2)).on, COLOUR_TABLE[1][1]); // 0x401: SOLO + red colour
});

test("OSC: explicit float differs from integer", () => {
	assert.deepEqual(decode(encode("/exec/1/1", { float: 1.0 })).args, [1]);
	assert.equal(encode("/exec/1/1", { float: 1.0 }).includes(Buffer.from(",f")), true);
	assert.equal(encode("/exec/1/1", 1).includes(Buffer.from(",i")), true);
});

test("playbacks: icons and page command via /rpc", () => {
	for (const fn of ["go", "pause", "flash"]) {
		const off = renderPb({ number: 3, fn, active: false });
		const on = renderPb({ number: 3, fn, active: true, level: 0.5 });
		assert.match(off, /^<svg /);
		assert.ok(off.includes("PB 3"));
		assert.notEqual(off, on);
	}
	const m = decode(encode("/rpc", "3P"));
	assert.deepEqual(m, { address: "/rpc", args: ["3P"] });
	assert.deepEqual(decode(encode("/pb/2/flash", 1)), { address: "/pb/2/flash", args: [1] });
});

test("playback: release option", () => {
	assert.ok(renderPb({ number: 2, fn: "release", active: false }).includes("REL"));
});

test("page indicator", () => {
	const both = renderPageInfo({ what: "both", execPage: 5, execTotal: 7, pbPage: 2 });
	assert.ok(both.includes("EXECUTOR") && both.includes("PLAYBACK"));
	assert.ok(renderPageInfo({ what: "exec", execPage: 5, execTotal: 7, pbPage: 2 }).includes("of 7"));
	assert.ok(!renderPageInfo({ what: "pb", execPage: 5, pbPage: 2 }).includes("EXECUTOR"));
});

test("config key and reconfigurable OSC link", async () => {
	const svg = renderConfig({ host: "192.168.1.50", tx: 8000, rx: 9100, link: true });
	assert.ok(svg.includes("192.168.1.50") && svg.includes("9100"));
	// The link listens on a port, receives a message and keeps working after changing port.
	const got = [];
	const link = new MagicQLink({ host: "127.0.0.1", txPort: 18000, rxPort: 19100 }, (m) => got.push(m.address));
	link.start();
	await new Promise((r) => setTimeout(r, 100));
	const dgram = await import("node:dgram");
	const tx = dgram.createSocket("udp4");
	const sendTo = (port, addr) => new Promise((res) => tx.send(encode(addr, 1), port, "127.0.0.1", res));
	await sendTo(19100, "/exec/1/1");
	await new Promise((r) => setTimeout(r, 100));
	link.reconfigure({ host: "127.0.0.1", txPort: 18000, rxPort: 19101 });
	await new Promise((r) => setTimeout(r, 100));
	await sendTo(19101, "/exec/1/2");
	await new Promise((r) => setTimeout(r, 100));
	link.stop();
	tx.close();
	assert.deepEqual(got, ["/exec/1/1", "/exec/1/2"]);
});

// Test against a real show file if MAGICQ_TEST_SHOW points to one (skipped otherwise).
const REAL = process.env.MAGICQ_TEST_SHOW;
test("real show file (MAGICQ_TEST_SHOW)", { skip: !REAL || !existsSync(REAL) }, () => {
	const show = loadShow(REAL);
	assert.ok(pageNumbers(show).includes(1));
	// The show changes often: only check the structure, not specific colours.
	assert.ok(buttonFor(show, 1, 1).name.length > 0);
	for (const [, btns] of show.pages) {
		for (const b of btns.values()) {
			assert.ok(Number.isInteger(b.colourIndex) && b.colourIndex >= 0);
			assert.equal(typeof styleFor(b).empty, "boolean");
		}
	}
});
