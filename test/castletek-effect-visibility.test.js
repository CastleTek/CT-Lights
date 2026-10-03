"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const model = require("../wled00/data/castletek-control-model.js");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const shell = read("wled00/data/castletek-control.js");
const EXPECTED_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 116, 117, 147, 151, 161, 179, 184, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 213, 218, 219];

// Extract the actual registered catalog for the shipped ESP32 Compatibility
// profile. Refuse new preprocessor syntax rather than silently changing parity.
function sourceCatalog() {
	const header = read("wled00/FX.h"), source = read("wled00/FX.cpp");
	const count = Number(header.match(/^#define\s+MODE_COUNT\s+(\d+)\b/m)[1]);
	const ids = Object.fromEntries([...header.matchAll(/^#define\s+(FX_MODE_\w+)\s+(\d+)\b/gm)].map(([, key, id]) => [key, Number(id)]));
	const literals = Object.fromEntries([...source.matchAll(/static const char (_data_\w+)\[\].*?=\s*("(?:\\.|[^"\\])*")/g)].map(([, key, value]) => [key, JSON.parse(value)]));
	const macros = new Set(["ARDUINO_ARCH_ESP32", "ESP32", "WLED_ENABLE_GIF", "WLED_PS_DONT_REPLACE_FX", "WLED_PS_DONT_REPLACE_1D_FX", "WLED_PS_DONT_REPLACE_2D_FX"]);
	const registered = new Set([0]);
	const raw = Array(count).fill(literals._data_RESERVED);
	raw[0] = literals._data_FX_MODE_STATIC;
	const active = [true];
	for (const original of source.slice(source.indexOf("void WS2812FX::setupEffectData()")).split("\n")) {
		const line = original.trim();
		const parent = active.at(-1);
		if (line.startsWith("#ifdef ")) { active.push(parent && macros.has(line.split(/\s+/)[1])); continue; }
		if (line.startsWith("#ifndef ")) { active.push(parent && !macros.has(line.split(/\s+/)[1])); continue; }
		if (line.startsWith("#if ")) {
			const expression = line.slice(4).replace(/defined\((\w+)\)/g, (_, macro) => macros.has(macro) ? "1" : "0");
			assert.match(expression, /^[01\s|]+$/);
			active.push(parent && expression.split("||").some(value => value.trim() === "1")); continue;
		}
		if (line.startsWith("#else")) { active[active.length - 1] = active.at(-2) && !parent; continue; }
		if (line.startsWith("#endif")) { active.pop(); continue; }
		assert.ok(!line.startsWith("#"), `unexpected catalog directive: ${line}`);
		if (!parent || !line.startsWith("addEffect(")) continue;
		const match = line.match(/^addEffect\((FX_MODE_\w+),\s*&\w+,\s*(_data_\w+)\);(?:\s*\/\/.*)?$/);
		assert.ok(match, line);
		const id = ids[match[1]];
		assert.ok(id > 0 && id < count && !registered.has(id));
		raw[id] = literals[match[2]]; registered.add(id);
	}
	assert.deepEqual(active, [true]);
	return {
		names: raw.map(value => value.split("@", 1)[0]),
		metadata: raw.map(value => value.includes("@") ? value.slice(value.indexOf("@") + 1) : "")
	};
}

function shellFunction(name) {
	const start = shell.indexOf(`\tfunction ${name}(`);
	assert.ok(start >= 0, name);
	const end = shell.indexOf("\n\t}\n", start);
	assert.ok(end > start, name);
	return shell.slice(start, end + 4);
}

function selectHarness() {
	const select = { dataset: {}, value: "", children: [], replaceChildren(...options) { this.children = options; } };
	const document = { activeElement: null, createElement: tag => ({ tag }) };
	return { select, document };
}

test("homeowner effect policy hides matrix-only, audio and setup-only choices while retaining raw IDs", () => {
	const names = ["Solid", "Both", "Matrix", "Volume", "Frequency", "Image", " copy SEGMENT ", "RSVD", " - ", "Flow Stripe", "Legacy", "Single", "Fast"];
	const metadata = ["", ";;;12", ";;;2", ";;;1v", ";;;12f", ";;;12", ";;;12", "", "", ";;;pal=11", "", ";;;0", ";;;1;sx=250"];
	const before = JSON.stringify({ names, metadata });
	const result = model.orderedEffectEntries(names, metadata);
	assert.deepEqual(result.map(entry => entry.id), [0, 1, 12, 9, 10, 11]);
	assert.equal(JSON.stringify({ names, metadata }), before, "display filtering cannot alter the wire catalogs");
	assert.deepEqual(model.orderedEffectEntries(names, null).map(entry => entry.id), [0]);
	assert.deepEqual(model.orderedEffectEntries(names, metadata.slice(1)).map(entry => entry.id), [0]);
	assert.deepEqual(model.orderedEffectEntries(names, metadata.map((value, id) => id === 4 ? null : value)).map(entry => entry.id), [0]);
	assert.deepEqual(model.orderedEffectEntries(["Solid", null], ["", ""]).map(entry => entry.id), [0]);
	assert.deepEqual(model.orderedEffectEntries(null, null), []);
	assert.deepEqual(model.orderedEffectEntries(["Solid", "", "  "], ["", "", ""]).map(entry => entry.id), [0]);
	assert.deepEqual(model.orderedEffectEntries(["Other"], null), []);
	assert.deepEqual(model.orderedEffectEntries([null], null), []);
	assert.deepEqual(model.orderedEffectEntries(["Other"], [""]), []);
	const oversized = ["Solid", ...Array(256).fill("Linear")];
	assert.ok(model.orderedEffectEntries(oversized, oversized.map(() => "")).every(entry => entry.id <= 255));
	// The generic ordering function still serves palettes and has no homeowner filter.
	assert.ok(model.orderedCatalogEntries(["Default", "Image", "Copy Segment"]).some(entry => entry.name === "Image"));
});

test("all 220 pinned ESP32 slots yield the same 133 homeowner IDs without renumbering or catalog mutation", () => {
	const { names, metadata } = sourceCatalog();
	assert.equal(names.length, 220);
	const named = names.map((name, id) => ({ name, id })).filter(entry => !entry.name.includes("RSVD"));
	assert.equal(named.length, 216);
	const flags = id => metadata[id].split(";")[3] || "1";
	const matrixOnly = named.filter(entry => flags(entry.id).includes("2") && !flags(entry.id).includes("1"));
	const remainingAudio = named.filter(entry => !matrixOnly.includes(entry) && /[vf]/.test(flags(entry.id)));
	assert.equal(matrixOnly.length, 53);
	assert.equal(remainingAudio.length, 28);
	const before = JSON.stringify({ names, metadata });
	const entries = model.orderedEffectEntries(names, model.normalizeEffectMetadata(metadata));
	assert.equal(entries.length, 133);
	assert.deepEqual(entries.map(entry => entry.id).sort((a, b) => a - b), EXPECTED_IDS);
	assert.deepEqual(entries, model.orderedCatalogEntries(names).filter(entry => EXPECTED_IDS.includes(entry.id)));
	assert.equal(entries[0].id, 0);
	assert.ok(entries.some(entry => entry.id === 179 && entry.name === "Flow Stripe"));
	for (const entry of entries) assert.equal(entry.name, names[entry.id]);
	assert.equal(JSON.stringify({ names, metadata }), before);
});

test("a hidden current effect remains selected but never becomes a selectable homeowner option", () => {
	const { select, document } = selectHarness();
	const context = vm.createContext({ document });
	vm.runInContext(`${shellFunction("fillSelect")}\nthis.fill = fillSelect;`, context);
	context.fill(select, [{ id: 0, name: "Solid" }, { id: 179, name: "Flow Stripe" }], 53, "Image");
	assert.equal(select.value, "53");
	assert.equal(select.children[0].textContent, "Image (current)");
	assert.equal(select.children[0].disabled, true);
	assert.equal(select.children[0].hidden, true);
	assert.deepEqual(select.children.filter(option => !option.disabled).map(option => option.value), ["0", "179"]);
	context.fill(select, [{ id: 0, name: "Solid" }, { id: 179, name: "Flow Stripe" }], 179, "Flow Stripe");
	assert.equal(select.value, "179");
	assert.equal(select.children.length, 2);
	assert.ok(select.children.every(option => !option.disabled && !option.hidden));
	for (const missingOrInvalid of [undefined, null, NaN, -1, 256]) {
		context.fill(select, [{ id: 0, name: "Solid" }], missingOrInvalid, "Current effect");
		assert.equal(select.children.length, 1);
		assert.equal(select.children[0].value, "0");
		assert.equal(select.children[0].disabled, false);
	}
});

test("metadata arrival refreshes available options without sending state and stale or failed loads keep safe choices", async () => {
	const { names, metadata } = sourceCatalog();
	const { select, document } = selectHarness();
	let resolveRequest;
	const requests = [];
	const context = vm.createContext({ document, model, effectCatalog: names, effectCatalogSignature: JSON.stringify(names), effectCatalogLength: names.length,
		effectMetadata: null, effectMetadataRequest: null, effectMetadataRequestSignature: "", effects: model.orderedEffectEntries(names, null),
		stateLoaded: true, elements: { effect: select, effectCatalogStatus: {} }, referenceSegment: () => ({ fx: 53 }),
		renderEffectControls() {}, renderColorControls() {},
		requestJSON(route, options) { requests.push({ route, options }); return new Promise(resolve => { resolveRequest = resolve; }); }
	});
	vm.runInContext(`${shellFunction("fillSelect")}\n${shellFunction("loadEffectMetadata")}\nthis.load = loadEffectMetadata;`, context);
	const pending = context.load();
	assert.equal(context.elements.effectCatalogStatus.hidden, false);
	assert.equal(context.elements.effectCatalogStatus.textContent, "Loading effects…");
	assert.equal(context.effects.length, 1);
	resolveRequest(metadata); await pending;
	assert.equal(context.effects.length, 133);
	assert.equal(select.children.filter(option => !option.disabled).length, 133);
	assert.equal(select.value, "53");
	assert.equal(context.elements.effectCatalogStatus.hidden, true);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].route, "/json/fxdata");
	assert.deepEqual(Object.keys(requests[0].options), []);

	context.effectMetadata = null; context.effects = model.orderedEffectEntries(names, null);
	const stale = context.load(); context.effectCatalogSignature = "different";
	resolveRequest(metadata); assert.equal(await stale, null); assert.equal(context.effects.length, 1);
	const invalid = context.load(); resolveRequest(metadata.slice(1)); await invalid;
	assert.equal(context.effects.length, 1);
	assert.equal(context.elements.effectCatalogStatus.hidden, false);
	assert.match(context.elements.effectCatalogStatus.textContent, /Refresh to try again/);
});
