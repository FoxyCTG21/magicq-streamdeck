// MagicQ Deck - Stream Deck plugin for ChamSys MagicQ.
//
//  * Reads the MagicQ show file and draws every key with the executor's name and colour.
//  * Key down / up sends OSC to MagicQ (/exec/<page>/<number>, /pb/<n>/go ...).
//  * Uses MagicQ's OSC feedback (/feedback/pb+exec) to show which buttons / playbacks are active.
//  * Detects when MagicQ is closed and dims the keys.
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadShow, pageNumbers, buttonFor, soloPeers } from "./show.js";
import { MagicQLink, parseExecFeedback } from "./osc.js";
import { renderExec, renderNav, renderPb, renderPageInfo, renderConfig } from "./render.js";

const PLUGIN = "com.foxy.magicqdeck";
const UUID = {
	exec: `${PLUGIN}.exec`,
	next: `${PLUGIN}.next`,
	prev: `${PLUGIN}.prev`,
	goto: `${PLUGIN}.goto`,
	pb: `${PLUGIN}.pb`,
	pbnext: `${PLUGIN}.pbnext`,
	pbprev: `${PLUGIN}.pbprev`,
	pageinfo: `${PLUGIN}.pageinfo`,
	config: `${PLUGIN}.config`,
};

const log = streamDeck.logger;
const here = dirname(fileURLToPath(import.meta.url));

// ---------- language (texts drawn on the keys) ----------
const TEXT = {
	en: { page: "PAGE", send: "send", listen: "listen", of: "of" },
	es: { page: "PAG", send: "envío", listen: "escucha", of: "de" },
};
function lang() {
	try {
		return String(streamDeck.info.application.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
	} catch {
		return "en"; // info is not available until the plugin has registered
	}
}
const T = (key) => TEXT[lang()][key];

// ---------- configuration ----------
const DEFAULTS = {
	show_file: "auto", // "auto" = the show MagicQ currently has loaded; or a full path to a .shw / .sbk
	magicq_host: "127.0.0.1",
	osc_tx_port: 8000, // MagicQ's OSC *receive* port: where this plugin sends
	osc_rx_port: 9000, // MagicQ's OSC *transmit* port: where this plugin listens for feedback
	item_base: 1, // executor number = index stored in the show + item_base
	start_page: 1,
	refresh_seconds: 1, // how often the OSC state is requested (MagicQ answers at most every 3 s)
	feedback_address: "/feedback/pb+exec", // executors and playbacks
	pb_page_start: 1, // playback page MagicQ is assumed to be on when the plugin starts
	pb_page_max: 10, // the playback page keys wrap around at this number
	encoder_repeat_ms: 120, // repeat interval of an encoder step while the key is held
	log_osc: false, // log every OSC message that is sent
};

function loadConfig() {
	const file = join(here, "..", "config.json");
	try {
		return { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf8")) };
	} catch (e) {
		log.warn(`config.json not readable (${e.message}); using defaults`);
		return { ...DEFAULTS };
	}
}
const cfg = loadConfig();

// ---------- state ----------
let show = { pages: new Map() };
let page = cfg.start_page; // executor page shown on the Stream Deck
let pbPage = cfg.pb_page_start; // playback page (counted locally: MagicQ does not report it over OSC)
const activeNow = new Map(); // "page:number" -> feedback value
const pbLevel = new Map(); // playback -> level 0..1
const pbFlash = new Map(); // playback -> flash state
const visible = new Map(); // action id -> { action, kind, settings, autoNumber }
const pbHeld = new Set(); // ids of playback Flash keys that are held down
const pbPulse = new Map(); // id -> time until a just-pressed GO/PAUSE/REL key stays highlighted
const encTimers = new Map(); // encoder auto-repeat timers
const graceUntil = new Map(); // key -> time until stale feedback is ignored after a press
const ACTIVE_MIN = 0.01; // minimum level to consider a playback active

// ---------- show file ----------
const MQ_SHOW_DIR = join(homedir(), "Documents", "MagicQ", "show");

/** The show MagicQ has loaded: its status file starts with T,"<path>"; otherwise the newest .shw. */
function autoShowPath() {
	try {
		const status = readFileSync(join(MQ_SHOW_DIR, "status.dat"), "latin1");
		const m = /^T,"([^"]+)"/m.exec(status);
		if (m && /\.(shw|sbk)$/i.test(m[1]) && existsSync(m[1])) return m[1];
	} catch { /* MagicQ never ran here, or the file is locked */ }
	try {
		const newest = readdirSync(MQ_SHOW_DIR)
			.filter((f) => /\.shw$/i.test(f))
			.map((f) => ({ f: join(MQ_SHOW_DIR, f), t: statSync(join(MQ_SHOW_DIR, f)).mtimeMs }))
			.sort((a, b) => b.t - a.t)[0];
		if (newest) return newest.f;
	} catch { /* no show folder */ }
	return "";
}
let autoCache = { at: 0, path: "" };
function showPath() {
	if (cfg.show_file && cfg.show_file !== "auto") return cfg.show_file;
	if (Date.now() - autoCache.at > 5000) autoCache = { at: Date.now(), path: autoShowPath() };
	return autoCache.path;
}

/** Of <name>.shw and <name>.sbk (MagicQ's autosave) returns the most recently written one. */
function newestShowFile(path) {
	if (!path) return "";
	const base = path.replace(/\.(shw|sbk)$/i, "");
	return [`${base}.shw`, `${base}.sbk`]
		.filter(existsSync)
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? "";
}

let loadedFile = "";
let loadedMtime = 0;
function reloadShow(force = false) {
	try {
		const file = newestShowFile(showPath());
		if (!file) {
			if (loadedFile) { loadedFile = ""; loadedMtime = 0; show = { pages: new Map() }; renderAll(true); }
			return;
		}
		const mtime = statSync(file).mtimeMs;
		if (!force && file === loadedFile && mtime === loadedMtime) return;
		show = loadShow(file);
		loadedFile = file;
		loadedMtime = mtime;
		const pages = pageNumbers(show);
		if (!show.pages.has(page) && pages.length) page = pages[0];
		log.info(`Show loaded: ${file} (${pages.length} pages)`);
		renderAll();
	} catch (e) {
		log.error(`Could not read the show: ${e.message}`);
	}
}

// ---------- OSC link ----------
const rx = { last: 0 }; // time of the last OSC message received from MagicQ

const link = new MagicQLink(
	{ host: cfg.magicq_host, txPort: cfg.osc_tx_port, rxPort: cfg.osc_rx_port },
	(msg) => {
		rx.last = Date.now();
		const pf = /^\/pb\/(\d+)\/flash$/.exec(msg.address);
		if (pf) {
			const v = Number(msg.args[0]) > 0 ? 1 : 0;
			if (pbFlash.get(Number(pf[1])) !== v) { pbFlash.set(Number(pf[1]), v); scheduleRender(); }
			return;
		}
		const pb = /^\/pb\/(\d+)$/.exec(msg.address);
		if (pb) {
			const raw = Number(msg.args[0]);
			const level = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : 0; // 0..1 or 0..100
			if (pbLevel.get(Number(pb[1])) !== level) { pbLevel.set(Number(pb[1]), level); scheduleRender(); }
			return;
		}
		const fb = parseExecFeedback(msg);
		if (!fb) return;
		const key = `${fb.page}:${fb.number}`;
		// Right after a press MagicQ may still report the old state: do not override the optimistic change.
		if ((graceUntil.get(key) ?? 0) > Date.now()) return;
		if ((activeNow.get(key) ?? 0) !== fb.value) {
			activeNow.set(key, fb.value);
			scheduleRender();
		}
	},
);

// With MagicQ open a feedback dump arrives every ~3 s: 8 s of silence means it is closed / not reachable.
// Exception: while keys are being pressed very fast (a dozen presses per second) MagicQ is busy and
// stops sending its dumps for as long as the flood lasts (measured: 26 s). So silence is forgiven while
// the user is still pressing, and judged again 8 s after the last press (MagicQ answers within ~3 s once
// the flood stops). A hard limit keeps a MagicQ that really died from looking alive forever.
const LINK_SILENCE_MS = 8000;
const LINK_BUSY_SILENCE_MAX_MS = 60000;
let lastSendAt = 0; // last key press sent to MagicQ
const pressTimes = []; // recent press times, for the diagnostic message
function linkOk() {
	const now = Date.now();
	const silence = now - rx.last;
	if (silence < LINK_SILENCE_MS) return true;
	return now - lastSendAt < LINK_SILENCE_MS && silence < LINK_BUSY_SILENCE_MAX_MS;
}
let linkWas = false;

// Feedback requests are rate limited: MagicQ answers with a full dump at most every ~3 s anyway, and
// flooding it with requests while keys are spammed is counterproductive. Calls inside the minimum gap
// collapse into a single trailing request.
const MIN_REQUEST_GAP_MS = 400;
let lastRequestAt = 0;
let trailingRequest;
function requestFeedback() {
	const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
	if (wait > 0) {
		if (!trailingRequest) trailingRequest = setTimeout(() => { trailingRequest = undefined; requestFeedback(); }, wait);
		return;
	}
	lastRequestAt = Date.now();
	link.send(cfg.feedback_address);
}

// MagicQ does NOT announce changes made through OSC (only those made with the mouse or the console).
// So after a press the state is requested again a few times; this also covers SOLO groups,
// where activating one button turns the others off. The early requests are only armed once per
// burst of presses, the late ones are re-armed so the last press always gets a final refresh.
let lateTimers = [];
let lastEarlyAt = 0;
function refreshBurst() {
	const now = Date.now();
	if (now - lastEarlyAt > 600) {
		lastEarlyAt = now;
		for (const ms of [30, 300]) setTimeout(requestFeedback, ms);
	}
	lateTimers.forEach(clearTimeout);
	lateTimers = [900, 1800, 3000].map((ms) => setTimeout(requestFeedback, ms));
}

const sendOsc = (address, ...args) => {
	if (cfg.log_osc) log.info(`OSC tx ${address} ${JSON.stringify(args)}`);
	link.send(address, ...args);
	lastSendAt = Date.now();
	pressTimes.push(lastSendAt);
	while (pressTimes.length && lastSendAt - pressTimes[0] > 10000) pressTimes.shift();
	refreshBurst();
};

// ---------- drawing ----------
// A feedback dump brings hundreds of messages in a row: coalesce the redraws.
let renderTimer;
function scheduleRender() {
	if (renderTimer) return;
	renderTimer = setTimeout(() => { renderTimer = undefined; renderAll(); }, 25);
}

// Stream Deck needs a data URL; a raw SVG string is ignored.
const toImage = (svg) => "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);

// With MagicQ unreachable every key is dimmed and gets a red strip (the config key is left alone).
const OFFLINE_OVERLAY = `<rect width="144" height="144" fill="#000000" opacity="0.6"/><rect x="0" y="134" width="144" height="10" fill="#e0301e"/>`;
const withOffline = (svg, kind) => (linkOk() || kind === "config" ? svg : svg.replace("</svg>", OFFLINE_OVERLAY + "</svg>"));

const pageOf = (settings) => {
	const p = Number(settings?.page);
	return Number.isInteger(p) && p > 0 ? p : page;
};

/** Executor number of a key: the one typed in its inspector, or its position (row * columns + column + 1). */
function numberOf(entry) {
	const n = Number(entry.settings?.number);
	if (Number.isInteger(n) && n > 0) return n;
	return entry.autoNumber ?? 0;
}

/** Playback number of a key: typed (1-10) or, by default, derived from its column. */
function pbNumberOf(entry) {
	const n = Number(entry.settings?.number);
	if (Number.isInteger(n) && n >= 1 && n <= 10) return n;
	return (((entry.autoNumber ?? 1) - 1) % 10) + 1;
}

function imageFor(entry) {
	const { kind, settings } = entry;
	const pages = pageNumbers(show);
	const lastPage = pages.length ? pages[pages.length - 1] : 0;
	switch (kind) {
		case "exec": {
			const number = numberOf(entry);
			const p = pageOf(settings);
			const button = buttonFor(show, p, number, cfg.item_base);
			const value = activeNow.get(`${p}:${number}`) ?? 0;
			const level = value > 0 && value < 1 ? value : undefined;
			const tag = button?.kind === "encoder" ? (settings.dir === "down" ? "E -" : "E +") : undefined;
			return renderExec({ number, button, active: value > 0, level, tag });
		}
		case "pb": {
			const n = pbNumberOf(entry);
			const fn = settings.fn || "go";
			const level = pbLevel.get(n);
			const pressed = pbHeld.has(entry.action.id) || (pbPulse.get(entry.action.id) ?? 0) > Date.now();
			// Play and Flash light up while that playback is active; Pause and Release only when pressed.
			const active = pressed || (fn === "flash" && (pbFlash.get(n) ?? 0) > 0) || (fn === "go" && (level ?? 0) > ACTIVE_MIN);
			return renderPb({ number: n, fn, active, level });
		}
		case "pageinfo":
			return renderPageInfo({ what: settings.what || "both", execPage: page, execTotal: lastPage, pbPage, ofLabel: T("of"), link: linkOk() });
		case "config":
			return renderConfig({ host: cfg.magicq_host, tx: cfg.osc_tx_port, rx: cfg.osc_rx_port, sendLabel: T("send"), listenLabel: T("listen"), link: linkOk() });
		case "pbnext":
			return renderNav({ label: `PB ${T("page")} +`, sub: String(pbPage), link: linkOk() });
		case "pbprev":
			return renderNav({ label: `PB ${T("page")} -`, sub: String(pbPage), link: linkOk() });
		case "next":
			return renderNav({ label: `${T("page")} +`, sub: lastPage ? `${page}/${lastPage}` : "?", link: linkOk() });
		case "prev":
			return renderNav({ label: `${T("page")} -`, sub: lastPage ? `${page}/${lastPage}` : "?", link: linkOk() });
		case "goto": {
			const target = Number(settings.page) || 1;
			return renderNav({ label: `${T("page")} ${target}`, highlight: target === page, disabled: !show.pages.has(target), link: linkOk() });
		}
		default:
			return renderNav({ label: "?" });
	}
}

function renderOne(entry, force = false) {
	const svg = withOffline(imageFor(entry), entry.kind);
	if (!force && entry.lastSvg === svg) return;
	entry.lastSvg = svg;
	entry.action.setImage(toImage(svg)).catch((e) => log.error(`setImage: ${e.message}`));
}
function renderAll(force = false) {
	for (const entry of visible.values()) renderOne(entry, force);
}

function setPage(p) {
	if (p === page) return;
	page = p;
	requestFeedback();
	renderAll();
}
function stepPage(delta) {
	const pages = pageNumbers(show);
	if (!pages.length) return;
	const i = Math.max(0, pages.indexOf(page));
	setPage(pages[(i + delta + pages.length) % pages.length]);
}

// Playback page change: the remote command "<page>P" sent through /rpc.
function setPbPage(p) {
	const max = Math.max(1, cfg.pb_page_max);
	pbPage = ((p - 1 + max) % max) + 1;
	sendOsc("/rpc", pbPage + "P");
	scheduleRender();
}

// ---------- actions ----------
class Base extends SingletonAction {
	kind = "";
	onWillAppear(ev) {
		const c = ev.action.isKey() ? ev.action.coordinates : undefined;
		const cols = ev.action.device?.size?.columns ?? 8;
		const autoNumber = c ? c.row * cols + c.column + 1 : undefined;
		visible.set(ev.action.id, { action: ev.action, kind: this.kind, settings: ev.payload.settings ?? {}, autoNumber });
		renderOne(visible.get(ev.action.id));
	}
	onWillDisappear(ev) {
		pbHeld.delete(ev.action.id);
		clearInterval(encTimers.get(ev.action.id));
		encTimers.delete(ev.action.id);
		visible.delete(ev.action.id);
	}
	onDidReceiveSettings(ev) {
		const entry = visible.get(ev.action.id);
		if (entry) { entry.settings = ev.payload.settings ?? {}; renderOne(entry); }
	}
}

class ExecAction extends Base {
	manifestId = UUID.exec;
	kind = "exec";
	#target(ev) {
		const entry = visible.get(ev.action.id);
		if (!entry) return null;
		const number = numberOf(entry);
		if (number < 1) return null;
		const p = pageOf(entry.settings);
		return { addr: `/exec/${p}/${number}`, page: p, number, key: `${p}:${number}`, button: buttonFor(show, p, number, cfg.item_base) };
	}
	// Immediate local change (MagicQ confirms through feedback only every ~3 s); real feedback corrects it.
	#optimistic(key, value) {
		activeNow.set(key, value);
		graceUntil.set(key, Date.now() + 450);
	}
	onKeyDown(ev) {
		const t = this.#target(ev);
		if (!t) return;
		const kind = t.button?.kind ?? "button";
		const on = (activeNow.get(t.key) ?? 0) > 0;
		if (kind === "flash") {
			// Flash: active while the key is held.
			sendOsc(t.addr, 1);
			this.#optimistic(t.key, 1);
		} else if (kind === "fader") {
			// Fader: toggles between 0 % and 100 % (a float sets the level).
			sendOsc(t.addr, { float: on ? 0.0 : 1.0 });
			this.#optimistic(t.key, on ? 0 : 1);
		} else if (kind === "encoder") {
			// Encoder: 1 = raise, 0 = lower; repeats while the key is held.
			const dir = visible.get(ev.action.id)?.settings?.dir === "down" ? 0 : 1;
			const step = () => sendOsc(t.addr, dir);
			step();
			clearInterval(encTimers.get(ev.action.id));
			encTimers.set(ev.action.id, setInterval(step, cfg.encoder_repeat_ms));
			return;
		} else {
			// Button / Button (SOLO): a single "activate", like a mouse click.
			sendOsc(t.addr);
			const next = on ? 0 : 1;
			this.#optimistic(t.key, next);
			if (kind === "solo" && next === 1) {
				// SOLO group: activating one button turns the others of its group off.
				for (const peer of soloPeers(show, t.page, t.number, cfg.item_base)) this.#optimistic(`${t.page}:${peer}`, 0);
			}
		}
		scheduleRender();
	}
	onKeyUp(ev) {
		clearInterval(encTimers.get(ev.action.id));
		encTimers.delete(ev.action.id);
		const t = this.#target(ev);
		if (!t) return;
		if (t.button?.kind === "flash") {
			sendOsc(t.addr, 0);
			this.#optimistic(t.key, 0);
			scheduleRender();
		} else {
			// Nothing is sent on release, but the state is refreshed a second time.
			refreshBurst();
		}
	}
}

class PbAction extends Base {
	manifestId = UUID.pb;
	kind = "pb";
	#info(ev) {
		const entry = visible.get(ev.action.id);
		return entry ? { n: pbNumberOf(entry), fn: entry.settings?.fn || "go" } : null;
	}
	onKeyDown(ev) {
		const i = this.#info(ev);
		if (!i) return;
		if (i.fn === "flash") {
			pbHeld.add(ev.action.id);
			sendOsc(`/pb/${i.n}/flash`, 1);
		} else {
			sendOsc(`/pb/${i.n}/${i.fn === "pause" ? "pause" : i.fn === "release" ? "release" : "go"}`, 1);
			pbPulse.set(ev.action.id, Date.now() + 250);
			setTimeout(scheduleRender, 270);
		}
		scheduleRender();
	}
	onKeyUp(ev) {
		const i = this.#info(ev);
		if (i?.fn === "flash") {
			pbHeld.delete(ev.action.id);
			sendOsc(`/pb/${i.n}/flash`, 0);
			scheduleRender();
		}
	}
}

class PbNextAction extends Base {
	manifestId = UUID.pbnext;
	kind = "pbnext";
	onKeyDown() { setPbPage(pbPage + 1); }
}
class PbPrevAction extends Base {
	manifestId = UUID.pbprev;
	kind = "pbprev";
	onKeyDown() { setPbPage(pbPage - 1); }
}
class NextAction extends Base {
	manifestId = UUID.next;
	kind = "next";
	onKeyDown() { stepPage(1); }
}
class PrevAction extends Base {
	manifestId = UUID.prev;
	kind = "prev";
	onKeyDown() { stepPage(-1); }
}
class GotoAction extends Base {
	manifestId = UUID.goto;
	kind = "goto";
	onKeyDown(ev) {
		const p = Number(ev.payload.settings?.page);
		if (Number.isInteger(p) && p > 0) setPage(p);
	}
}

/** Shows the executor page and / or the playback page (nothing happens when pressed). */
class PageInfoAction extends Base {
	manifestId = UUID.pageinfo;
	kind = "pageinfo";
}

/** Connection settings live in its inspector (stored by Stream Deck). Pressing it requests the state again. */
class ConfigAction extends Base {
	manifestId = UUID.config;
	kind = "config";
	onKeyDown() {
		requestFeedback();
		renderAll(true);
	}
}

// ---------- global settings (IP, ports, show) ----------
const GLOBAL_KEYS = { host: "magicq_host", txPort: "osc_tx_port", rxPort: "osc_rx_port", showFile: "show_file" };
const effectiveSettings = () => ({ host: cfg.magicq_host, txPort: cfg.osc_tx_port, rxPort: cfg.osc_rx_port, showFile: cfg.show_file });

function applyGlobalSettings(g) {
	if (!g || typeof g !== "object") return;
	const before = { ...cfg };
	const host = String(g.host ?? "").trim();
	if (host) cfg.magicq_host = host;
	for (const k of ["txPort", "rxPort"]) {
		const n = Number(g[k]);
		if (Number.isInteger(n) && n > 1023 && n < 65536) cfg[GLOBAL_KEYS[k]] = n;
	}
	const sf = String(g.showFile ?? "").trim();
	if (sf) cfg.show_file = sf.split("\\").join("/");
	if (cfg.magicq_host !== before.magicq_host || cfg.osc_tx_port !== before.osc_tx_port || cfg.osc_rx_port !== before.osc_rx_port) {
		log.info(`Settings: MagicQ ${cfg.magicq_host} send ${cfg.osc_tx_port} listen ${cfg.osc_rx_port}`);
		link.reconfigure({ host: cfg.magicq_host, txPort: cfg.osc_tx_port, rxPort: cfg.osc_rx_port });
		rx.last = 0; // until feedback arrives on the new port the link counts as down
		setTimeout(requestFeedback, 300);
	}
	if (cfg.show_file !== before.show_file) {
		log.info(`Settings: show ${cfg.show_file}`);
		autoCache = { at: 0, path: "" };
		reloadShow(true);
	}
	renderAll(true);
}

// ---------- start ----------
for (const action of [
	new ExecAction(), new NextAction(), new PrevAction(), new GotoAction(), new PbAction(),
	new PbNextAction(), new PbPrevAction(), new PageInfoAction(), new ConfigAction(),
]) streamDeck.actions.registerAction(action);

link.start((m) => log.info(m));
reloadShow(true);
setInterval(() => reloadShow(), 1000); // follows MagicQ saves / autosaves and the show it has loaded
setInterval(() => renderAll(true), 5000); // resends the images (self-heals) and refreshes the link indicator
setInterval(requestFeedback, Math.max(0.5, cfg.refresh_seconds) * 1000);
setTimeout(requestFeedback, 1500);

// Link watchdog, once per second. When the link is lost the old state is forgotten so that no stale data is shown.
setInterval(() => {
	const ok = linkOk();
	if (ok === linkWas) return;
	linkWas = ok;
	log.info(ok
		? "MagicQ connected: feedback is arriving"
		: `MagicQ not reachable: no feedback for ${Math.round((Date.now() - rx.last) / 1000)} s (${pressTimes.length} presses in the last 10 s)`);
	if (!ok) {
		activeNow.clear();
		pbLevel.clear();
		pbFlash.clear();
		graceUntil.clear();
	} else {
		requestFeedback();
	}
	renderAll(true);
}, 1000);

// Settings stored by Stream Deck (edited with the "MagicQ Settings" key). If none exist yet the
// current values are stored so the inspector can show them.
streamDeck.settings.onDidReceiveGlobalSettings((ev) => applyGlobalSettings(ev.settings));
streamDeck.connect().then(async () => {
	const stored = await streamDeck.settings.getGlobalSettings();
	if (stored && stored.host) applyGlobalSettings(stored);
	else await streamDeck.settings.setGlobalSettings(effectiveSettings());
});
