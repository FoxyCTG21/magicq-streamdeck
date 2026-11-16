// Draws the keys as SVG (the Stream Deck SDK accepts an SVG as an image).
import { styleFor, tagFor } from "./show.js";

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/** Splits text into lines of at most `max` characters and at most `lines` lines. */
export function wrap(text, max = 9, lines = 3) {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const out = [];
	let cur = "";
	const push = (w) => {
		while (w.length > max) { if (cur) { out.push(cur); cur = ""; } out.push(w.slice(0, max)); w = w.slice(max); }
		if (!cur) cur = w;
		else if ((cur + " " + w).length <= max) cur += " " + w;
		else { out.push(cur); cur = w; }
	};
	words.forEach(push);
	if (cur) out.push(cur);
	return out.slice(0, lines);
}

function svg(bg, inner, border = "") {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${bg}"/>${border}${inner}</svg>`
	);
}

function textBlock(lines, { fill = "#ffffff", y0 = 72, size = 24 } = {}) {
	const lh = size * 1.15;
	const top = y0 - ((lines.length - 1) * lh) / 2;
	return lines
		.map((l, i) => `<text x="72" y="${top + i * lh}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`)
		.join("");
}

/** Executor key. `button` may be undefined (slot with nothing in the show). */
export function renderExec({ number, button, active, level, tag: tagOverride }) {
	const st = styleFor(button);
	if (st.empty) {
		const dim = `<text x="10" y="22" font-family="Arial" font-size="18" fill="#3a3a3a">${number}</text>`;
		return svg("#0b0b0b", dim);
	}
	const bg = active ? st.on : st.off;
	const lines = wrap(button.name || "", 9, 3);
	const size = lines.length >= 3 ? 20 : lines.some((l) => l.length > 7) ? 22 : 26;
	const border = active ? `<rect x="3" y="3" width="138" height="138" fill="none" stroke="#ffffff" stroke-width="6"/>` : "";
	const num = `<text x="9" y="20" font-family="Arial" font-size="17" font-weight="700" fill="${active ? "#ffffff" : "#c8c8c8"}" opacity="0.85">${number}</text>`;
	const bar = level !== undefined
		? `<rect x="12" y="124" width="120" height="9" fill="#00000066"/><rect x="12" y="124" width="${Math.round(120 * level)}" height="9" fill="#ffffff"/>` +
		  `<text x="132" y="116" font-family="Arial" font-size="17" font-weight="700" fill="#ffffff" text-anchor="end">${Math.round(level * 100)}%</text>`
		: "";
	const tag = tagOverride ?? tagFor(button);
	const tagSvg = tag
		? `<text x="135" y="20" font-family="Arial" font-size="17" font-weight="700" fill="#ffffff" text-anchor="end" opacity="0.9">${esc(tag)}</text>`
		: "";
	return svg(bg, num + tagSvg + textBlock(lines, { size, fill: active ? "#ffffff" : "#e6e6e6" }) + bar, border);
}

/** Navigation key (PAG+, PAG-, go to page). */
export function renderNav({ label, sub = "", highlight = false, disabled = false, link }) {
	const bg = disabled ? "#151515" : highlight ? "#d9d9d9" : "#2c2c2c";
	const fg = disabled ? "#555555" : highlight ? "#101010" : "#ffffff";
	// Long labels ("PB PAGE +") get a smaller font so they stay inside the key.
	const size = label.length > 8 ? 20 : label.length > 6 ? 24 : 28;
	const main = textBlock([label], { y0: sub ? 60 : 72, size, fill: fg });
	const small = sub
		? `<text x="72" y="104" font-family="Arial" font-size="22" font-weight="700" fill="${fg}" text-anchor="middle" opacity="0.8">${esc(sub)}</text>`
		: "";
	// OSC link status dot: green = feedback arriving from MagicQ, red = nothing arriving.
	const dot = link === undefined ? "" : `<circle cx="124" cy="20" r="9" fill="${link ? "#22d65a" : "#e0301e"}"/>`;
	return svg(bg, main + small + dot);
}

/** Playback key: GO / PAUSE / FLASH icon, playback number and level. */
export function renderPb({ number, fn, active, level }) {
	const style = {
		go: { off: "#0f3d1c", on: "#1fae4a", label: "GO" },
		pause: { off: "#4a3600", on: "#e0a800", label: "PAUSE" },
		flash: { off: "#4a1010", on: "#e03030", label: "FLASH" },
		release: { off: "#1c2c4a", on: "#3a6ad0", label: "REL" },
	}[fn] ?? { off: "#2c2c2c", on: "#888888", label: "?" };
	const bg = active ? style.on : style.off;
	const ink = "#ffffff";
	let icon = "";
	if (fn === "go") icon = `<polygon points="52,38 52,92 98,65" fill="${ink}"/>`;
	else if (fn === "pause") icon = `<rect x="48" y="38" width="16" height="54" fill="${ink}"/><rect x="80" y="38" width="16" height="54" fill="${ink}"/>`;
	else if (fn === "release") icon = `<rect x="50" y="42" width="44" height="44" fill="${ink}"/>`;
	else if (fn === "flash") icon = `<polygon points="80,34 54,70 70,70 62,98 94,58 76,58" fill="${ink}"/>`;
	const border = active ? `<rect x="3" y="3" width="138" height="138" fill="none" stroke="#ffffff" stroke-width="6"/>` : "";
	const head = `<text x="9" y="20" font-family="Arial" font-size="17" font-weight="700" fill="${ink}" opacity="0.85">PB ${number}</text>`;
	const foot = `<text x="72" y="124" font-family="Arial" font-size="20" font-weight="700" fill="${ink}" text-anchor="middle" opacity="0.9">${style.label}</text>`;
	const bar = level !== undefined && level > 0
		? `<rect x="12" y="132" width="120" height="6" fill="#00000066"/><rect x="12" y="132" width="${Math.round(120 * Math.min(1, level))}" height="6" fill="#ffffff"/>`
		: "";
	return svg(bg, head + icon + foot + bar, border);
}

/** Page indicator: Executor, Playback or both. */
export function renderPageInfo({ what, execPage, execTotal, pbPage, ofLabel = "of", link }) {
	const dot = link === undefined ? "" : `<circle cx="126" cy="18" r="8" fill="${link ? "#22d65a" : "#e0301e"}"/>`;
	const label = (txt, y, size = 17) => `<text x="72" y="${y}" font-family="Arial" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="0.75">${txt}</text>`;
	const num = (txt, y, size) => `<text x="72" y="${y}" font-family="Arial" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${esc(String(txt))}</text>`;
	if (what === "exec") {
		return svg("#14304f", label("EXECUTOR", 24) + num(execPage, 78, 64) + (execTotal ? label(`${ofLabel} ${execTotal}`, 124) : "") + dot);
	}
	if (what === "pb") {
		return svg("#4a2a10", label("PLAYBACK", 24) + num(pbPage, 78, 64) + dot);
	}
	// Both: two halves.
	return svg(
		"#1a1a1a",
		`<rect x="0" y="0" width="144" height="72" fill="#14304f"/><rect x="0" y="72" width="144" height="72" fill="#4a2a10"/>` +
			label("EXECUTOR", 20, 15) + num(execPage, 49, 40) +
			label("PLAYBACK", 92, 15) + num(pbPage, 121, 40) + dot,
	);
}

/** Config key: MagicQ IP and ports, with the link status. */
export function renderConfig({ host, tx, rx, sendLabel = "send", listenLabel = "listen", link }) {
	const dot = `<circle cx="124" cy="22" r="11" fill="${link ? "#22d65a" : "#e0301e"}"/>`;
	const t = (y, size, txt, op = 1) => `<text x="72" y="${y}" font-family="Arial" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="${op}">${esc(String(txt))}</text>`;
	return svg("#222a33", `<text x="10" y="26" font-family="Arial" font-size="19" font-weight="700" fill="#ffffff">MagicQ</text>` + dot + t(62, host.length > 12 ? 17 : 20, host) + t(92, 20, `${sendLabel} ${tx}`, 0.9) + t(120, 20, `${listenLabel} ${rx}`, 0.9));
}
