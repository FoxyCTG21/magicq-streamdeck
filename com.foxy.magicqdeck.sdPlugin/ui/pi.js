// Shared code of the property inspector pages (the settings panel shown under each key).
// Texts are in English and Spanish; the language follows the Stream Deck application language.
const DICT = {
	en: {
		executorNumber: "Executor number",
		byPosition: "by key position",
		fixedPage: "Fixed page (optional)",
		followPage: "empty = current page",
		encoderDir: "If it is an Encoder",
		raise: "Raise (while held)",
		lower: "Lower (while held)",
		execHelp: "The number is the button's position in the Execute Window (1 = first). Left empty, the key uses its own position on the Stream Deck. With no fixed page, the key follows the Page +/- keys.",
		page: "Page",
		gotoHelp: "Jumps straight to this page of the Execute Window.",
		fn: "Function",
		fnGo: "Play (GO)",
		fnPause: "Pause",
		fnRelease: "Release (REL)",
		fnFlash: "Flash (while held)",
		pbNumber: "Playback number (1-10)",
		byColumn: "by column",
		pbHelp: "MagicQ only lets OSC control playbacks 1 to 10 of the active playback page. Change that page with the \"Playback Page +/-\" keys.",
		what: "What to show",
		both: "Executor and Playback",
		onlyExec: "Executor only",
		onlyPb: "Playback only",
		infoHelp: "The Executor page is the one of these keys (Page +/-). The Playback page is counted by the \"Playback Page +/-\" keys: if you change it on the console MagicQ does not report it, so the number can drift.",
		host: "MagicQ IP address",
		txPort: "Send port (MagicQ OSC Rx)",
		rxPort: "Listen port (MagicQ OSC Tx)",
		showFile: "Show file (.shw) or \"auto\"",
		hint: (tx, rx) => `In MagicQ (Setup > View Settings > Network): OSC mode Tx and Rx, Rx port = ${tx}, Tx port = ${rx}, transmit IP = the IP of this computer.`,
		configHelp: "Changes apply immediately, no restart needed. \"auto\" follows the show MagicQ has loaded. The key shows a green dot when MagicQ feedback arrives and red when it does not. Pressing it requests the state again.",
	},
	es: {
		executorNumber: "Número de executor",
		byPosition: "según la posición de la tecla",
		fixedPage: "Página fija (opcional)",
		followPage: "vacío = página actual",
		encoderDir: "Si es un Encoder",
		raise: "Subir (mientras se mantiene)",
		lower: "Bajar (mientras se mantiene)",
		execHelp: "El número es el del botón en el Execute Window (1 = el primero). Si lo dejas vacío, la tecla usa su propia posición en el Stream Deck. Sin página fija, la tecla sigue a las teclas Página +/-.",
		page: "Página",
		gotoHelp: "Salta directamente a esta página del Execute Window.",
		fn: "Función",
		fnGo: "Play (GO)",
		fnPause: "Pausa",
		fnRelease: "Release (REL)",
		fnFlash: "Flash (mientras se mantiene)",
		pbNumber: "Número de playback (1-10)",
		byColumn: "según la columna",
		pbHelp: "MagicQ solo permite controlar por OSC los playbacks 1 a 10 de la página de playbacks activa. Cambia esa página con las teclas \"Playback Página +/-\".",
		what: "Qué mostrar",
		both: "Executor y Playback",
		onlyExec: "Solo Executor",
		onlyPb: "Solo Playback",
		infoHelp: "La página de Executor es la de estas teclas (Página +/-). La de Playback la cuentan las teclas \"Playback Página +/-\": si la cambias en la consola MagicQ no lo avisa y el número se puede desfasar.",
		host: "IP de MagicQ",
		txPort: "Puerto de envío (OSC Rx de MagicQ)",
		rxPort: "Puerto de escucha (OSC Tx de MagicQ)",
		showFile: "Archivo del show (.shw) o \"auto\"",
		hint: (tx, rx) => `En MagicQ (Setup > View Settings > Network): modo OSC Tx y Rx, puerto Rx = ${tx}, puerto Tx = ${rx}, IP de transmisión = la IP de este equipo.`,
		configHelp: "Los cambios se aplican al momento, sin reiniciar. \"auto\" sigue el show que MagicQ tenga cargado. La tecla muestra un punto verde si llega feedback de MagicQ y rojo si no. Pulsarla pide el estado otra vez.",
	},
};

const PI = {
	lang: "en",
	t(key, ...args) {
		const v = DICT[PI.lang][key] ?? DICT.en[key] ?? key;
		return typeof v === "function" ? v(...args) : v;
	},
	/** Applies the texts to every element with data-i18n (text) or data-i18n-ph (placeholder). */
	translate() {
		for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = PI.t(el.dataset.i18n);
		for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = PI.t(el.dataset.i18nPh);
	},
	/**
	 * Connects the page to Stream Deck.
	 * fields: ids of the inputs to persist. global: store as plugin-wide settings instead of per key.
	 * onChange: optional callback after any value changes.
	 */
	init({ fields, global = false, onChange = () => {} }) {
		let ws;
		let uuid;
		let settings = {};
		const el = (id) => document.getElementById(id);
		const read = (id) => {
			const e = el(id);
			if (e.type === "number") return e.value === "" ? "" : Number(e.value);
			return e.value;
		};
		const save = () => {
			for (const id of fields) settings[id] = read(id);
			onChange(settings);
			ws.send(JSON.stringify({ event: global ? "setGlobalSettings" : "setSettings", context: uuid, payload: settings }));
		};
		const show = () => {
			for (const id of fields) if (document.activeElement !== el(id)) el(id).value = settings[id] ?? el(id).dataset.default ?? "";
			onChange(settings);
		};
		window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, info, actionInfo) => {
			uuid = inUUID;
			try {
				PI.lang = String(JSON.parse(info).application.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
			} catch { /* keep English */ }
			PI.translate();
			if (!global) {
				settings = JSON.parse(actionInfo).payload.settings || {};
				show();
			}
			ws = new WebSocket("ws://127.0.0.1:" + port);
			ws.onopen = () => {
				ws.send(JSON.stringify({ event: registerEvent, uuid: inUUID }));
				if (global) ws.send(JSON.stringify({ event: "getGlobalSettings", context: inUUID }));
			};
			ws.onmessage = (e) => {
				const m = JSON.parse(e.data);
				if (global && m.event === "didReceiveGlobalSettings") {
					settings = m.payload.settings || {};
					show();
				}
			};
			for (const id of fields) el(id).addEventListener(el(id).tagName === "SELECT" ? "change" : "input", save);
		};
	},
};
