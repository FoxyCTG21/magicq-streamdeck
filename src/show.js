// MagicQ show file reader (.shw / .sbk) -> Execute Window buttons.
//
// Format (text, latin-1, one record per line, quoted CSV):
//   N,<page hex>,<item hex>,<flags hex>,<type hex>,<id hex>,<?>,<?>,"<name>",...
//
// What we know (verified against a real show file):
//   - flags & 0xFF  = index of the manually chosen colour (0 = the default one).
//   - flags & 0x400 = Button (SOLO); field 7 is the SOLO group number ("1-SO" in MagicQ).
//   - flags & 0x200 = Flash, 0x100 = Fader, 0x800 = Encoder; none = normal button.
//   - type 0x1a     = special functions (Div/Tap/Inc/Dec SP...) -> red.
//   - type 0x02     = cue stacks / normal buttons -> blue by default.
//   - type 0x13 with no name = empty slot.
//   - types 0x05/0x06 = palettes (page 3): the colour comes from the name.

import { readFileSync } from "node:fs";

// Colours measured from a screenshot of the Execute window (page 5 of a real show).
// [off, active]
export const COLOUR_TABLE = {
	0: ["#002082", "#0040ff"], // default blue
	1: ["#5f0018", "#bb0030"], // red
	2: ["#123810", "#246e20"], // green
	3: ["#00245f", "#0047bb"], // blue (Button type = Blue)
	4: ["#004e53", "#0099a3"], // turquoise
	5: ["#52023a", "#a10473"], // magenta
	6: ["#5f2e00", "#bb5c00"], // orange
	7: ["#552436", "#a8476a"], // pink
	8: ["#412701", "#804e02"], // brown
	9: ["#675a09", "#cbb212"], // yellow
	10: ["#024c3a", "#049672"], // sea green
};

const TYPE_FUNCTION = 0x1a;
const TYPE_EMPTY = 0x13;
const TYPE_PALETTE = [0x05, 0x06];

// Colour palette names -> active colour.
const PALETTE_NAMES = {
	white: "#f2f2f2", red: "#d01020", orange: "#e07000", yellow: "#e8d010", green: "#20a030",
	aqua: "#10b0b0", blue: "#1040e0", silver: "#a8a8b0", salmon: "#e07068", amber: "#e09000",
	gold: "#c8a000", olive: "#808000", cyan: "#00c8e0", purple: "#8020c0", pink: "#e060a0",
	magenta: "#c010a0",
};

export function darken(hex, factor = 0.42) {
	const n = parseInt(hex.slice(1), 16);
	const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * factor));
	return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Button kind from the flags (confirmed with the test row on page 5). */
export function kindOf(flags) {
	if (flags & 0x800) return "encoder";
	if (flags & 0x400) return "solo";
	if (flags & 0x200) return "flash";
	if (flags & 0x100) return "fader";
	return "button";
}

/** Short tag like the one MagicQ draws in the button corner. */
export function tagFor(button) {
	if (!button) return "";
	switch (button.kind) {
		case "solo": return button.soloGroup ? `${button.soloGroup}-SO` : "SO";
		case "flash": return "FL";
		case "fader": return "F";
		case "encoder": return "E";
		default: return "";
	}
}

/** Splits a MagicQ CSV line, respecting quotes. */
export function splitRecord(line) {
	const out = [];
	let cur = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
		} else if (ch === "," && !quoted) {
			out.push(cur); cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

/**
 * Converts show text into { pages: Map<number, Map<index, button>> }.
 * `index` is the index stored in the file (0-based); the executor number
 * used in OSC / in the plugin is index + itemBase.
 */
export function parseShow(text) {
	const pages = new Map();
	for (const raw of text.split(/\r?\n/)) {
		if (!raw.startsWith("N,")) continue;
		const f = splitRecord(raw);
		if (f.length < 9) continue;
		const page = parseInt(f[1], 16);
		const index = parseInt(f[2], 16);
		if (!Number.isFinite(page) || !Number.isFinite(index)) continue;
		const flags = parseInt(f[3], 16) || 0;
		const type = parseInt(f[4], 16) || 0;
		const group = parseInt(f[7], 16) || 0;
		const kind = kindOf(flags);
		const button = {
			page, index, flags, type, name: f[8].trim(), colourIndex: flags & 0xff,
			kind, soloGroup: kind === "solo" ? group : 0,
		};
		if (!pages.has(page)) pages.set(page, new Map());
		pages.get(page).set(index, button);
	}
	return { pages };
}

export function loadShow(path) {
	return parseShow(readFileSync(path, "latin1"));
}

/** Visual style of a button: { empty, off, on }. */
export function styleFor(button) {
	if (!button) return { empty: true };
	const { type, name, colourIndex } = button;
	if (type === TYPE_EMPTY && name === "") return { empty: true };
	if (TYPE_PALETTE.includes(type)) {
		const word = name.toLowerCase().replace(/^(medium|light|dark)\s+/, "");
		const on = PALETTE_NAMES[word] ?? "#707070";
		return { empty: false, off: darken(on), on };
	}
	const idx = type === TYPE_FUNCTION ? 1 : colourIndex;
	const [off, on] = COLOUR_TABLE[idx] ?? COLOUR_TABLE[0];
	return { empty: false, off, on };
}

/** Flash buttons: held while the key is pressed (1 on press, 0 on release). */
export function isHeldButton(button) {
	return button?.kind === "flash";
}

/** Executor numbers in the same SOLO group (same page and group) as `number`, excluding it. */
export function soloPeers(show, page, number, itemBase = 1) {
	const b = buttonFor(show, page, number, itemBase);
	if (!b || b.kind !== "solo" || !b.soloGroup) return [];
	const peers = [];
	for (const other of show.pages.get(page).values()) {
		if (other.kind === "solo" && other.soloGroup === b.soloGroup && other.index !== b.index) peers.push(other.index + itemBase);
	}
	return peers;
}

/** Existing pages, sorted. */
export function pageNumbers(show) {
	return [...show.pages.keys()].sort((a, b) => a - b);
}

/** Button of an executor by number (1 = first item if itemBase = 1). */
export function buttonFor(show, page, number, itemBase = 1) {
	return show.pages.get(page)?.get(number - itemBase);
}
