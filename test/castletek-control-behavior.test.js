"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const model = require("../wled00/data/castletek-control-model.js");

const serializedSegment = overrides => ({
	grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, cct: 127, set: 0, lc: 3,
	col: [[255, 159, 10], [0, 0, 0], [0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0,
	c1: 128, c2: 128, c3: 16, sel: false, rev: false, mi: false,
	o1: false, o2: false, o3: false, si: 0, m12: 0, bm: 0,
	...overrides
});

const segments = [
	serializedSegment({ id: 0, n: "Output 1", start: 0, stop: 10, sel: true, fx: 1, sx: 128, ix: 64, pal: 2 }),
	serializedSegment({ id: 1, n: "Output 2", start: 10, stop: 20, fx: 2, sx: 90, ix: 120, pal: 3 }),
	serializedSegment({ id: 3, n: "Output 4", start: 30, stop: 40, sel: true, fx: 3, sx: 180, ix: 200, pal: 4 })
];

test("controller names use CastleTek's 25-character cap and WLED's 32-byte ceiling", () => {
	assert.deepEqual(model.validateControllerName("  Front Porch  ", "Old Name"), {
		ok: true, changed: true, name: "Front Porch"
	});
	assert.deepEqual(model.validateControllerName("  Front Porch  ", "Front Porch"), {
		ok: true, changed: false, name: "Front Porch"
	});
	assert.match(model.validateControllerName("   ", "Front Porch").error, /Enter a controller name/);
	assert.equal(model.validateControllerName("A".repeat(20), "Old").ok, true);
	assert.equal(model.validateControllerName("A".repeat(25), "Old").ok, true);
	assert.equal(model.validateControllerName(`${"A".repeat(24)}😀`, "Old").ok, true,
		"25 Unicode code points that fit WLED's byte ceiling must not be blocked by UTF-16 DOM counting");
	assert.match(model.validateControllerName("A".repeat(26), "Old").error, /25 characters/);
	assert.equal(model.validateControllerName("é".repeat(16), "Old").ok, true);
	assert.match(model.validateControllerName("é".repeat(17), "Old").error, /32 UTF-8 bytes/);
	assert.equal(model.validateControllerName("😀".repeat(8), "Old").ok, true);
	assert.match(model.validateControllerName("😀".repeat(9), "Old").error, /32 UTF-8 bytes/);
	assert.deepEqual(model.validateControllerName("A".repeat(32), "A".repeat(32)), {
		ok: true, changed: false, name: "A".repeat(32)
	}, "an unchanged legacy WLED name must remain a harmless no-op even when it exceeds the new editor cap");
});

test("catalogs keep firmware IDs while pinning built-ins and sorting normal names", () => {
	const entries = model.orderedCatalogEntries([
		"Solid", "Zulu", "* Random Cycle", "alpha", "* Color 1", "Beta", "RSVD"
	]);
	assert.deepEqual(entries, [
		{ id: 0, name: "Solid" },
		{ id: 4, name: "* Color 1" },
		{ id: 2, name: "* Random Cycle" },
		{ id: 3, name: "alpha" },
		{ id: 5, name: "Beta" },
		{ id: 1, name: "Zulu" }
	]);
	assert.deepEqual(model.orderedCatalogEntries([
		"Default", "* Random Cycle", "* Color 1", "* Colors 1&2", "* Color Gradient", "* Colors Only",
		"Party", "Christmas", "Sunset", "Fire", "Aurora"
	]).map(entry => entry.name), [
		"Default", "* Color 1", "* Color Gradient", "* Colors 1&2", "* Colors Only", "* Random Cycle",
		"Aurora", "Christmas", "Fire", "Party", "Sunset"
	]);
	assert.deepEqual(model.orderedCatalogEntries(null), []);
});

test("effect metadata supplies all WLED slider and option controls", () => {
	const metadata = model.normalizeEffectMetadata([
		"",
		"!,!;!,!;!",
		"Cooling,Spark rate,Flame height,Wind,Size,Smooth,Wrap,Reverse;;!;1",
		"!,!,!,!,!,!,!,!;!,!;!",
		",Frequency,,Blur,,Random,,Compact;!,!;!"
	]);
	assert.equal(metadata[0], ";!;", "Solid must use WLED's no-slider sentinel");
	assert.deepEqual(model.effectControls(metadata, 0), {
		sliders: [
			{ label: "Speed", visible: false },
			{ label: "Intensity", visible: false },
			{ label: "Custom 1", visible: false },
			{ label: "Custom 2", visible: false },
			{ label: "Custom 3", visible: false }
		],
		options: [
			{ label: "Check 1", visible: false },
			{ label: "Check 2", visible: false },
			{ label: "Check 3", visible: false }
		]
	});
	assert.deepEqual(model.effectControls(metadata, 2), {
		sliders: [
			{ label: "Cooling", visible: true },
			{ label: "Spark rate", visible: true },
			{ label: "Flame height", visible: true },
			{ label: "Wind", visible: true },
			{ label: "Size", visible: true }
		],
		options: [
			{ label: "Smooth", visible: true },
			{ label: "Wrap", visible: true },
			{ label: "Reverse", visible: true }
		]
	});
	assert.deepEqual(model.effectControls(metadata, 3).sliders, [
		{ label: "Speed", visible: true },
		{ label: "Intensity", visible: true },
		{ label: "Custom 1", visible: true },
		{ label: "Custom 2", visible: true },
		{ label: "Custom 3", visible: true }
	]);
	assert.deepEqual(model.effectControls(metadata, 3).options, [
		{ label: "Check 1", visible: true },
		{ label: "Check 2", visible: true },
		{ label: "Check 3", visible: true }
	]);
	assert.deepEqual(model.effectControls(metadata, 4), {
		sliders: [
			{ label: "Speed", visible: false },
			{ label: "Frequency", visible: true },
			{ label: "Custom 1", visible: false },
			{ label: "Blur", visible: true },
			{ label: "Custom 3", visible: false }
		],
		options: [
			{ label: "Random", visible: true },
			{ label: "Check 2", visible: false },
			{ label: "Compact", visible: true }
		]
	});
	assert.deepEqual(model.effectControls(["", "Gain=127,!=64,Custom value=23,,,Enabled=1;;!"], 1), {
		sliders: [
			{ label: "Gain", visible: true },
			{ label: "Intensity", visible: true },
			{ label: "Custom value", visible: true },
			{ label: "Custom 2", visible: false },
			{ label: "Custom 3", visible: false }
		],
		options: [
			{ label: "Enabled", visible: true },
			{ label: "Check 2", visible: false },
			{ label: "Check 3", visible: false }
		]
	}, "WLED inline defaults must not leak into visible labels");
	assert.deepEqual(model.effectSliderControls(["", ""], 1).map(control => control.visible),
		[true, true, false, false, false],
		"a low-ID legacy effect without metadata uses WLED's two generic sliders");
	const highIdLegacyMetadata = Array(129).fill("");
	assert.deepEqual(model.effectSliderControls(highIdLegacyMetadata, 128).map(control => control.visible),
		[true, true, true, true, true],
		"a high-ID legacy effect without metadata uses all five WLED sliders");
	assert.deepEqual(model.effectSliderControls(null, 128).map(control => control.visible),
		[true, true, false, false, false],
		"unavailable optional metadata must retain only the safe two-slider fallback");
	assert.equal(model.normalizeEffectMetadata(["", null]), null, "malformed metadata must be rejected");
});

test("WLED effect metadata and special palettes expose exact color-slot positions", () => {
	const metadata = model.normalizeEffectMetadata([
		"",
		"!,!;!,!;!",
		"!;,,Glitter color;!",
		"!;,!;!",
		"!;1,2,3;!"
	]);
	const visible = (effect, palette = 0) => model.colorSlots(metadata, effect, palette)
		.filter(slot => slot.visible).map(({ index, label }) => ({ index, label }));

	assert.deepEqual(visible(0), [{ index: 0, label: "Effect" }],
		"Solid's normalized WLED sentinel exposes only its effect color");
	assert.deepEqual(visible(1), [
		{ index: 0, label: "Effect" }, { index: 1, label: "Background" }
	]);
	assert.deepEqual(visible(2), [{ index: 2, label: "Glitter color" }],
		"metadata positions must support an effect that uses only color slot 3");
	assert.deepEqual(visible(3), [{ index: 1, label: "Background" }],
		"metadata positions must support an effect that uses only color slot 2");
	assert.deepEqual(visible(4), [
		{ index: 0, label: "1" }, { index: 1, label: "2" }, { index: 2, label: "3" }
	]);
	assert.deepEqual(model.colorSlots(["", ""], 1, 0).map(slot => slot.visible), [true, true, true],
		"an empty legacy effect definition exposes all three WLED color slots");
	assert.deepEqual(visible(2, 2), [
		{ index: 0, label: "Color 1" }, { index: 2, label: "Glitter color" }
	], "* Color 1 must add slot 1 without hiding an effect-defined slot 3");
	assert.deepEqual(visible(2, 3), [
		{ index: 0, label: "Color 1" }, { index: 1, label: "Color 2" },
		{ index: 2, label: "Glitter color" }
	], "* Colors 1&2 must union its two slots with effect metadata");
	assert.deepEqual(visible(3, 4).map(slot => slot.index), [0, 1, 2],
		"* Color Gradient must force all three slots");
	assert.deepEqual(model.colorSlots(null, 99, 0).map(slot => slot.visible), [true, false, false],
		"unavailable optional metadata keeps a safe primary-slot fallback");
});

test("color-slot patches preserve every untouched WLED slot and channel", async () => {
	const { mergeSegmentColors } = await import("../tools/castletek-wled-mock.mjs");
	const original = [[12, 34, 56, 78], [1, 2, 3, 4], [5, 6, 7, 8]];
	const secondRgb = model.colorSlotPatch(1, { r: 90.4, g: 91, b: 999 });
	assert.deepEqual(secondRgb, { col: [[], { r: 90, g: 91, b: 255 }, []] });
	assert.deepEqual(mergeSegmentColors(original, secondRgb.col), [
		[12, 34, 56, 78], [90, 91, 255, 4], [5, 6, 7, 8]
	]);
	const thirdWhite = model.colorSlotPatch(2, { w: 200 });
	assert.deepEqual(thirdWhite, { col: [[], [], { w: 200 }] });
	assert.deepEqual(mergeSegmentColors(original, thirdWhite.col), [
		[12, 34, 56, 78], [1, 2, 3, 4], [5, 6, 7, 200]
	]);
	const trueBlack = model.colorSlotPatch(0, { r: 0, g: 0, b: 0, w: 0 });
	assert.deepEqual(trueBlack, { col: [{ r: 0, g: 0, b: 0, w: 0 }, [], []] });
	assert.deepEqual(mergeSegmentColors(original, trueBlack.col), [
		[0, 0, 0, 0], [1, 2, 3, 4], [5, 6, 7, 8]
	], "the explicit Black choice must clear RGBW only in its selected slot");
	assert.equal(model.colorSlotPatch(-1, { r: 1 }), null);
	assert.equal(model.colorSlotPatch(3, { r: 1 }), null);
	assert.equal(model.colorSlotPatch(1, {}), null);
	assert.equal(model.colorSlotPatch(1, [1, 2, 3]), null);
});

test("color-wheel touch intent distinguishes immediate scroll from deliberate selection", () => {
	assert.equal(model.pickerTouchIntent(0, 0), "pending", "touch-down must remain inert");
	assert.equal(model.pickerTouchIntent(20, 3), "pending", "small early jitter must remain pending");
	assert.equal(model.pickerTouchIntent(20, 10), "scroll", "movement at the slop boundary before dwell must scroll");
	assert.equal(model.pickerTouchIntent(99, 30), "scroll", "early movement must never select a color");
	assert.equal(model.pickerTouchIntent(100, 0), "pick", "stationary dwell must arm the picker");
	assert.equal(model.pickerTouchIntent(100, 10), "pick", "dwell wins exactly at the time boundary");
	assert.equal(model.pickerTouchIntent(20, 7, 80, 8), "pending");
	assert.equal(model.pickerTouchIntent(20, 8, 80, 8), "scroll");
});

test("CastleTek touch coordinates match the clockwise 270-degree iro wheel", () => {
	const bounds = { left: 10, top: 20, width: 280, height: 280 };
	assert.deepEqual(model.pickerWheelHsv({ x: 150, y: 160 }, bounds, 73), { h: 90, s: 0, v: 73 });
	assert.deepEqual(model.pickerWheelHsv({ x: 150, y: 34 }, bounds, 73), { h: 0, s: 100, v: 73 },
		"the top of WLED's 270-degree clockwise wheel is red");
	assert.deepEqual(model.pickerWheelHsv({ x: 276, y: 160 }, bounds, 42), { h: 90, s: 100, v: 42 });
	assert.deepEqual(model.pickerWheelHsv({ x: 150, y: 286 }, bounds, 0), { h: 180, s: 100, v: 0 });
	assert.equal(model.pickerWheelHsv({ x: 0, y: 0 }, { width: 0, height: 1 }), null);
});

test("selected segment light capabilities drive WLED-compatible color controls", () => {
	const capabilitySegments = [
		serializedSegment({ id: 0, start: 0, stop: 10, lc: 3 }),
		serializedSegment({ id: 1, start: 10, stop: 20, lc: 1 }),
		serializedSegment({ id: 2, start: 20, stop: 30, lc: 5 }),
		serializedSegment({ id: 3, start: 30, stop: 40, lc: 2 }),
		serializedSegment({ id: 4, start: 40, stop: 40, lc: 7 })
	];
	const visibility = (ids, source = capabilitySegments) => model.colorControls(source, ids);

	assert.deepEqual(visibility([0]), {
		capabilities: 3, rgb: true, white: true, cct: false,
		value: true, kelvin: true, whiteBalance: false
	}, "Auto White None or Dual exposes Value, Kelvin, and manual White");
	assert.deepEqual(visibility(new Set([1])), {
		capabilities: 1, rgb: true, white: false, cct: false,
		value: true, kelvin: true, whiteBalance: false
	}, "Brighter, Accurate, or Max exposes only Value and Kelvin");
	assert.deepEqual(visibility([2]), {
		capabilities: 5, rgb: true, white: false, cct: true,
		value: true, kelvin: false, whiteBalance: true
	}, "CCT replaces Kelvin with White Balance");
	assert.deepEqual(visibility([3]), {
		capabilities: 2, rgb: false, white: true, cct: false,
		value: false, kelvin: false, whiteBalance: false
	}, "a white-only output exposes only manual White");
	assert.deepEqual(visibility([0, 2]), {
		capabilities: 7, rgb: true, white: true, cct: true,
		value: true, kelvin: false, whiteBalance: true
	}, "mixed targets use the union and prefer White Balance over Kelvin");
	assert.equal(visibility([0, 4]).capabilities, 3, "inactive segments must not affect the union");
	assert.deepEqual(visibility([]), {
		capabilities: 0, rgb: false, white: false, cct: false,
		value: false, kelvin: false, whiteBalance: false
	});
	assert.equal(visibility(["9"], [serializedSegment({ id: 9, lc: undefined })]).capabilities, 1,
		"missing capability metadata must retain a safe RGB fallback");
});

test("Kelvin conversion matches the bundled WLED color-picker behavior", () => {
	const warm = model.kelvinToRgb(1900);
	const daylight = model.kelvinToRgb(6550);
	const cool = model.kelvinToRgb(10091);
	assert.deepEqual(warm, { r: 255, g: 133, b: 0 });
	assert.ok(daylight.r >= 250 && daylight.g >= 245 && daylight.b >= 245);
	assert.equal(cool.b, 255);
	assert.ok(cool.r < daylight.r && cool.b > warm.b);
	assert.equal(model.rgbToKelvin(warm), 2000,
		"the bundled picker reports its 2000 K inverse floor for the 1900 K endpoint color");
	for (const kelvin of [2200, 3000, 4500, 6550, 9000, 10000]) {
		assert.ok(Math.abs(model.rgbToKelvin(model.kelvinToRgb(kelvin)) - kelvin) <= 30,
			`${kelvin} K must survive the same RGB approximation used by WLED's bundled picker`);
	}
	assert.equal(model.rgbToKelvin([0, 0, 0]), 6550, "black needs a stable, in-range Kelvin presentation");
});

test("local WLED mock preserves omitted channels in object-form color updates", async () => {
	const { mergeSegmentColors, segmentPatchStopsPlaylist } = await import("../tools/castletek-wled-mock.mjs");
	const original = [[12, 34, 56, 78], [1, 2, 3, 4], [5, 6, 7, 8]];
	assert.deepEqual(mergeSegmentColors(original, [{ r: 90, g: 91, b: 92 }]), [
		[90, 91, 92, 78], [1, 2, 3, 4], [5, 6, 7, 8]
	], "partial RGB objects must preserve W and untouched color slots");
	assert.deepEqual(mergeSegmentColors(original, [{ w: 200 }]), [
		[12, 34, 56, 200], [1, 2, 3, 4], [5, 6, 7, 8]
	], "partial W objects must preserve RGB and untouched color slots");
	assert.deepEqual(mergeSegmentColors(original, [[90, 91, 92]]), [
		[90, 91, 92, 0], [1, 2, 3, 4], [5, 6, 7, 8]
	], "array-form RGB must retain WLED's missing-channel clearing behavior");
	assert.equal(segmentPatchStopsPlaylist({ id: 0, fx: 0 }), true,
		"a direct valid WLED effect field unloads the active playlist even when the effect number is unchanged");
	assert.equal(segmentPatchStopsPlaylist({ id: 0 }), false);
	assert.equal(segmentPatchStopsPlaylist({ id: 0, fx: 999 }), true,
		"WLED unloads before coercing a nonnegative out-of-range integer effect");
	assert.equal(segmentPatchStopsPlaylist({ id: 0, fx: -1 }), false);
});

test("segment drafts use one-based inclusive UI coordinates and explicit WLED IDs", () => {
	assert.deepEqual(model.segmentDraft(segments[1]), {
		id: 1,
		name: "Output 2",
		start: 11,
		end: 20,
		grouping: 1,
		spacing: 0,
		offset: 0
	});

	const firstPixel = model.validateSegmentDraft({
		id: 0, name: "", start: 1, end: 1, grouping: 1, spacing: 0, offset: 0
	}, 40);
	assert.equal(firstPixel.ok, true);
	assert.deepEqual(firstPixel.patch, { id: 0, n: "", start: 0, stop: 1, grp: 1, spc: 0, of: 0 });

	const finalRange = model.validateSegmentDraft({
		id: 2, name: "Output 3", start: 21, end: 40, grouping: 2, spacing: 1, offset: 3
	}, 40);
	assert.equal(finalRange.ok, true);
	assert.equal(finalRange.length, 20);
	assert.equal(finalRange.virtualLength, 7);
	assert.deepEqual(finalRange.patch, {
		id: 2, n: "Output 3", start: 20, stop: 40, grp: 2, spc: 1, of: 3
	});
	for (const unrelated of ["col", "fx", "pal", "sx", "ix", "on", "bri", "rev", "mi"]) {
		assert.equal(Object.prototype.hasOwnProperty.call(finalRange.patch, unrelated), false, `${unrelated} must not leak into a geometry update`);
	}
});

test("segment draft validation rejects unsafe scalar values before layout placement", () => {
	const base = { id: 2, name: "Draft", start: 5, end: 15, grouping: 1, spacing: 0, offset: 0 };
	assert.equal(model.validateSegmentDraft(base, 40).ok, true);

	const invalidCases = [
		[{ ...base, start: "" }, /whole numbers/],
		[{ ...base, end: "   " }, /whole numbers/],
		[{ ...base, grouping: null }, /Grouping/],
		[{ ...base, spacing: false }, /Spacing/],
		[{ ...base, start: "1.5" }, /whole numbers/],
		[{ ...base, start: 0 }, /between 1 and 40/],
		[{ ...base, start: 20, end: 19 }, /between 20 and 40/],
		[{ ...base, end: 41 }, /between 5 and 40/],
		[{ ...base, grouping: 0 }, /Grouping/],
		[{ ...base, grouping: 256 }, /Grouping/],
		[{ ...base, spacing: -1 }, /Spacing/],
		[{ ...base, spacing: 256 }, /Spacing/],
		[{ ...base, offset: 11 }, /Offset/]
	];
	for (const [draft, message] of invalidCases) {
		const result = model.validateSegmentDraft(draft, 40);
		assert.equal(result.ok, false);
		assert.match(result.error, message);
	}
	const signedOffset = model.validateSegmentDraft({ ...base, offset: -2 }, 40);
	assert.equal(signedOffset.ok, true);
	assert.equal(signedOffset.patch.of, 9, "a signed offset must be normalized before readback verification");
});

test("segment layouts accept adjacency and reject every physical overlap", () => {
	const adjacent = [
		serializedSegment({ id: 0, start: 0, stop: 20 }),
		serializedSegment({ id: 1, start: 20, stop: 40 })
	];
	assert.equal(model.validateSegmentLayout(adjacent, 40, 8).ok, true);
	for (const second of [
		{ id: 1, start: 19, stop: 40 },
		{ id: 1, start: 0, stop: 20 },
		{ id: 1, start: 5, stop: 10 },
		{ id: 1, start: 10, stop: 30 }
	]) {
		const result = model.validateSegmentLayout([adjacent[0], serializedSegment(second)], 40, 8);
		assert.equal(result.ok, false);
		assert.equal(result.rangeError, true);
		assert.match(result.error, /overlap/i);
	}
	assert.equal(model.validateSegmentLayout([
		serializedSegment({ id: 0, start: 0, stop: 20 }),
		serializedSegment({ id: 0, start: 20, stop: 40 })
	], 40, 8).ok, false, "duplicate explicit IDs must fail closed");
	assert.equal(model.validateSegmentLayout([{ start: 0, stop: 20 }], 40, 8).ok, false, "missing explicit IDs must fail closed");
	assert.equal(model.validateSegmentLayout([serializedSegment({ id: 8, start: 0, stop: 20 })], 40, 8).ok, false);
	assert.equal(model.validateSegmentLayout([serializedSegment({ id: 1, start: 0, stop: 41 })], 40, 8).ok, false);
	assert.equal(model.validateSegmentLayout([serializedSegment({ id: 7, start: 0, stop: 0 })], 40, 8).ok, true,
		"inactive WLED vector slots do not own a physical range");
});

test("a full 40-pixel segment proposes and builds one source-first 20/20 split", () => {
	const source = serializedSegment({
		id: 0, n: " All lights ", start: 0, stop: 40, grp: 2, spc: 1, of: 30,
		on: false, bri: 177, frz: false, cct: 99, set: 2,
		col: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
		fx: 7, sx: 91, ix: 92, pal: 6, c1: 31, c2: 32, c3: 12,
		sel: true, rev: true, mi: true, o1: true, o2: false, o3: true, si: 2, m12: 3, bm: 4
	});
	const proposal = model.newSegmentPlan([source], 40, 8);
	assert.deepEqual(proposal, {
		ok: true,
		mode: "split",
		draft: { id: 1, name: "", start: 21, end: 40, grouping: 2, spacing: 1, offset: 19 },
		source: { id: 0, start: 0, stop: 40, frz: false }
	});
	const mutation = model.buildCreateSegmentMutation(proposal.draft, proposal, [source], 40, 8);
	assert.equal(mutation.ok, true);
	assert.equal(mutation.mode, "split");
	assert.deepEqual(mutation.patches[0], {
		id: 0, n: " All lights ", start: 0, stop: 20, grp: 2, spc: 1, of: 19, frz: false
	}, "the source's exact name bytes must be preserved while its offset is clamped to the shortened length");
	assert.deepEqual(mutation.patches[1], {
		id: 1, n: "", start: 20, stop: 40, grp: 2, spc: 1, of: 19,
		on: false, bri: 177, frz: false, cct: 99, set: 2,
		col: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
		fx: 7, sx: 91, ix: 92, pal: 6, c1: 31, c2: 32, c3: 12,
		sel: true, rev: true, mi: true, o1: true, o2: false, o3: true, si: 2, m12: 3, bm: 4
	}, "a reused inactive ID must have every mutable 1D appearance field initialized explicitly");

	const returned = [
		{ ...source, ...mutation.patches[0] },
		{ ...mutation.patches[1], lc: 3 }
	];
	assert.equal(model.segmentMutationMatchesState(returned, mutation, 40, 8), true);
	assert.equal(model.segmentMutationMatchesState({ seg: returned }, mutation, 40, 8), true);
	assert.equal(model.segmentMutationMatchesState([returned[0]], mutation, 40, 8), false,
		"a partial response must not verify a source-only resize");
	assert.equal(model.segmentMutationMatchesState([
		returned[0], { ...returned[1], sel: false }
	], mutation, 40, 8), false, "the cloned target selection must be verified");
	assert.equal(model.segmentMutationMatchesState([
		returned[0], { ...returned[1], fx: 3 }
	], mutation, 40, 8), false, "unconditional appearance fields must be verified");
	assert.equal(model.segmentMutationMatchesState([
		{ ...returned[0], fx: 3 }, returned[1]
	], mutation, 40, 8), false, "the resize must not silently change the source appearance");
	assert.equal(model.segmentMutationMatchesState([
		returned[0], { ...returned[1], col: [[99, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]], lc: 3 }
	], mutation, 40, 8), false, "writable RGB appearance must be verified");
	assert.equal(model.segmentMutationMatchesState([
		returned[0], { ...returned[1], lc: undefined }
	], mutation, 40, 8), false, "truncated readback without WLED capabilities must fail closed");
	for (const key of ["frz", "grp"]) {
		const truncated = returned.map(segment => ({ ...segment }));
		delete truncated[1][key];
		assert.equal(model.segmentMutationMatchesState(truncated, mutation, 40, 8), false,
			`truncated readback without ${key} must fail closed even when its normalized value would match`);
	}
});

test("a staged batch divides one full-strip Segment 1 into balanced physical ID order", () => {
	const source = serializedSegment({
		id: 0, n: " All lights ", start: 0, stop: 40, grp: 2, spc: 1, of: 30,
		on: false, bri: 177, frz: true, cct: 99, set: 2,
		col: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
		fx: 7, sx: 91, ix: 92, pal: 6, c1: 31, c2: 32, c3: 12,
		sel: true, rev: true, mi: true, o1: true, o2: false, o3: true, si: 2, m12: 3, bm: 4
	});
	const plan = model.newSegmentBatchPlan([source], 40, 32, 8);
	assert.equal(plan.ok, true);
	assert.equal(plan.mode, "batch-split");
	assert.equal(plan.targetSegments, 8);
	assert.equal(plan.maximumTargetSegments, 32);
	assert.deepEqual(plan.drafts.map(draft => ({
		id: draft.id, name: draft.name, start: draft.start, end: draft.end, offset: draft.offset
	})), [
		{ id: 0, name: " All lights ", start: 1, end: 5, offset: 4 },
		{ id: 1, name: "", start: 6, end: 10, offset: 4 },
		{ id: 2, name: "", start: 11, end: 15, offset: 4 },
		{ id: 3, name: "", start: 16, end: 20, offset: 4 },
		{ id: 4, name: "", start: 21, end: 25, offset: 4 },
		{ id: 5, name: "", start: 26, end: 30, offset: 4 },
		{ id: 6, name: "", start: 31, end: 35, offset: 4 },
		{ id: 7, name: "", start: 36, end: 40, offset: 4 }
	]);

	const editedDrafts = plan.drafts.map(draft => ({ ...draft }));
	editedDrafts[1].name = " Second ";
	const mutation = model.buildCreateSegmentBatchMutation(editedDrafts, plan, [source], 40, 32);
	assert.equal(mutation.ok, true);
	assert.equal(mutation.mode, "batch-split");
	assert.equal(mutation.targetSegments, 8);
	assert.deepEqual(mutation.newIds, [1, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(mutation.patches.map(patch => patch.id), [0, 1, 2, 3, 4, 5, 6, 7],
		"new WLED vector slots must be submitted in appendable ID order");
	assert.equal(mutation.patches.some(patch => Object.hasOwn(patch, "lc")), false,
		"read-only WLED light capabilities must never be written");
	assert.equal(mutation.patches[0].n, " All lights ", "Segment 1 must retain its exact source name bytes");
	assert.equal(mutation.patches[0].frz, false, "resizing must clear the frozen pixel buffer");
	assert.deepEqual(mutation.patches[1], {
		id: 1, n: "Second", start: 5, stop: 10, grp: 2, spc: 1, of: 4,
		on: false, bri: 177, frz: false, cct: 99, set: 2,
		col: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
		fx: 7, sx: 91, ix: 92, pal: 6, c1: 31, c2: 32, c3: 12,
		sel: true, rev: true, mi: true, o1: true, o2: false, o3: true, si: 2, m12: 3, bm: 4
	}, "each new segment must receive the complete supported source appearance snapshot");

	const returned = mutation.patches.map((patch, id) => id === 0
		? { ...source, ...patch }
		: { ...patch, lc: 3 });
	assert.equal(model.segmentMutationMatchesState(returned.slice().reverse(), mutation, 40, 32), true,
		"readback verification must use explicit IDs rather than response array order");
	assert.equal(model.segmentMutationMatchesState(returned.slice(0, 7), mutation, 40, 32), false);
	assert.equal(model.segmentMutationMatchesState(returned.map(segment => segment.id === 6
		? { ...segment, fx: 8 }
		: segment), mutation, 40, 32), false);
});

test("each repeated Add count recomputes an ordered near-even full-strip draft without mutating its source", () => {
	const source = serializedSegment({ id: 0, n: "All lights", start: 0, stop: 40, sel: true });
	const original = JSON.stringify(source);
	for (let count = 2; count <= 8; count++) {
		const plan = model.newSegmentBatchPlan([source], 40, 32, count);
		assert.equal(plan.ok, true);
		assert.deepEqual(plan.drafts.map(draft => draft.id), Array.from({ length: count }, (_, id) => id));
		assert.equal(plan.drafts[0].start, 1);
		assert.equal(plan.drafts.at(-1).end, 40);
		for (let index = 1; index < plan.drafts.length; index++) {
			assert.equal(plan.drafts[index].start, plan.drafts[index - 1].end + 1);
		}
		const lengths = plan.drafts.map(draft => draft.end - draft.start + 1);
		assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1);
	}
	assert.equal(JSON.stringify(source), original, "staging must not modify confirmed controller state");
});

test("batch defaults put odd remainder LEDs first and respect both segment and LED limits", () => {
	const source = serializedSegment({ id: 0, start: 0, stop: 41 });
	const plan = model.newSegmentBatchPlan([source], 41, 8, 8);
	assert.equal(plan.ok, true);
	assert.deepEqual(plan.drafts.map(draft => draft.end - draft.start + 1), [6, 5, 5, 5, 5, 5, 5, 5]);
	assert.equal(model.newSegmentBatchPlan([serializedSegment({ id: 0, start: 0, stop: 3 })], 3, 32, 3).ok, true);
	assert.equal(model.newSegmentBatchPlan([serializedSegment({ id: 0, start: 0, stop: 3 })], 3, 32, 4).ok, false,
		"a batch cannot create zero-length segments even when maxseg is larger");
	assert.equal(model.newSegmentBatchPlan([source], 41, 8, 9).ok, false);
	assert.equal(model.newSegmentBatchPlan([source], 41, 8, 1).ok, false);
});

test("the maximum 32-segment batch stays appendable and below WLED's ESP32 JSON request ceiling", () => {
	const source = serializedSegment({ id: 0, n: "All lights", start: 0, stop: 40, sel: true });
	const plan = model.newSegmentBatchPlan([source], 40, 32, 32);
	assert.equal(plan.ok, true);
	const mutation = model.buildCreateSegmentBatchMutation(plan.drafts, plan, [source], 40, 32);
	assert.equal(mutation.ok, true);
	assert.deepEqual(mutation.patches.map(patch => patch.id), Array.from({ length: 32 }, (_, id) => id));
	assert.ok(Buffer.byteLength(JSON.stringify({ seg: mutation.patches, v: true }), "utf8") < 32767);
});

test("batch creation fails closed on ineligible layouts, races, gaps, overlaps, and ID changes", () => {
	const source = serializedSegment({ id: 0, n: "Source", start: 0, stop: 40, of: 0 });
	const plan = model.newSegmentBatchPlan([source], 40, 8, 4);
	assert.equal(plan.ok, true);
	for (const layout of [
		[serializedSegment({ id: 1, start: 0, stop: 40 })],
		[serializedSegment({ id: 0, start: 0, stop: 20 })],
		[serializedSegment({ id: 0, start: 0, stop: 20 }), serializedSegment({ id: 1, start: 20, stop: 40 })]
	]) {
		assert.equal(model.newSegmentBatchPlan(layout, 40, 8, 4).ok, false);
	}
	const incomplete = { ...source };
	delete incomplete.lc;
	assert.equal(model.newSegmentBatchPlan([incomplete], 40, 8, 4).ok, false);

	const sourceRaces = {
		n: "Changed", grp: 2, spc: 1, of: 1, lc: 4, on: false, frz: true, bri: 254, cct: 126,
		set: 1, col: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], fx: 1, sx: 127, ix: 127, pal: 1,
		c1: 127, c2: 127, c3: 15, sel: true, rev: true, mi: true, o1: true, o2: true,
		o3: true, si: 1, m12: 1, bm: 1
	};
	for (const [key, value] of Object.entries(sourceRaces)) {
		assert.equal(model.buildCreateSegmentBatchMutation(plan.drafts, plan,
			[{ ...source, [key]: value }], 40, 8).ok, false,
			`a concurrent ${key} change must invalidate the captured batch source`);
	}
	assert.equal(model.buildCreateSegmentBatchMutation(plan.drafts, plan, [incomplete], 40, 8).ok, false);

	const overlap = plan.drafts.map(draft => ({ ...draft }));
	overlap[1].start--;
	const overlapResult = model.buildCreateSegmentBatchMutation(overlap, plan, [source], 40, 8);
	assert.equal(overlapResult.ok, false);
	assert.equal(overlapResult.rangeError, true);
	const gap = plan.drafts.map(draft => ({ ...draft }));
	gap[1].start++;
	assert.equal(model.buildCreateSegmentBatchMutation(gap, plan, [source], 40, 8).ok, false);
	const wrongId = plan.drafts.map(draft => ({ ...draft }));
	wrongId[3].id = 4;
	assert.equal(model.buildCreateSegmentBatchMutation(wrongId, plan, [source], 40, 8).ok, false);
	assert.equal(model.buildCreateSegmentBatchMutation(plan.drafts.slice(0, 3), plan, [source], 40, 8).ok, false);
});

test("a valid edited batch still covers the strip once in Segment-number order", () => {
	const source = serializedSegment({ id: 0, n: "Source", start: 0, stop: 40, of: 0, sel: false });
	const plan = model.newSegmentBatchPlan([source], 40, 8, 4);
	const drafts = plan.drafts.map(draft => ({ ...draft }));
	const ranges = [[1, 7], [8, 20], [21, 30], [31, 40]];
	drafts.forEach((draft, index) => {
		[draft.start, draft.end] = ranges[index];
		draft.name = index ? `Piece ${index + 1}` : " Front eave ";
	});
	const mutation = model.buildCreateSegmentBatchMutation(drafts, plan, [source], 40, 8);
	assert.equal(mutation.ok, true);
	assert.deepEqual(mutation.patches.map(patch => [patch.id, patch.start, patch.stop]), [
		[0, 0, 7], [1, 7, 20], [2, 20, 30], [3, 30, 40]
	]);
	assert.equal(mutation.patches[0].n, "Front eave");
	assert.deepEqual(mutation.patches.slice(1).map(patch => patch.n), ["Piece 2", "Piece 3", "Piece 4"]);
});

test("batch source names can be renamed or cleared without changing layout or appearance", () => {
	const source = serializedSegment({ id: 0, n: " Original name ", start: 0, stop: 40, sel: true });
	const plan = model.newSegmentBatchPlan([source], 40, 8, 2);
	const unedited = model.buildCreateSegmentBatchMutation(plan.drafts, plan, [source], 40, 8);
	assert.equal(unedited.ok, true);
	assert.equal(unedited.patches[0].n, " Original name ", "untouched name bytes must be retained");
	for (const [name, expected] of [[" Front eave ", "Front eave"], ["", ""], ["é".repeat(32), "é".repeat(32)]]) {
		const drafts = plan.drafts.map(draft => ({ ...draft }));
		drafts[0].name = name;
		const mutation = model.buildCreateSegmentBatchMutation(drafts, plan, [source], 40, 8);
		assert.equal(mutation.ok, true);
		assert.deepEqual(mutation.patches, unedited.patches.map(patch => patch.id === 0 ? { ...patch, n: expected } : patch));
		const readback = mutation.patches.map(patch => ({ ...source, ...patch }));
		assert.equal(model.segmentMutationMatchesState(readback, mutation, 40, 8), true);
		assert.equal(model.segmentMutationMatchesState(readback.map(segment => segment.id === 0
			? { ...segment, n: source.n } : segment), mutation, 40, 8), false, "readback must verify the explicit rename");
	}
	const tooLong = plan.drafts.map(draft => ({ ...draft }));
	tooLong[0].name = "é".repeat(33);
	assert.equal(model.buildCreateSegmentBatchMutation(tooLong, plan, [source], 40, 8).ok, false,
		"Segment 1 uses the same UTF-8 byte limit as every segment");
});

test("segment writes fail closed when a WLED appearance snapshot is incomplete or malformed", () => {
	const source = serializedSegment({ id: 0, start: 0, stop: 40 });
	const proposal = model.newSegmentPlan([source], 40, 8);
	for (const key of [
		"grp", "spc", "of", "on", "frz", "bri", "cct", "set", "lc", "col", "fx", "sx", "ix", "pal", "c1", "c2", "c3",
		"sel", "rev", "mi", "o1", "o2", "o3", "si", "m12", "bm"
	]) {
		const incomplete = { ...source };
		delete incomplete[key];
		assert.equal(model.buildCreateSegmentMutation(proposal.draft, proposal, [incomplete], 40, 8).ok, false,
			`missing ${key} must not be replaced with a cloning default`);
	}
	for (const malformed of [
		{ ...source, frz: 0 },
		{ ...source, fx: 1.5 },
		{ ...source, lc: -1 },
		{ ...source, col: [[255, 0], [0, 0, 0], [0, 0, 0]] },
		{ ...source, col: [[256, 0, 0], [0, 0, 0], [0, 0, 0]] }
	]) {
		assert.equal(model.buildCreateSegmentMutation(proposal.draft, proposal, [malformed], 40, 8).ok, false);
	}
});

test("split proposals retain the extra odd LED and choose a deterministic longest source", () => {
	const odd = serializedSegment({ id: 0, start: 0, stop: 41, of: 0, frz: false });
	assert.deepEqual(model.newSegmentPlan([odd], 41, 8).draft, {
		id: 1, name: "", start: 22, end: 41, grouping: 1, spacing: 0, offset: 0
	});
	const tied = [
		serializedSegment({ id: 3, start: 20, stop: 40, frz: false }),
		serializedSegment({ id: 0, start: 0, stop: 20, frz: false })
	];
	assert.deepEqual(model.newSegmentPlan(tied, 40, 8).source, { id: 0, start: 0, stop: 20, frz: false });
	assert.equal(model.newSegmentPlan(Array.from({ length: 4 }, (_, id) => serializedSegment({
		id, start: id, stop: id + 1, frz: false
	})), 4, 8).ok, false, "a fully covered all-one-pixel layout cannot be split");
	const frozenSource = serializedSegment({ id: 0, start: 0, stop: 40, frz: true });
	const frozenProposal = model.newSegmentPlan([frozenSource], 40, 8);
	assert.equal(frozenProposal.ok, true, "a frozen full-strip source must not dead-end Add Segment");
	const frozenMutation = model.buildCreateSegmentMutation(frozenProposal.draft, frozenProposal, [frozenSource], 40, 8);
	assert.equal(frozenMutation.ok, true);
	assert.equal(frozenMutation.patches[0].frz, false,
		"resizing must unfreeze the source because WLED clears a frozen segment's reallocated pixel buffer");
	assert.equal(frozenMutation.expectedAppearance.find(segment => segment.id === 0).frz, false);
	assert.equal(frozenMutation.patches[1].frz, false,
		"the new piece starts unfrozen because WLED cannot clone a frozen pixel buffer");
	assert.equal(model.buildCreateSegmentMutation(
		frozenProposal.draft,
		frozenProposal,
		[{ ...frozenSource, frz: false }],
		40,
		8
	).ok, false, "a freeze-state race must invalidate the captured split before any request is built");
});

test("editable split ranges may move either edge but cannot discard a middle remainder", () => {
	const source = serializedSegment({ id: 0, n: "Source", start: 0, stop: 40, frz: false, sel: false });
	const proposal = model.newSegmentPlan([source], 40, 8);
	const suffix = model.buildCreateSegmentMutation({ ...proposal.draft, start: 31 }, proposal, [source], 40, 8);
	assert.deepEqual(suffix.patches.slice(0, 2).map(patch => ({ id: patch.id, start: patch.start, stop: patch.stop })), [
		{ id: 0, start: 0, stop: 30 }, { id: 1, start: 30, stop: 40 }
	]);
	assert.equal(suffix.patches[1].sel, false);

	const prefixDraft = { ...proposal.draft, start: 1, end: 10, offset: 0 };
	const prefix = model.buildCreateSegmentMutation(prefixDraft, proposal, [source], 40, 8);
	assert.equal(prefix.ok, true);
	assert.deepEqual(prefix.patches.slice(0, 2).map(patch => ({ id: patch.id, start: patch.start, stop: patch.stop })), [
		{ id: 0, start: 10, stop: 40 }, { id: 1, start: 0, stop: 10 }
	]);

	for (const draft of [
		{ ...proposal.draft, start: 11, end: 30, offset: 0 },
		{ ...proposal.draft, start: 1, end: 40, offset: 0 },
		{ ...proposal.draft, start: 1, end: 41, offset: 0 }
	]) {
		const result = model.buildCreateSegmentMutation(draft, proposal, [source], 40, 8);
		assert.equal(result.ok, false);
		assert.equal(result.rangeError || /End LED/.test(result.error), true);
	}
});

test("gap creates remain editable but cannot overlap, and edits obey the same invariant", () => {
	const proposal = model.newSegmentPlan(segments, 40, 8);
	assert.equal(proposal.mode, "gap");
	assert.deepEqual(proposal.draft, {
		id: 2, name: "", start: 21, end: 30, grouping: 1, spacing: 0, offset: 0
	});
	const gapMutation = model.buildCreateSegmentMutation(proposal.draft, proposal, segments, 40, 8);
	assert.equal(gapMutation.ok, true);
	assert.deepEqual(gapMutation.patches[0], {
		id: 2, n: "", start: 20, stop: 30, grp: 1, spc: 0, of: 0,
		on: true, bri: 255, frz: false, cct: 127, set: 0,
		col: [[255, 170, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
		fx: 0, sx: 128, ix: 128, pal: 0, c1: 128, c2: 128, c3: 16,
		sel: true, rev: false, mi: false, o1: false, o2: false, o3: false, si: 0, m12: 0, bm: 0
	}, "a gap create must overwrite stale appearance in a reused inactive WLED slot");
	const overlap = model.buildCreateSegmentMutation({ ...proposal.draft, start: 20 }, proposal, segments, 40, 8);
	assert.equal(overlap.ok, false);
	assert.equal(overlap.rangeError, true);

	const editable = [
		serializedSegment({ id: 0, start: 0, stop: 10 }),
		serializedSegment({ id: 3, start: 20, stop: 30 })
	];
	assert.equal(model.buildEditSegmentMutation({
		id: 0, name: "", start: 1, end: 20, grouping: 1, spacing: 0, offset: 0
	}, editable, 40, 8).ok, true, "an edit may end directly beside its neighbor");
	assert.equal(model.buildEditSegmentMutation({
		id: 0, name: "", start: 1, end: 21, grouping: 1, spacing: 0, offset: 0
	}, editable, 40, 8).ok, false, "an edit cannot expand one LED into its neighbor");
	const legacyOverlap = [
		serializedSegment({ id: 0, start: 0, stop: 21 }),
		serializedSegment({ id: 1, start: 20, stop: 40 })
	];
	assert.equal(model.buildEditSegmentMutation({
		id: 0, name: "", start: 1, end: 20, grouping: 1, spacing: 0, offset: 0
	}, legacyOverlap, 40, 8).ok, true, "an edit may repair an existing overlap if the complete result is valid");
});

test("segment and preset names enforce firmware UTF-8 byte limits", () => {
	assert.equal(model.utf8Length("é"), 2);
	assert.equal(model.validateSegmentDraft({
		id: 0, name: "é".repeat(32), start: 1, end: 10, grouping: 1, spacing: 0, offset: 0
	}, 40).ok, true);
	assert.equal(model.validateSegmentDraft({
		id: 0, name: "é".repeat(33), start: 1, end: 10, grouping: 1, spacing: 0, offset: 0
	}, 40).ok, false);
	assert.equal(model.validatePresetDraft({ id: 1, name: "é".repeat(16) }).ok, true);
	assert.equal(model.validatePresetDraft({ id: 1, name: "é".repeat(17) }).ok, false);
});

test("new segment and preset IDs use the lowest free supported slot", () => {
	assert.equal(model.lowestUnusedSegmentId(segments, 8), 2);
	assert.deepEqual(model.newSegmentDraft(segments, 40, 8), {
		id: 2, name: "", start: 21, end: 30, grouping: 1, spacing: 0, offset: 0
	});
	assert.equal(model.lowestUnusedSegmentId(segments, 2), null);
	assert.equal(model.newSegmentPlan(Array.from({ length: 4 }, (_, id) => serializedSegment({
		id, start: id * 10, stop: (id + 1) * 10
	})), 40, 4).ok, false, "all explicit active IDs exhaust a four-slot controller");
	assert.equal(model.lowestUnusedPresetId({ 1: {}, 2: {}, 4: {} }), 3);
	const full = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index + 1, {}]));
	assert.equal(model.lowestUnusedPresetId(full), null);
});

test("deleting a segment preserves a valid explicit selection and main segment", () => {
	const result = model.buildDeleteSegmentUpdate(segments, 0, new Set([0]), 0);
	assert.equal(result.ok, true);
	assert.deepEqual(result.selectedIds, [1]);
	assert.deepEqual(result.update, {
		seg: [
			{ id: 0, sel: false },
			{ id: 0, stop: 0 },
			{ id: 1, sel: true },
			{ id: 3, sel: false }
		],
		mainseg: 1
	});
	let retainedSlot = { ...segments[0] };
	for (const patch of result.update.seg.filter(candidate => candidate.id === 0)) {
		if (patch.stop === 0) {
			retainedSlot = { ...retainedSlot, stop: 0 };
			continue;
		}
		retainedSlot = { ...retainedSlot, ...patch };
	}
	retainedSlot = { ...retainedSlot, start: 0, stop: 10 };
	assert.equal(retainedSlot.sel, false,
		"WLED returns before applying sel on a stop:0 object, so deselection must be its own earlier array entry");
	assert.equal(model.buildDeleteSegmentUpdate([segments[0]], 0, new Set([0]), 0).ok, false);
	const acceptedState = {
		mainseg: result.update.mainseg,
		seg: segments.slice(1).map(segment => ({ ...segment, sel: result.selectedIds.includes(segment.id) }))
	};
	assert.equal(model.deletedSegmentMatchesState(acceptedState, 0, result.remainingIds, result.selectedIds, result.update.mainseg), true);
	assert.equal(model.deletedSegmentMatchesState({ ...acceptedState, mainseg: 3 }, 0, result.remainingIds, result.selectedIds, result.update.mainseg), false);
	assert.equal(model.deletedSegmentMatchesState({ ...acceptedState, seg: [...acceptedState.seg, segments[0]] }, 0, result.remainingIds, result.selectedIds, result.update.mainseg), false);
	assert.equal(model.deletedSegmentMatchesState({ ...acceptedState, seg: acceptedState.seg.map(segment => ({ ...segment, sel: false })) },
		0, result.remainingIds, result.selectedIds, result.update.mainseg), false);
});

test("reset creates one explicit full-strip segment and disables every other active ID", () => {
	const result = model.buildResetSegmentsUpdate(segments, 40);
	assert.equal(result.ok, true);
	assert.deepEqual(result.update, {
		seg: [
			{ id: 0, n: "Output 1", start: 0, stop: 40, grp: 1, spc: 0, of: 0, sel: true },
			{ id: 1, sel: false },
			{ id: 1, stop: 0 },
			{ id: 3, sel: false },
			{ id: 3, stop: 0 }
		],
		mainseg: 0
	});
	const accepted = { mainseg: 0, seg: [{ ...segments[0], n: "Output 1", start: 0, stop: 40, grp: 1, spc: 0, of: 0, sel: true }] };
	assert.equal(model.resetSegmentsMatchState(accepted, result.update), true);
	for (const changed of [
		{ n: "Wrong" }, { start: 1 }, { stop: 39 }, { grp: 2 }, { spc: 1 }, { of: 1 }, { sel: false }
	]) {
		assert.equal(model.resetSegmentsMatchState({ ...accepted, seg: [{ ...accepted.seg[0], ...changed }] }, result.update), false);
	}
	assert.equal(model.resetSegmentsMatchState({ ...accepted, mainseg: 1 }, result.update), false);
	assert.equal(model.resetSegmentsMatchState({ ...accepted, seg: [...accepted.seg, segments[1]] }, result.update), false);
});

test("preset saves default to a complete current-state layout and preserve quick-load labels", () => {
	const draft = {
		id: 7,
		name: "Four Outputs",
		includeBrightness: true,
		saveSegmentBounds: true,
		selectedOnly: false,
		useAtStartup: true
	};
	const built = model.buildPresetSaveUpdate(draft, { n: "Old", ql: "4" });
	assert.equal(built.ok, true);
	assert.deepEqual(built.update, {
		psave: 7,
		n: "Four Outputs",
		ib: true,
		sb: true,
		sc: false,
		bootps: 7,
		ql: "4"
	});
	assert.equal(Object.prototype.hasOwnProperty.call(built.update, "o"), false);
	assert.equal(Object.prototype.hasOwnProperty.call(
		model.buildPresetSaveUpdate({ ...draft, useAtStartup: false }).update, "bootps"
	), false, "unchecked startup must not silently clear the configured boot preset");
});

test("startup preset verification requires matching runtime and persisted configuration", () => {
	const presets = { 6: { n: "Old" }, 7: { n: "Startup" } };
	assert.equal(model.startupPresetMatchesConfiguration(7, 7, 7, presets), true);
	assert.equal(model.startupPresetMatchesConfiguration("7", 7, 7, presets), true);
	assert.equal(model.startupPresetMatchesConfiguration(7, 6, 7, presets), false);
	assert.equal(model.startupPresetMatchesConfiguration(6, 7, 7, presets), false);
	assert.equal(model.startupPresetMatchesConfiguration(undefined, 7, 7, presets), false);
	assert.equal(model.startupPresetMatchesConfiguration(7, undefined, 7, presets), false);
	assert.equal(model.startupPresetMatchesConfiguration(0, 0, 0, presets), false);
	assert.equal(model.startupPresetMatchesConfiguration(7, 7, 7, {}), false,
		"a startup ID must resolve to a saved preset before it is confirmed");
	assert.equal(model.startupPresetConfigurationIsConsistent(0, 0), true);
	assert.equal(model.startupPresetConfigurationIsConsistent(6, 6), true,
		"a known rejected request must be recoverable after refresh");
	assert.equal(model.startupPresetConfigurationIsConsistent(7, 6), false);
	assert.equal(model.startupPresetConfigurationIsConsistent(null, 0), false);
	assert.equal(model.startupPresetConfigurationIsConsistent(251, 251), false);
	assert.equal(model.startupPresetConfigurationIsUsable(0, 0, {}), true);
	assert.equal(model.startupPresetConfigurationIsUsable(6, 6, presets), true);
	assert.equal(model.startupPresetConfigurationIsUsable(6, 6, {}), false,
		"a dangling nonzero startup ID must keep recovery locked");
	assert.equal(model.startupPresetConfigurationIsUsable(6, 6, { 6: null }), false);
	assert.equal(model.startupPresetConfigurationIsUsable(6, 6, Object.assign([], { 6: { n: "Wrong root" } })), false);
	assert.equal(model.startupPresetConfigurationIsUsable(6, 6, Object.create({ 6: { n: "Inherited" } })), false);
});

test("preset capture signatures ignore volatile runtime data but include every requested saved field", () => {
	const draft = { includeBrightness: true, saveSegmentBounds: true, selectedOnly: false };
	const state = {
		on: true, bri: 160, transition: 7, bs: 0, mainseg: 0, ps: 1,
		nl: { on: true, rem: 59 }, udpn: { send: false }, seg: segments
	};
	const signature = model.presetCaptureSignature(draft, state);
	assert.equal(model.presetCaptureSignature(draft, { ...state, ps: 2, error: 9, nl: { on: true, rem: 58 } }), signature);
	assert.notEqual(model.presetCaptureSignature(draft, { ...state, bri: 161 }), signature);
	assert.notEqual(model.presetCaptureSignature(draft, {
		...state,
		seg: state.seg.map(segment => segment.id === 1 ? { ...segment, fx: segment.fx + 1 } : segment)
	}), signature);
	assert.equal(model.presetCaptureSignature({ ...draft, includeBrightness: false }, { ...state, bri: 161 }),
		model.presetCaptureSignature({ ...draft, includeBrightness: false }, state));
	assert.equal(model.presetCaptureSignature({ ...draft, selectedOnly: true }, {
		...state,
		seg: state.seg.map(segment => segment.id === 1 ? { ...segment, fx: segment.fx + 1 } : segment)
	}), model.presetCaptureSignature({ ...draft, selectedOnly: true }, state));
});

test("preset verification checks name, requested bounds, appearance, and global brightness", () => {
	const state = { on: true, bri: 160, transition: 7, bs: 0, mainseg: 0, seg: segments };
	const draft = {
		id: 5, name: "Current Look", includeBrightness: true,
		saveSegmentBounds: true, selectedOnly: false, useAtStartup: false, quickLoad: "C"
	};
	const saved = {
		n: "Current Look",
		ql: "C",
		on: true,
		bri: 160,
		transition: 7,
		bs: 0,
		mainseg: 0,
		seg: [{ ...segments[0] }, { ...segments[1] }, { stop: 0 }, { ...segments[2] }]
	};
	assert.equal(model.presetMatchesCurrentState(saved, draft, state, new Set([0, 3]), 4), true);
	assert.equal(model.presetMatchesCurrentState({ ...saved, ql: "X" }, draft, state, new Set([0, 3]), 4), false,
		"a replaced preset must preserve its existing quick-load label");
	assert.equal(model.presetMatchesCurrentState({ ...saved, bri: 159 }, draft, state, new Set([0, 3]), 4), false);
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: saved.seg.slice(0, 2) }, draft, state, new Set([0, 3]), 4), false);
	assert.equal(model.presetMatchesCurrentState({
		...saved,
		seg: saved.seg.map((segment, index) => index ? segment : { ...segment, col: [[0, 0, 0]] })
	}, draft, state, new Set([0, 3]), 4), false, "a stale saved color must not confirm a new save");
	assert.equal(model.presetMatchesCurrentState({
		...saved,
		seg: [...saved.seg, { ...segments[0], id: 9 }]
	}, draft, state, new Set([0, 3]), 4), false, "an extra active saved segment must not confirm a complete layout");
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [saved.seg[0], saved.seg[3]] },
		{ ...draft, selectedOnly: true }, state, new Set([0, 3]), 4), true);
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [saved.seg[0], { stop: 0 }, saved.seg[3]] },
		{ ...draft, selectedOnly: true }, state, new Set([0, 3]), 4), false,
		"selected-only presets must not carry segment-deletion sentinels");
	assert.equal(model.presetMatchesCurrentState({ ...saved, win: "A=128" }, draft, state, new Set([0, 3]), 4), false,
		"a current-state replacement must not retain custom API behavior");

	const withoutGlobalsOrBounds = {
		n: "Current Look",
		ql: "C",
		mainseg: 0,
		seg: segments.map(({ start: _start, stop: _stop, ...segment }) => segment)
	};
	const subsetDraft = { ...draft, includeBrightness: false, saveSegmentBounds: false };
	assert.equal(model.presetMatchesCurrentState(withoutGlobalsOrBounds, subsetDraft, state, new Set([0, 3]), 4), true);
	assert.equal(model.presetMatchesCurrentState({ ...withoutGlobalsOrBounds, bri: 160 }, subsetDraft, state, new Set([0, 3]), 4), false,
		"unexpected global brightness data must not confirm ib:false");
	assert.equal(model.presetMatchesCurrentState(saved, subsetDraft, state, new Set([0, 3]), 4), false,
		"unexpected segment bounds must not confirm sb:false");

	for (const key of ["n", "on", "frz", "sel", "rev", "mi", "o1", "o2", "o3"]) {
		const first = { ...saved.seg[0] };
		delete first[key];
		assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [first, ...saved.seg.slice(1)] }, draft, state, new Set([0, 3]), 4), false,
			`missing serialized field ${key} must not confirm`);
	}
	const nullOffset = { ...saved.seg[0], of: null };
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [nullOffset, ...saved.seg.slice(1)] }, draft, state, new Set([0, 3]), 4), false,
		"null must not masquerade as a serialized zero");
});

test("preset verification includes WLED 0.16 matrix bounds and orientation fields", () => {
	const matrixSegment = serializedSegment({
		id: 0, n: "Matrix", start: 0, stop: 16, startY: 0, stopY: 8,
		col: [[1, 2, 3], [0, 0, 0], [0, 0, 0]], fx: 2, sx: 100, ix: 120, pal: 3,
		rY: true, mY: false, tp: true
	});
	const state = { on: true, bri: 200, transition: 7, bs: 0, mainseg: 0, seg: [matrixSegment] };
	const draft = {
		id: 9, name: "Matrix look", includeBrightness: true,
		saveSegmentBounds: true, selectedOnly: false, useAtStartup: false
	};
	const saved = { n: "Matrix look", on: true, bri: 200, transition: 7, bs: 0, mainseg: 0, seg: [{ ...matrixSegment }] };
	assert.equal(model.presetMatchesCurrentState(saved, draft, state, new Set([0]), 1), true);
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [{ ...matrixSegment, stopY: 7 }] }, draft, state, new Set([0]), 1), false);
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [{ ...matrixSegment, tp: false }] }, draft, state, new Set([0]), 1), false);
	const oneDimensional = { ...segments[0] };
	const oneDimensionalState = { ...state, seg: [oneDimensional] };
	assert.equal(model.presetMatchesCurrentState({ ...saved, seg: [{ ...oneDimensional, startY: 0, stopY: 1, rY: false, mY: false, tp: false }] },
		draft, oneDimensionalState, new Set([0]), 1), false, "stale matrix fields must not confirm on a 1D controller");
});

test("bounded preset verification performs reads only and never replays a mutation", async () => {
	let reads = 0;
	let waits = 0;
	const verification = await model.verifyReadOnly(async () => {
		reads += 1;
		return { persisted: reads >= 3 };
	}, value => value.persisted, {
		attempts: 7,
		delayMilliseconds: 1,
		wait: async () => { waits += 1; }
	});
	assert.deepEqual(verification, {
		confirmed: true, attempts: 3, value: { persisted: true }, lastError: null
	});
	assert.equal(reads, 3);
	assert.equal(waits, 2);

	const exhausted = await model.verifyReadOnly(async () => {
		reads += 1;
		throw new Error("unavailable");
	}, () => false, { attempts: 4, wait: async () => {} });
	assert.equal(exhausted.confirmed, false);
	assert.equal(exhausted.attempts, 4);
	assert.match(exhausted.lastError.message, /unavailable/);
});

test("preset verification can require a delay before the first filesystem read", async () => {
	const waits = [];
	let reads = 0;
	const result = await model.verifyReadOnly(async () => {
		reads += 1;
		return true;
	}, Boolean, {
		attempts: 3,
		initialDelayMilliseconds: 750,
		delayMilliseconds: 350,
		wait: async (milliseconds, attempt) => waits.push([milliseconds, attempt])
	});
	assert.equal(result.confirmed, true);
	assert.equal(reads, 1);
	assert.deepEqual(waits, [[750, 0]]);
});
