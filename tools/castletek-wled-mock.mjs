import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.CASTLETEK_MOCK_PORT || 43160);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, "wled00", "data");
const base = "/castletek/v1";
const renameMode = process.env.CASTLETEK_MOCK_RENAME_MODE || "normal";
const effects = ["Solid", "Twinkle", "Fire 2012", "Aurora", "Dissolve", "Breathe", "PacMan"];
const effectMetadata = [
	"",
	"!,!;!,!;!",
	"Cooling,Spark rate;;!;1",
	"!,!;1,2,3;!",
	"Repeat speed,Dissolve speed,,,,Random,Complete;!,!;!",
	"!;!,!;!",
	"Speed,# of PowerDots,Blink distance,Blur,# of Ghosts,Dots,Smear,Compact;;!;1;m12=0,sx=192,ix=64,c1=64,c2=0,c3=12,o1=1,o2=0"
];
const palettes = [
	"Default", "* Random Cycle", "* Color 1", "* Colors 1&2", "* Color Gradient", "* Colors Only",
	"Party", "Christmas", "Sunset", "Fire", "Aurora"
];
let bootPreset = 0;
let persistedBootPreset = 0;
let controllerName = process.env.CASTLETEK_MOCK_NAME || "CastleTek RC12 Host Mock";
let simplifiedUI = process.env.CASTLETEK_MOCK_SIMPLIFIED_UI !== "false";
let state = {
	on: true,
	bri: 164,
	transition: 7,
	bs: 0,
	mainseg: 0,
	ps: -1,
	pl: -1,
	seg: [
		{ id: 0, n: "Output 1 · None", start: 0, stop: 10, grp: 1, spc: 0, of: 0, on: true, bri: 255, rev: false, mi: false, sel: true, lc: 3, col: [[255, 159, 10, 96], [35, 145, 255, 32], [190, 40, 255, 64]], fx: 1, pal: 2, sx: 138, ix: 176 },
		{ id: 1, n: "Output 2 · Accurate", start: 10, stop: 20, grp: 1, spc: 0, of: 0, on: true, bri: 220, rev: false, mi: false, sel: false, lc: 1, col: [[40, 130, 255, 24]], fx: 2, pal: 1, sx: 110, ix: 150 },
		{ id: 2, n: "Output 3 · CCT", start: 20, stop: 30, grp: 1, spc: 0, of: 0, on: true, bri: 255, rev: false, mi: false, sel: true, lc: 5, cct: 180, col: [[175, 70, 240, 0]], fx: 3, pal: 3, sx: 160, ix: 120 },
		{ id: 3, n: "Output 4 · White", start: 30, stop: 40, grp: 1, spc: 0, of: 0, on: true, bri: 255, rev: false, mi: false, sel: false, lc: 2, col: [[255, 244, 221, 200]], fx: 0, pal: 0, sx: 128, ix: 128 }
	]
};
if (process.env.CASTLETEK_MOCK_SEGMENTS === "single") {
	state.seg = [{ ...state.seg[0], n: "All lights", start: 0, stop: 40, sel: true }];
}
state.seg = state.seg.map(segment => completeSegment(segment));
let presets = {
	1: { n: "Warm Welcome", on: true, bri: 164, mainseg: 0, seg: [{ ...state.seg[0] }] },
	2: { n: "Holiday Playlist", playlist: { ps: [1], dur: [100], transition: [7], repeat: 0, r: false, end: 0 } }
};
const requests = [];
const deliveries = [];
let lastRenameRequestId = "";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function completeSegment(segment) {
	const colorSlot = value => Array.from({ length: 4 }, (_, index) => Number(value?.[index]) || 0);
	return {
		grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, cct: 127, set: 0, lc: 3,
		col: [[255, 170, 0], [0, 0, 0], [0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0,
		c1: 128, c2: 128, c3: 16, sel: false, rev: false, mi: false,
		o1: false, o2: false, o3: false, si: 0, m12: 0, bm: 0,
		...segment,
		col: [colorSlot(segment.col?.[0] || [255, 170, 0]), colorSlot(segment.col?.[1]), colorSlot(segment.col?.[2])]
	};
}

const files = new Map([
	[`${base}/`, ["castletek.htm", "text/html; charset=utf-8"]],
	[`${base}/settings`, ["settings.htm", "text/html; charset=utf-8"]],
	[`${base}/common.js`, ["common.js", "text/javascript; charset=utf-8"]],
	[`${base}/style.css`, ["style.css", "text/css; charset=utf-8"]],
	[`${base}/castletek-control.css`, ["castletek-control.css", "text/css; charset=utf-8"]],
	[`${base}/castletek-control-model.js`, ["castletek-control-model.js", "text/javascript; charset=utf-8"]],
	[`${base}/castletek-control.js`, ["castletek-control.js", "text/javascript; charset=utf-8"]],
	[`${base}/castletek-branding.css`, ["castletek-branding.css", "text/css; charset=utf-8"]],
	[`${base}/castletek-branding.js`, ["castletek-branding.js", "text/javascript; charset=utf-8"]],
	[`${base}/castletek-logo.png`, ["castletek-logo.png", "image/png"]],
	[`${base}/iro.js`, ["iro.js", "text/javascript; charset=utf-8"]],
	[`${base}/favicon.svg`, ["favicon.svg", "image/svg+xml"]]
]);

function json(res, value) {
	res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
	res.end(JSON.stringify(value));
}

function info() {
	return {
		name: controllerName,
		ver: "0.16.0",
		ip: "192.0.2.44",
		simplifiedui: simplifiedUI,
		leds: { count: 40, maxseg: 32, bootps: bootPreset, matrix: null }
	};
}

function activeSegments() {
	return state.seg.filter(segment => Number(segment.stop) > Number(segment.start || 0));
}

function publicState() {
	return { ...state, seg: activeSegments() };
}

function effectDefaults(effectId) {
	const defaults = { sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false };
	const encoded = effectMetadata[Number(effectId)]?.split(";")[4] || "";
	for (const assignment of encoded.split(",")) {
		const [key, rawValue] = assignment.split("=");
		if (!Object.prototype.hasOwnProperty.call(defaults, key) || !/^-?\d+$/.test(rawValue || "")) continue;
		const value = Number(rawValue);
		defaults[key] = key.startsWith("o") ? Boolean(value) : value;
	}
	return defaults;
}

export function mergeColorSlot(current, patch) {
	const existing = Array.from({ length: 4 }, (_, index) => Number(current?.[index]) || 0);
	if (Array.isArray(patch)) {
		if (!patch.length) return existing;
		return Array.from({ length: 4 }, (_, index) => Number(patch[index]) || 0);
	}
	if (!patch || typeof patch !== "object") return existing;
	for (const [index, name] of ["r", "g", "b", "w"].entries()) {
		if (Object.prototype.hasOwnProperty.call(patch, name)) existing[index] = Number(patch[name]) || 0;
	}
	return existing;
}

export function mergeSegmentColors(current, patch) {
	const colors = Array.from({ length: 3 }, (_, index) => mergeColorSlot(current?.[index], []));
	if (!Array.isArray(patch)) return colors;
	for (const [index, value] of patch.entries()) {
		if (index >= colors.length || value == null) continue;
		colors[index] = mergeColorSlot(colors[index], value);
	}
	return colors;
}

export function segmentPatchStopsPlaylist(patch) {
	if (!patch || !Object.prototype.hasOwnProperty.call(patch, "fx")) return false;
	const effect = Number(patch.fx);
	return Number.isInteger(effect) && effect >= 0;
}

function applySegmentPatch(patch, fallbackIndex = 0) {
	const requestedId = Number(patch.id ?? fallbackIndex);
	if (!Number.isInteger(requestedId) || requestedId < 0 || requestedId >= info().leds.maxseg) return;
	let id = requestedId;
	let index = id < state.seg.length ? id : -1;
	if (index < 0) {
		if (!(Number(patch.stop) > 0)) return;
		id = state.seg.length;
		index = id;
		state.seg.push(completeSegment({ id, n: "", start: 0, stop: 40 }));
	}

	const existing = state.seg[index];
	const start = Object.prototype.hasOwnProperty.call(patch, "start") ? Number(patch.start) : Number(existing.start);
	const stop = Object.prototype.hasOwnProperty.call(patch, "stop") ? Number(patch.stop) : Number(existing.stop);
	const geometryChanged = start !== Number(existing.start) || stop !== Number(existing.stop);
	const { fxdef, col, ...statePatch } = patch;
	if (geometryChanged && !Object.prototype.hasOwnProperty.call(patch, "n")) statePatch.n = "";
	statePatch.start = start;
	statePatch.stop = stop;
	if (stop > start) {
		const length = stop - start;
		if (Object.prototype.hasOwnProperty.call(patch, "of")) {
			let offset = Math.abs(Number(patch.of) || 0);
			if (offset > length - 1) offset %= length;
			statePatch.of = Number(patch.of) < 0 ? length - offset : offset;
		} else if (Number(existing.of) > length - 1) statePatch.of = length - 1;
	}
	if (!(stop > start)) {
		state.seg[index] = { ...existing, ...statePatch, id };
		if (id === state.mainseg) state.mainseg = 0;
		return;
	}

	{
		if (segmentPatchStopsPlaylist(statePatch)) state.pl = -1;
		const modeDefaults = fxdef && statePatch.fx != null && Number(statePatch.fx) !== Number(existing.fx)
			? effectDefaults(statePatch.fx)
			: {};
		state.seg[index] = {
			...existing, ...modeDefaults, ...statePatch,
			...(col == null ? {} : { col: mergeSegmentColors(existing.col, col) }),
			id
		};
	}
}

function serializedPreset(update) {
	const selected = activeSegments().filter(segment => !update.sc || segment.sel);
	const result = { n: String(update.n || `Preset ${update.psave}`), mainseg: state.mainseg };
	if (update.ql) result.ql = update.ql;
	if (update.ib) {
		result.on = state.on;
		result.bri = state.bri;
		result.transition = 7;
		result.bs = 0;
	}
	const serializeSegment = segment => {
		const saved = {
			id: segment.id,
			grp: segment.grp,
			spc: segment.spc,
			of: segment.of,
			on: segment.on,
			frz: segment.frz,
			bri: segment.bri,
			cct: segment.cct,
			set: segment.set,
			lc: segment.lc,
			n: segment.n,
			col: segment.col,
			fx: segment.fx,
			sx: segment.sx,
			ix: segment.ix,
			pal: segment.pal,
			c1: segment.c1,
			c2: segment.c2,
			c3: segment.c3,
			sel: segment.sel,
			rev: segment.rev,
			mi: segment.mi,
			o1: segment.o1,
			o2: segment.o2,
			o3: segment.o3,
			si: segment.si,
			m12: segment.m12,
			bm: segment.bm
		};
		if (update.sb) {
			saved.start = segment.start;
			saved.stop = segment.stop;
		}
		return saved;
	};
	if (update.sb && !update.sc) {
		result.seg = Array.from({ length: 32 }, (_, id) => {
			const segment = selected.find(candidate => candidate.id === id);
			return segment ? serializeSegment(segment) : { stop: 0 };
		});
	} else result.seg = selected.map(serializeSegment);
	return result;
}

function applyPreset(id) {
	const preset = presets[String(id)];
	if (!preset || preset.playlist) {
		state.ps = Number(id);
		state.pl = preset?.playlist ? Number(id) : -1;
		return;
	}
	const { n: _name, ql: _quickLoad, seg, ...global } = preset;
	state = { ...state, ...global, ps: Number(id), pl: -1 };
	if (Array.isArray(seg)) {
		for (const [index, patch] of seg.entries()) applySegmentPatch(patch, index);
	}
}

function applyUpdate(update) {
	if (Object.prototype.hasOwnProperty.call(update, "mainseg")) {
		const active = activeSegments();
		const requested = Number(update.mainseg);
		state.mainseg = active.length ? active[active.length - 1].id : 0;
		if (active.some(segment => segment.id === requested)) state.mainseg = requested;
	}
	if (Array.isArray(update.seg)) {
		for (const [index, patch] of update.seg.entries()) applySegmentPatch(patch, index);
	} else if (update.seg && typeof update.seg === "object") {
		if (update.seg.id != null) applySegmentPatch(update.seg);
		else for (const segment of activeSegments().filter(candidate => candidate.sel)) applySegmentPatch({ ...update.seg, id: segment.id });
	}
	for (const key of ["on", "bri"]) if (Object.prototype.hasOwnProperty.call(update, key)) state[key] = update[key];
	if (update.ps != null) setTimeout(() => applyPreset(update.ps), 250);
	if (update.bootps != null) {
		bootPreset = Number(update.bootps);
		setTimeout(() => { persistedBootPreset = bootPreset; }, 300);
	}
	if (update.psave != null) {
		const snapshot = { ...update };
		setTimeout(() => { presets[String(update.psave)] = serializedPreset(snapshot); }, 550);
	}
	if (update.pdel != null) {
		const id = String(update.pdel);
		setTimeout(() => { delete presets[id]; }, 400);
	}
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const lowercasePath = url.pathname.toLowerCase();
	if (url.pathname === base) {
		res.writeHead(302, { Location: `${base}/` });
		return res.end();
	}
	if (files.has(url.pathname)) {
		const [name, type] = files.get(url.pathname);
		res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
		return res.end(await readFile(path.join(dataRoot, name)));
	}
	if (url.pathname === `${base}/json`) {
		return json(res, {
			state: publicState(),
			info: info(),
			effects,
			palettes
		});
	}
	if (url.pathname === `${base}/json/fxdata`) return json(res, effectMetadata);
	if (url.pathname === `${base}/json/info`) return json(res, info());
	if (url.pathname === `${base}/cfg.json`) return json(res, { def: { ps: persistedBootPreset } });
	if (url.pathname === `${base}/presets.json`) return json(res, presets);
	if (url.pathname === `${base}/json/state` && req.method === "GET") return json(res, publicState());
	if (url.pathname === `${base}/__requests` && req.method === "GET") return json(res, requests);
	if (url.pathname === `${base}/__deliveries` && req.method === "GET") return json(res, deliveries);
	if (lowercasePath === `${base}/settings/2d` || lowercasePath.startsWith(`${base}/settings/2d/`)) {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		return res.end("Not found");
	}
	if ((lowercasePath === `${base}/settings/ui` || lowercasePath.startsWith(`${base}/settings/ui/`)) && req.method === "GET") {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		return res.end("Not found");
	}
	if (url.pathname === `${base}/settings/ui` && req.method === "POST") {
		let body = "";
		for await (const chunk of req) body += chunk;
		const fields = new URLSearchParams(body);
		const entry = { method: req.method, path: url.pathname, body: Object.fromEntries(fields) };
		deliveries.push(entry);
		const requestId = fields.get("CTRID") || "";
		if (requestId.length >= 8 && requestId.length <= 32 && requestId === lastRenameRequestId) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			return res.end("<!doctype html><title>UI settings already saved</title><p>UI settings already saved.</p>");
		}
		if (requestId.length >= 8 && requestId.length <= 32) lastRenameRequestId = requestId;
		requests.push(entry);
		if (renameMode === "reject") {
			res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			return res.end("Rename rejected before acceptance.");
		}
		if (renameMode === "delayed") await delay(500);
		controllerName = fields.get("DS") ?? "";
		simplifiedUI = fields.has("SU");
		if (renameMode === "accept-disconnect") {
			req.socket.destroy();
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end("<!doctype html><title>UI settings saved</title><p>UI settings saved.</p>");
	}
	if (url.pathname === `${base}/settings/s.js` && req.method === "GET") {
		if (url.searchParams.get("p") === "3" || url.searchParams.get("p") === "10") {
			res.writeHead(404, { "Content-Type": "text/javascript; charset=utf-8" });
			return res.end("Not found");
		}
		res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
		return res.end("function GetV(){}");
	}
	if (url.pathname === `${base}/json/state` && req.method === "POST") {
		let body = "";
		for await (const chunk of req) body += chunk;
		const update = JSON.parse(body || "{}");
		requests.push({ method: req.method, path: url.pathname, body: update });
		applyUpdate(update);
		if (Array.isArray(update.seg) && update.seg.some(segment => Object.prototype.hasOwnProperty.call(segment, "sel"))) await delay(150);
		return json(res, publicState());
	}
	res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
	res.end("Not found");
});

server.on("upgrade", (req, socket) => {
	if (req.url !== `${base}/ws`) return socket.destroy();
	const accept = createHash("sha1")
		.update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
		.digest("base64");
	socket.write(
		"HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		`Sec-WebSocket-Accept: ${accept}\r\n\r\n`
	);
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	server.listen(port, "127.0.0.1", () => {
		console.log(`CastleTek mock listening at http://127.0.0.1:${port}${base}/`);
	});
}
