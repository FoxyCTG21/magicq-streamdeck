// Minimal OSC over UDP, no dependencies. MagicQ only speaks OSC over UDP and does not use bundles.
import dgram from "node:dgram";

const pad4 = (n) => (n + 3) & ~3;

function oscString(s) {
	const b = Buffer.from(s + "\0", "utf8");
	return Buffer.concat([b, Buffer.alloc(pad4(b.length) - b.length)]);
}

/** Encodes an OSC message with int / float / string arguments. */
export function encode(address, ...args) {
	let tags = ",";
	const parts = [];
	for (const a of args) {
		if (a !== null && typeof a === "object" && "float" in a) { tags += "f"; const b = Buffer.alloc(4); b.writeFloatBE(a.float); parts.push(b); }
		else if (typeof a === "string") { tags += "s"; parts.push(oscString(a)); }
		else if (Number.isInteger(a)) { tags += "i"; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
		else { tags += "f"; const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
	}
	return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}

/** Decodes an OSC message -> { address, args }. Returns null if invalid. */
export function decode(buf) {
	try {
		let o = 0;
		const readStr = () => {
			const end = buf.indexOf(0, o);
			if (end < 0) throw new Error("unterminated string");
			const s = buf.toString("utf8", o, end);
			o = pad4(end + 1);
			return s;
		};
		const address = readStr();
		if (!address.startsWith("/")) return null;
		const tags = o < buf.length ? readStr() : ",";
		const args = [];
		for (const t of tags.slice(1)) {
			if (t === "i") { args.push(buf.readInt32BE(o)); o += 4; }
			else if (t === "f") { args.push(buf.readFloatBE(o)); o += 4; }
			else if (t === "s") args.push(readStr());
			else if (t === "T") args.push(1);
			else if (t === "F") args.push(0);
			else break; // unsupported type
		}
		return { address, args };
	} catch {
		return null;
	}
}

/** Link to MagicQ: sends to txPort, listens for feedback on rxPort. Can be reconfigured on the fly. */
export class MagicQLink {
	constructor({ host, txPort, rxPort }, onMessage) {
		this.host = host;
		this.txPort = txPort;
		this.rxPort = rxPort;
		this.onMessage = onMessage;
		this.log = () => {};
		this.sock = undefined;
	}

	#open() {
		const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
		sock.on("message", (buf) => {
			const msg = decode(buf);
			if (msg) this.onMessage(msg);
		});
		sock.on("error", (e) => this.log(`OSC socket: ${e.message}`));
		sock.bind(this.rxPort, () => this.log(`OSC listening for feedback on UDP ${this.rxPort}`));
		this.sock = sock;
	}

	start(log = () => {}) {
		this.log = log;
		this.#open();
	}

	/** Changes IP and ports. Only reopens the socket if the listening port changes. */
	reconfigure({ host, txPort, rxPort }) {
		this.host = host;
		this.txPort = txPort;
		if (rxPort !== this.rxPort) {
			this.rxPort = rxPort;
			this.stop();
			this.#open();
		}
	}

	send(address, ...args) {
		this.sock?.send(encode(address, ...args), this.txPort, this.host);
	}

	stop() {
		try { this.sock?.close(); } catch { /* already closed */ }
		this.sock = undefined;
	}
}

/** Executor feedback: /exec/<page>/<item> with one value -> { page, number, value } */
export function parseExecFeedback(msg) {
	const m = /^\/exec\/(\d+)\/(\d+)$/.exec(msg.address);
	if (!m) return null;
	const v = msg.args[0];
	return { page: Number(m[1]), number: Number(m[2]), value: typeof v === "number" ? v : 1 };
}
