"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const shellHtml = read("wled00/data/castletek.htm");
const shellScript = read("wled00/data/castletek-control.js");
const shellStyle = read("wled00/data/castletek-control.css");
const pageLogo = fs.readFileSync(path.join(root, "wled00/data/castletek-logo.png"));
const brandingStyle = read("wled00/data/castletek-branding.css");

function assertMatches(source, pattern, message) {
	assert.ok(pattern.test(source), message || `missing ${pattern}`);
}

function assertNotMatches(source, pattern, message) {
	assert.ok(!pattern.test(source), message || `unexpected ${pattern}`);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idPattern(id) {
	const escaped = escapeRegExp(id);
	return new RegExp(`\\bid=(?:["']${escaped}["']|${escaped})(?=\\s|>)`, "i");
}

function elementWithId(html, id) {
	const escaped = escapeRegExp(id);
	const match = html.match(new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid=(?:["']${escaped}["']|${escaped})(?=\\s|>)[^>]*>`, "i"));
	assert.ok(match, `missing #${id}`);
	return { tagName: match[1].toLowerCase(), markup: match[0] };
}

function buttonLabels(html) {
	return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)]
		.map(match => match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function assertControlMarkup(html) {
	for (const id of [
		"colorSlots", "colorSlot1", "colorSlot1Swatch", "colorSlot1Label",
		"colorSlot2", "colorSlot2Swatch", "colorSlot2Label",
		"colorSlot3", "colorSlot3Swatch", "colorSlot3Label",
		"colorPicker", "colorHexControl", "colorHex", "colorValueControl", "colorValue", "colorValueValue",
		"colorTemperatureControl", "colorTemperature", "colorTemperatureValue",
		"whiteBalanceControl", "whiteBalance", "whiteBalanceValue",
		"whiteChannelControl", "whiteChannel", "whiteChannelValue",
		"colorHeading", "colorExpand", "colorExpandedControls", "colorSliders",
		"segments", "selectAllSegments", "targetSummary", "swatches"
	]) {
		assertMatches(html, idPattern(id), `missing #${id}`);
	}

	const picker = elementWithId(html, "colorPicker");
	assert.notEqual(picker.tagName, "input", "the circular picker host must not be a native color input");
	const colorValue = elementWithId(html, "colorValue");
	assert.equal(colorValue.tagName, "input", "#colorValue must be an input");
	assertMatches(colorValue.markup, /\btype=(?:["']range["']|range)(?=\s|>)/i, "#colorValue must be an inline range control");
	assertNotMatches(colorValue.markup, /\bhidden(?:\s|=|>)/i, "#colorValue must be visible");
	const colorValueValue = elementWithId(html, "colorValueValue");
	assert.equal(colorValueValue.tagName, "output", "#colorValueValue must visibly report the previewed value");
	assertNotMatches(colorValueValue.markup, /\bhidden(?:\s|=|>)/i, "#colorValueValue must be visible");
	for (const [id, minimum, maximum] of [
		["colorValue", 0, 100], ["colorTemperature", 1900, 10091],
		["whiteBalance", 0, 255], ["whiteChannel", 0, 255]
	]) {
		const control = elementWithId(html, id).markup;
		assertMatches(control, /\btype=(?:["']range["']|range)(?=\s|>)/i, `#${id} must be an inline range control`);
		assertMatches(control, new RegExp(`\\bmin=(?:["']${minimum}["']|${minimum})(?=\\s|>)`, "i"),
			`#${id} must use WLED's exact minimum`);
		assertMatches(control, new RegExp(`\\bmax=(?:["']${maximum}["']|${maximum})(?=\\s|>)`, "i"),
			`#${id} must use WLED's exact maximum`);
	}
	for (const id of ["colorTemperatureControl", "whiteBalanceControl", "whiteChannelControl"]) {
		assertMatches(elementWithId(html, id).markup, /\bhidden(?:\s|=|>)/i,
			`#${id} must start hidden until segment capabilities load`);
	}
	const quickColors = elementWithId(html, "swatches");
	assertMatches(quickColors.markup, /\brole=(?:["']group["']|group)(?=\s|>)/i,
		"quick colors must expose an accessible group");
	const quickColorsStart = html.search(idPattern("swatches"));
	const quickColorsEnd = html.indexOf("</div>", quickColorsStart);
	assert.ok(quickColorsStart >= 0 && quickColorsEnd > quickColorsStart, "quick-color group must close cleanly");
	const quickColorButtons = [...html.slice(quickColorsStart, quickColorsEnd).matchAll(/<button\b[^>]*\bdata-color=(?:["'][^"']+["']|[^\s>]+)[^>]*>/gi)]
		.map(match => match[0]);
	assert.equal(quickColorButtons.length, 8, "quick colors must include eight choices in one row");
	const black = quickColorButtons.find(button => /\bdata-color=(?:["']#000000["']|#000000)(?=\s|>)/i.test(button));
	assert.ok(black, "quick colors must include a true black choice");
	assertMatches(black, /\baria-label=(?:["']Black["']|Black)(?=\s|>)/i,
		"the black quick color must have an accessible name");
	assertNotMatches(html, /<input\b[^>]*\btype=(?:["']color["']|color)(?=\s|>)/i);
	assertNotMatches(html, /<dialog\b|<[^>]+\bpopover(?:target)?(?:\s|=|>)/i);
	assertMatches(elementWithId(html, "colorSlots").markup, /\brole=(?:["']group["']|group)(?=\s|>)/i,
		"color slots must expose an accessible group");
	for (const [id, index] of [["colorSlot1", 0], ["colorSlot2", 1], ["colorSlot3", 2]]) {
		const slot = elementWithId(html, id).markup;
		assertMatches(slot, /\btype=(?:["']button["']|button)(?=\s|>)/i, `#${id} must be a button`);
		assertMatches(slot, new RegExp(`\\bdata-color-slot=(?:["']${index}["']|${index})(?=\\s|>)`, "i"),
			`#${id} must preserve WLED slot index ${index}`);
		assertMatches(slot, /\bdisabled(?:\s|=|>)/i, `#${id} must start disabled`);
	}
	for (const id of ["colorSlot2", "colorSlot3"]) {
		assertMatches(elementWithId(html, id).markup, /\bhidden(?:\s|=|>)/i,
			`#${id} must stay hidden until WLED metadata requires it`);
	}
	for (const label of buttonLabels(html)) {
		assertNotMatches(label, /\bapply\b/i, `unexpected Apply button: ${label}`);
	}
}

function assertRC4Markup(html) {
	for (const id of [
		"addSegment", "segmentEditor", "segmentName", "segmentStart", "segmentEnd", "segmentGrouping",
		"segmentSpacing", "segmentOffset", "segmentPower", "segmentBrightness", "segmentReverse", "segmentMirror",
		"saveSegment", "deleteSegment", "resetSegments", "addPreset", "presetEditor", "presetName", "presetId",
		"presetBrightness", "presetBounds", "presetSelectedOnly", "presetStartup", "savePreset", "deletePreset",
		"presetEditorStatus", "speedControl", "speedLabel", "intensityControl", "intensityLabel",
		"custom1Control", "custom1Label", "custom1", "custom1Value",
		"custom2Control", "custom2Label", "custom2", "custom2Value",
		"custom3Control", "custom3Label", "custom3", "custom3Value",
		"effectOptions", "option1Control", "option1Label", "option1",
		"option2Control", "option2Label", "option2", "option3Control", "option3Label", "option3"
	]) assertMatches(html, idPattern(id), `missing RC4 control #${id}`);

	assertMatches(elementWithId(html, "segmentName").markup, /\bmaxlength=(?:["']64["']|64)(?=\s|>)/i);
	assertMatches(elementWithId(html, "presetName").markup, /\bmaxlength=(?:["']32["']|32)(?=\s|>)/i);
	assertMatches(elementWithId(html, "presetId").markup, /\bmin=(?:["']1["']|1)(?=\s|>)/i);
	assertMatches(elementWithId(html, "presetId").markup, /\bmax=(?:["']250["']|250)(?=\s|>)/i);
	assertMatches(elementWithId(html, "presetBrightness").markup, /\bchecked(?:\s|=|>)/i);
	assertMatches(elementWithId(html, "presetBounds").markup, /\bchecked(?:\s|=|>)/i);
	assertNotMatches(elementWithId(html, "presetSelectedOnly").markup, /\bchecked(?:\s|=|>)/i);
	assertNotMatches(elementWithId(html, "presetStartup").markup, /\bchecked(?:\s|=|>)/i);
	assertMatches(html, /<details\b[^>]*class=(?:["'][^"']*advanced-panel[^"']*["']|[^\s>]*advanced-panel[^\s>]*)/i);
	assertMatches(html, /Update segment/i);
	assertMatches(html, /Save segment layout/i);
	assertMatches(html, /Selected targets only/i);
	assertMatches(html, /Use at startup/i);
	for (const [id, maximum] of [["custom1", 255], ["custom2", 255], ["custom3", 31]]) {
		const control = elementWithId(html, id).markup;
		assertMatches(control, /\btype=(?:["']range["']|range)(?=\s|>)/i, `#${id} must be a range control`);
		assertMatches(control, /\bmin=(?:["']0["']|0)(?=\s|>)/i, `#${id} must start at zero`);
		assertMatches(control, new RegExp(`\\bmax=(?:["']${maximum}["']|${maximum})(?=\\s|>)`, "i"),
			`#${id} must use WLED's exact range`);
	}
	for (const id of ["option1", "option2", "option3"]) {
		assertMatches(elementWithId(html, id).markup, /\btype=(?:["']checkbox["']|checkbox)(?=\s|>)/i,
			`#${id} must be a checkbox`);
	}
	assertMatches(elementWithId(html, "effectOptions").markup, /\brole=(?:["']group["']|group)(?=\s|>)/i);
	for (const id of ["custom1Control", "custom2Control", "custom3Control", "effectOptions",
		"option1Control", "option2Control", "option3Control"]) {
		assertMatches(elementWithId(html, id).markup, /\bhidden(?:\s|=|>)/i, `#${id} must start hidden until metadata loads`);
	}
	for (const id of ["power", "brightness", "selectAllSegments", "addSegment", "resetSegments", "colorHex", "colorValue",
		"colorTemperature", "whiteBalance", "whiteChannel",
		"effect", "palette", "speed", "intensity", "custom1", "custom2", "custom3", "option1", "option2", "option3", "addPreset"]) {
		assertMatches(elementWithId(html, id).markup, /\bdisabled(?:\s|=|>)/i, `#${id} must remain disabled until controller state loads`);
	}
}

function assertRC8Markup(html) {
	for (const id of ["deviceMeta", "colorPreview", "presetBackup"]) {
		assertNotMatches(html, idPattern(id), `removed RC8 element #${id} must stay absent`);
	}
	for (const copy of [
		"Seasonal controller", "WLED 0.16 compatibility engine", "Local controls",
		"This compact page works without the CastleTek app", "Trusted LAN profile",
		"Cleartext local control; route names are not authentication.", "Download backup",
		"CastleTek compatibility profile", "Based on WLED 0.16.0"
	]) assert.ok(!html.includes(copy), `removed RC8 copy must stay absent: ${copy}`);
	assertMatches(html, idPattern("settingsLink"), "Controller settings must remain available");
	assertMatches(html, /<p\b[^>]*class=(?:["'][^"']*source-note[^"']*["']|source-note)[^>]*>\s*CastleTek Lights • EUPL-1\.2-or-later\s*<\/p>/i,
		"the compact source footer must use the requested exact text");
	const wheel = html.search(idPattern("colorPicker"));
	const slots = html.search(idPattern("colorSlots"));
	const hex = html.search(idPattern("colorHexControl"));
	assert.ok(wheel >= 0 && slots > wheel && hex > slots, "three color slots must sit below the wheel and before its detail controls");
}

function assertRC9Markup(html) {
	const disclosure = elementWithId(html, "colorExpand");
	assert.equal(disclosure.tagName, "button");
	assertMatches(disclosure.markup, /\btype=(?:["']button["']|button)(?=\s|>)/i);
	assertMatches(disclosure.markup, /\baria-controls=(?:["']colorExpandedControls["']|colorExpandedControls)(?=\s|>)/i);
	assertMatches(disclosure.markup, /\baria-expanded=(?:["']false["']|false)(?=\s|>)/i,
		"color controls must start collapsed");
	assertMatches(disclosure.markup, /\baria-label=(?:["']Show color picker controls["']|Show\s+color\s+picker\s+controls)(?=\s|>)/i);
	assertNotMatches(disclosure.markup, /\bdata-segment-control(?:\s|=|>)/i,
		"the presentation-only disclosure must remain available while color mutations are locked");
	const expanded = elementWithId(html, "colorExpandedControls");
	assertMatches(expanded.markup, /\bhidden(?:\s|=|>)/i, "advanced color controls must start hidden");
	assertMatches(expanded.markup, /\baria-labelledby=(?:["']colorHeading["']|colorHeading)(?=\s|>)/i);
	assertMatches(html, /<p\b[^>]*\bid=(?:["']colorHint["']|colorHint)[^>]*>\s*Choose a color slot, then drag to select\s*<\/p>/i,
		"color guidance must use the requested exact copy");

	const orderedIds = ["colorExpandedControls", "colorPicker", "colorSliders", "colorValueControl",
		"colorTemperatureControl", "whiteBalanceControl", "whiteChannelControl", "colorSlots", "colorHexControl", "swatches"];
	let previous = -1;
	for (const id of orderedIds) {
		const index = html.search(idPattern(id));
		assert.ok(index > previous, `#${id} must follow the requested color-control order`);
		previous = index;
	}
	assertMatches(html, /\bid=(?:["']colorHexControl["']|colorHexControl)[\s\S]*?<\/label>\s*<\/div>\s*<div\b[^>]*\bid=(?:["']swatches["']|swatches)/i,
		"quick colors must remain outside the collapsible region");
}

function assertRC10Markup(html) {
	assert.equal(elementWithId(html, "ctHeader").tagName, "header");
	assert.equal(elementWithId(html, "ctPageTitle").tagName, "h1");
	assertMatches(html, /<img\b[^>]*class=(?:["']ct-page-logo["']|ct-page-logo)/i,
		"the pinned header must carry the approved page logo");
	const connection = elementWithId(html, "connection");
	assert.equal(connection.tagName, "p");
	assertMatches(connection.markup, /\bclass=(?:["'][^"']*visually-hidden[^"']*["']|visually-hidden)(?=\s|>)/i);
	assertMatches(connection.markup, /\brole=(?:["']status["']|status)(?=\s|>)/i);
	assertMatches(connection.markup, /\baria-live=(?:["']polite["']|polite)(?=\s|>)/i);
	assertMatches(connection.markup, /\baria-atomic=(?:["']true["']|true)(?=\s|>)/i,
		"connection state must remain a screen-reader status without a visible badge");
	assertNotMatches(html, /status-pill/i, "the visible status pill and dot must stay removed");
}

function assertRC11Markup(html) {
	const name = elementWithId(html, "deviceName");
	assert.equal(name.tagName, "button", "the visible controller name must be a native tap target");
	assertMatches(name.markup, /\btype=(?:["']button["']|button)(?=\s|>)/i);
	assertMatches(name.markup, /\baria-controls=(?:["']renameForm["']|renameForm)(?=\s|>)/i);
	assertMatches(name.markup, /\baria-expanded=(?:["']false["']|false)(?=\s|>)/i);
	assertMatches(name.markup, /\bdisabled(?:\s|=|>)/i, "rename must stay disabled until controller info loads");
	const form = elementWithId(html, "renameForm");
	assert.equal(form.tagName, "form");
	assertMatches(form.markup, /\bhidden(?:\s|=|>)/i, "the inline rename form must start closed");
	assertMatches(form.markup, /\bnovalidate(?:\s|=|>)/i);
	const input = elementWithId(html, "renameName");
	assert.equal(input.tagName, "input");
	assertMatches(input.markup, /\bname=(?:["']DS["']|DS)(?=\s|>)/i);
	assertMatches(input.markup, /\bmaxlength=(?:["']32["']|32)(?=\s|>)/i,
		"the DOM limit must allow every validator-approved Unicode name while JS enforces 25 code points and 32 bytes");
	for (const id of ["renameSave", "renameCancel", "renameStatus"]) assertMatches(html, idPattern(id));
	const status = elementWithId(html, "renameStatus");
	assertMatches(status.markup, /\brole=(?:["']status["']|status)(?=\s|>)/i);
	assertMatches(status.markup, /\baria-live=(?:["']polite["']|polite)(?=\s|>)/i);
}

function balancedFrom(source, openIndex, open = "(", close = ")") {
	let depth = 0;
	let quote = "";
	let escaped = false;
	for (let index = openIndex; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = "";
			continue;
		}
		if (character === "\"" || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if (character === open) depth++;
		else if (character === close && --depth === 0) return source.slice(openIndex, index + 1);
	}
	throw new Error(`unbalanced ${open}${close} expression`);
}

function eventBinding(source, eventName, method = "on") {
	const marker = new RegExp(`\\.${escapeRegExp(method)}\\(\\s*["']${escapeRegExp(eventName)}["']`);
	const match = marker.exec(source);
	assert.ok(match, `missing ${method}(${JSON.stringify(eventName)}) binding`);
	const openIndex = source.indexOf("(", match.index);
	return source.slice(match.index, openIndex) + balancedFrom(source, openIndex);
}

function functionBody(source, name) {
	const declaration = new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(`).exec(source);
	assert.ok(declaration, `missing ${name}()`);
	const parametersStart = source.indexOf("(", declaration.index);
	const parameters = balancedFrom(source, parametersStart);
	const brace = source.indexOf("{", parametersStart + parameters.length);
	return balancedFrom(source, brace, "{", "}");
}

function functionSource(source, name) {
	const declaration = new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(`).exec(source);
	assert.ok(declaration, `missing ${name}()`);
	const parametersStart = source.indexOf("(", declaration.index);
	const parameters = balancedFrom(source, parametersStart);
	const brace = source.indexOf("{", parametersStart + parameters.length);
	const body = balancedFrom(source, brace, "{", "}");
	return source.slice(declaration.index, brace) + body;
}

function controlEventBinding(source, control, eventName) {
	const marker = new RegExp(`elements\\.${escapeRegExp(control)}\\.addEventListener\\(\\s*["']${escapeRegExp(eventName)}["']`);
	const match = marker.exec(source);
	assert.ok(match, `missing ${control} ${eventName} binding`);
	const openIndex = source.indexOf("(", match.index);
	return source.slice(match.index, openIndex) + balancedFrom(source, openIndex);
}

test("CastleTek control page exposes inline color and segment targets without an Apply flow", () => {
	assertControlMarkup(shellHtml);
	assertRC4Markup(shellHtml);
	assertRC8Markup(shellHtml);
	assertRC9Markup(shellHtml);
	assertRC11Markup(shellHtml);
	const modelScript = shellHtml.indexOf('src="castletek-control-model.js"');
	const controllerScript = shellHtml.indexOf('src="castletek-control.js"');
	assert.ok(modelScript >= 0 && controllerScript > modelScript, "the production model must load before the controller shell");
});

test("CastleTek shell shares the approved page logo as a separate cacheable PNG", () => {
	assert.deepEqual([...pageLogo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.equal(pageLogo.readUInt32BE(16), 212);
	assert.equal(pageLogo.readUInt32BE(20), 264);
	assert.ok(pageLogo.length < 0xffff, "the logo must fit its flash array length field");
	const marks = [...shellHtml.matchAll(/<img\b[^>]*class="ct-page-logo"[^>]*>/gi)];
	assert.equal(marks.length, 1);
	assertMatches(marks[0][0], /src="castletek-logo\.png"/);
	assertMatches(marks[0][0], /data-inline-ignore/);
});

test("app-style header stays pinned with a consistent bottom-aligned logo and accessible connection status", () => {
	assertRC10Markup(shellHtml);
	assertMatches(brandingStyle, /\.ct-app \.ct-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/);
	assertMatches(brandingStyle, /\.ct-header-inner\s*\{[^}]*align-items:\s*flex-end/);
	assertMatches(brandingStyle, /\.ct-app \.ct-page-logo\s*\{[^}]*width:\s*72px[^}]*height:\s*88px/);
	assertMatches(shellStyle, /\.visually-hidden\s*\{[^}]*position\s*:\s*absolute\s*!important[^}]*clip\s*:\s*rect\(0\s*,\s*0\s*,\s*0\s*,\s*0\)/);
	assertNotMatches(shellStyle, /\.status-pill|--green\s*:/,
		"removed visible connection-state styling must not remain");
	const connection = functionBody(shellScript, "setConnection");
	assertMatches(connection, /connectionAnnouncementState/);
	assertMatches(connection, /elements\.connection\.dataset\.state\s*=\s*state/);
	assertMatches(connection, /elements\.connection\.textContent\s*=/);
	assertMatches(connection, /Controller connected/);
	assertNotMatches(connection, /\.className|\.lastChild/,
		"status updates must preserve the visually-hidden class and not assume a dot child");
});

test("RC11 enlarges the product title and safely exposes tap-to-rename", () => {
	assertRC11Markup(shellHtml);
	assertMatches(brandingStyle, /\.ct-app \.ct-page-title\s*\{[^}]*font-size:\s*34px[^}]*white-space:\s*normal/);
	assertMatches(shellStyle, /h1\s*\{[^}]*min-width\s*:\s*0[^}]*overflow\s*:\s*hidden[^}]*white-space\s*:\s*nowrap/);
	assertMatches(shellStyle, /\.device-name\s*\{[^}]*width\s*:\s*100%[^}]*overflow\s*:\s*hidden[^}]*text-overflow\s*:\s*ellipsis[^}]*white-space\s*:\s*nowrap/,
		"long names must stay inside the fixed hero name column");
	assertMatches(shellStyle, /\.rename-form input\s*\{[^}]*font-size\s*:\s*16px/,
		"the mobile rename field must not trigger browser focus zoom");
	const fit = functionBody(shellScript, "fitDeviceName");
	assertMatches(fit, /style\.removeProperty\(\s*["']font-size["']\s*\)/);
	assertMatches(fit, /scrollWidth\s*<=\s*available/);
	assertMatches(fit, /matchMedia\(\s*["']\(max-width:\s*720px\)["']\s*\)/);
	assertMatches(fit, /style\.fontSize\s*=/, "long names must shrink based on measured width");
	const render = functionBody(shellScript, "renderInfo");
	assertMatches(render, /requestAnimationFrame\(fitDeviceName\)/);
	assertMatches(render, /aria-label/);
	assertMatches(render, /\.title\s*=/, "the full stored name must remain available when ellipsized");

	const submit = functionBody(shellScript, "submitControllerRename");
	const validation = submit.indexOf("model.validateControllerName");
	const noChange = submit.indexOf("!validation.changed");
	const preflight = submit.indexOf('requestJSON("/json/info"');
	const post = submit.indexOf('requestResponse("/settings/ui"');
	const verification = submit.indexOf("model.verifyReadOnly", post);
	assert.ok(validation >= 0 && noChange > validation && preflight > noChange && post > preflight && verification > post,
		"validation/no-op, fresh read-only preflight, one POST, and read-only verification must stay ordered");
	assertMatches(submit, /typeof\s+preflight\.simplifiedui\s*!==\s*["']boolean["']/,
		"rename must fail closed when Simplified UI cannot be preserved");
	assertMatches(submit, /new\s+URLSearchParams\s*\(\s*\)/);
	assertMatches(submit, /body\.set\(\s*["']DS["']\s*,\s*validation\.name\s*\)/);
	assertMatches(submit, /if\s*\(\s*preflight\.simplifiedui\s*\)\s*body\.set\(\s*["']SU["']\s*,\s*["']on["']\s*\)/,
		"a true Simplified UI value must survive WLED's complete UI form semantics");
	assertMatches(submit, /body\.set\(\s*["']CTRID["']\s*,\s*renameRequestId\(\s*\)\s*\)/,
		"the shell must give transparent browser retries an idempotency key");
	assertMatches(submit, /application\/x-www-form-urlencoded;charset=UTF-8/);
	assertMatches(submit, /method\s*:\s*["']POST["']/);
	assertMatches(submit, /\(\)\s*=>\s*requestJSON\(\s*["']\/json\/info["']/,
		"post-acceptance reconciliation must use GET-only info reads");
	assertMatches(submit, /renameMatchesInfo\(\s*info\s*,\s*validation\.name\s*,\s*preflight\.simplifiedui\s*\)/,
		"verification must confirm both the exact stored name and preserved Simplified UI value");
	assertMatches(submit, /renameSubmitting|renameMutationUncertain/);
	assertMatches(submit, /rejectedStatus\s*===\s*401/);
	assert.equal((shellScript.match(/requestResponse\(\s*["']\/settings\/ui["']/g) || []).length, 1,
		"the shell must contain exactly one controller-name mutation call site");
	assertNotMatches(shellScript, /requestJSON\(\s*["']\/settings\/ui["']/,
		"the HTML settings response must never be parsed as JSON");
	const controls = functionBody(shellScript, "bindControls");
	assertMatches(controls, /deviceName\.addEventListener\(\s*["']click["']\s*,\s*openRenameEditor\s*\)/);
	assertMatches(controls, /renameForm\.addEventListener\(\s*["']submit["']\s*,\s*submitControllerRename\s*\)/);
	assertMatches(controls, /renameCancel\.addEventListener\(\s*["']click["']/);
	assertMatches(controls, /event\.key\s*!==\s*["']Escape["']/);
	const refresh = functionBody(shellScript, "refresh");
	assertMatches(refresh, /const\s+renameVersion\s*=\s*renameOperationVersion/);
	assertMatches(refresh, /renameVersion\s*!==\s*renameOperationVersion/,
		"a refresh started before a rename must not overwrite the verified result");
	assertMatches(refresh, /renameMatchesInfo\([\s\S]*renameExpectedSimplifiedUI\)/,
		"manual uncertainty resolution must confirm both settings read-only");
});

test("segment and preset lists use compact one-column accordion rows", () => {
	for (const id of ["segmentEditorHome", "presetEditorHome"]) {
		assertMatches(shellHtml, idPattern(id), `missing stable editor mount #${id}`);
	}
	assertMatches(shellStyle, /\.segment-grid\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)/,
		"segments must use one full-width column at every breakpoint");
	assertMatches(shellStyle, /\.preset-grid\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)/,
		"presets must use one full-width column at every breakpoint");
	for (const selector of ["segment-grid", "preset-grid"]) {
		const rules = [...shellStyle.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "g"))]
			.map(match => match[1])
			.filter(rule => /grid-template-columns\s*:/.test(rule));
		assert.ok(rules.length, `missing grid declaration for .${selector}`);
		for (const rule of rules) {
			assertMatches(rule, /grid-template-columns\s*:\s*(?:minmax\(0\s*,\s*1fr\)|1fr)\s*;/,
				`.${selector} must stay one column in every overriding rule`);
		}
	}
	assertMatches(shellStyle, /\.segment-target\s*\{[^}]*min-height\s*:\s*44px/,
		"collapsed segment rows must retain a compact touch target");
	assertMatches(shellStyle, /\.preset-button\s*\{[^}]*min-height\s*:\s*44px/,
		"collapsed preset rows must retain a compact touch target");
	assertMatches(shellStyle, /\.segment-item\s*\{[^}]*grid-template-columns\s*:\s*44px\s+minmax\(0\s*,\s*1fr\)\s+44px/,
		"segment rows must reserve fixed power and caret columns without growing vertically");
	assertMatches(shellStyle, /\.segment-power-toggle\s*\{[^}]*width\s*:\s*44px[^}]*min-height\s*:\s*44px/,
		"segment power must remain a compact touch target");
	assertMatches(shellStyle, /\.segment-copy strong\s*\{[^}]*overflow-wrap\s*:\s*anywhere[^}]*white-space\s*:\s*normal/,
		"segment names must wrap instead of truncating");
	assertMatches(shellStyle, /\.preset-button strong\s*\{[^}]*overflow-wrap\s*:\s*anywhere[^}]*white-space\s*:\s*normal/,
		"preset names must wrap instead of truncating");
	assertNotMatches(shellStyle, /\.segment-(?:copy strong|edit)\s*\{[^}]*text-overflow\s*:\s*ellipsis/);
	assertNotMatches(shellStyle, /\.preset-(?:button strong|manage)\s*\{[^}]*text-overflow\s*:\s*ellipsis/);

	const segments = functionBody(shellScript, "renderSegments");
	assertMatches(segments, /className\s*=\s*["']segment-power-toggle["']/);
	assertMatches(segments, /dataset\.segmentPowerId\s*=\s*String\(id\)/);
	assertMatches(segments, /power\.addEventListener\(\s*["']click["']\s*,\s*\(\)\s*=>\s*toggleSegmentPower\(id\)\s*\)/);
	assertMatches(segments, /item\.append\(power\s*,\s*label\s*,\s*toggle\)/,
		"segment DOM and tab order must be power, target selection, then caret");
	assertMatches(segments, /button\.setAttribute\(\s*["']aria-pressed["']\s*,\s*String\(isOn\)\s*\)/);
	assertMatches(segments, /segmentPowerPendingIds\.has\(id\)/,
		"each segment power button must stay locked while its own request is unresolved");
	assertMatches(segments, /className\s*=\s*["']accordion-toggle segment-expand["']/);
	assertMatches(segments, /dataset\.expandSegmentId/);
	assertMatches(segments, /setAttribute\(\s*["']aria-controls["']\s*,\s*["']segmentEditor["']\s*\)/);
	assertMatches(segments, /caret\.setAttribute\(\s*["']aria-hidden["']\s*,\s*["']true["']\s*\)/);
	assertMatches(segments, /setAttribute\(\s*["']aria-expanded["']\s*,\s*String\(expanded\)\s*\)/);
	assertMatches(segments, /expanded\s*\?\s*["']Hide["']\s*:\s*["']Show["']/);
	assertMatches(segments, /!elements\.segmentEditor\.hidden\s*&&\s*!expanded/,
		"only the active segment caret may stay enabled while its editor is open");
	assertMatches(segments, /toggleSegmentEditor\s*\(/);
	assertNotMatches(segments, /textContent\s*=\s*["']Edit["']|segment-edit/);
	assert.ok(segments.indexOf("restoreEditorHome") < segments.indexOf("replaceChildren"),
		"the segment editor must be protected before its list is rebuilt");
	assert.ok(segments.indexOf("mountSegmentEditor") > segments.indexOf("reconcileSegmentEditor"),
		"the segment editor must remount after source reconciliation");
	const segmentToggle = functionBody(shellScript, "toggleSegmentEditor");
	assertMatches(segmentToggle, /if\s*\(\s*expanded\s*\)[\s\S]*?closeSegmentEditor\s*\(\s*\)[\s\S]*?openSegmentEditor\s*\(/,
		"the active segment caret must collapse through the existing close path");
	assertNotMatches(segmentToggle, /sendState|requestJSON|toggleSegmentTarget|applySavedPreset/,
		"the segment caret itself must remain mutation-free");

	const presets = functionBody(shellScript, "renderPresets");
	assertMatches(presets, /className\s*=\s*["']accordion-toggle preset-expand["']/);
	assertMatches(presets, /dataset\.expandPresetId/);
	assertMatches(presets, /setAttribute\(\s*["']aria-controls["']\s*,\s*["']presetEditor["']\s*\)/);
	assertMatches(presets, /caret\.setAttribute\(\s*["']aria-hidden["']\s*,\s*["']true["']\s*\)/);
	assertMatches(presets, /setAttribute\(\s*["']aria-expanded["']\s*,\s*String\(expanded\)\s*\)/);
	assertMatches(presets, /expanded\s*\?\s*["']Hide["']\s*:\s*["']Show["']/);
	assertMatches(presets, /!elements\.presetEditor\.hidden\s*&&\s*!expanded/,
		"only the active preset caret may stay enabled while its editor is open");
	assertMatches(presets, /togglePresetEditor\s*\(/);
	assertNotMatches(presets, /textContent\s*=\s*["']•••["']|preset-manage/);
	assertMatches(presets, /querySelectorAll\(\s*["']button\.preset-button["']\s*\)/,
		"nested editor buttons must not be swept into preset-row recall locking");
	assertNotMatches(presets, /querySelectorAll\(\s*["']button["']\s*\)/,
		"preset row locking must not disable controls in the nested editor");
	assert.ok(presets.indexOf("restoreEditorHome") < presets.indexOf("replaceChildren"),
		"the preset editor must be protected before its list is rebuilt");
	assert.ok(presets.indexOf("mountPresetEditor") > presets.indexOf("reconcilePresetEditor"),
		"the preset editor must remount after source reconciliation");
	const presetToggle = functionBody(shellScript, "togglePresetEditor");
	assertMatches(presetToggle, /if\s*\(\s*expanded\s*\)[\s\S]*?closePresetEditor\s*\(\s*\)[\s\S]*?openPresetEditor\s*\(/,
		"the active preset caret must collapse through the existing close path");
	assertNotMatches(presetToggle, /sendState|requestJSON|toggleSegmentTarget|applySavedPreset/,
		"the preset caret itself must remain mutation-free");

	for (const name of ["mountSegmentEditor", "mountPresetEditor"]) {
		const mount = functionBody(shellScript, name);
		assertMatches(mount, /\.closest\(\s*["']\.(?:segment|preset)-item["']\s*\)/);
		assertMatches(mount, /item\.append\(elements\.(?:segment|preset)Editor\)/,
			`${name} must place the singleton editor inside its expanded row`);
		assertMatches(mount, /\.parentElement\s*!==\s*item/,
			`${name} must not reinsert and blur an already mounted editor on routine state renders`);
		assertMatches(mount, /restoreEditorHome/,
			`${name} must preserve the editor when its source row disappears or the list rebuilds`);
	}
	const focusRestore = functionBody(shellScript, "restoreEditorFocus");
	assertMatches(focusRestore, /focus\(\s*\{\s*preventScroll\s*:\s*true\s*\}\s*\)/);
	assertMatches(focusRestore, /setSelectionRange/,
		"signature-driven list rebuilds must preserve the focused editor field and selection");
	const closeFocus = functionBody(shellScript, "focusFirstAvailable");
	assertMatches(closeFocus, /!candidate\.disabled/,
		"editor close must not strand focus on a disabled caret after an uncertain mutation");
	assertMatches(functionBody(shellScript, "closeSegmentEditor"), /data-expand-segment-id/);
	assertMatches(functionBody(shellScript, "closePresetEditor"), /data-expand-preset-id/);
});

test("segment row power sends one verified sparse command without changing target selection", () => {
	assertMatches(shellScript, /const\s+segmentPowerPendingIds\s*=\s*new\s+Set\s*\(\s*\)/);
	const setter = functionBody(shellScript, "setSegmentPower");
	assertMatches(setter, /const\s+segment\s*=\s*findSegment\(id\)/,
		"power state must be read at click time instead of captured during row construction");
	assertMatches(setter, /desired\s*=\s*Boolean\(desired\)/);
	assertMatches(setter, /sendSegmentState\(\s*\{\s*on\s*:\s*desired\s*\}\s*,\s*\[id\]\s*\)/,
		"power must target only the explicit segment ID with an absolute Boolean");
	assertMatches(setter, /verifyState\([\s\S]*?findSegmentInState\(state\s*,\s*id\)\?\.on\s*===\s*desired/,
		"returned/read-back state must confirm the desired segment power value");
	assertMatches(setter, /segmentPowerPendingIds\.add\(id\)[\s\S]*?finally[\s\S]*?segmentPowerPendingIds\.delete\(id\)/,
		"the per-ID rapid-tap lock must span mutation and verification");
	assertNotMatches(setter, /toggleSegmentTarget|persistTargetSelection|targetSegmentIds|mainseg|\bsel\s*:|\bbri\s*:|\bcol\s*:/,
		"segment power must remain independent from target selection and unrelated state");
	const toggle = functionBody(shellScript, "toggleSegmentPower");
	assertMatches(toggle, /setSegmentPower\(id\s*,\s*segment\.on\s*===\s*false\)/,
		"the row button must derive one absolute value and use the shared power path");
	const controls = functionBody(shellScript, "bindControls");
	assertMatches(controls, /segmentPower\.addEventListener\(\s*["']change["'][\s\S]*?setSegmentPower\(segmentEditorId\s*,\s*elements\.segmentPower\.checked\)/,
		"the expanded editor checkbox must share the same per-ID lock");
	assertMatches(functionBody(shellScript, "updateSegmentEditorAvailability"), /segmentPowerPendingIds\.has\(segmentEditorId\)/,
		"an in-flight row power command must also lock the expanded editor control");
});

test("RC9 power, color disclosure, mobile fields, and editor expansion remain stable", () => {
	assertMatches(shellStyle, /\.power\s*\{[^}]*width\s*:\s*72px[^}]*height\s*:\s*72px/,
		"desktop master power must be smaller than RC8 while remaining a large touch target");
	assertMatches(shellStyle, /h1\s*\{[^}]*white-space\s*:\s*nowrap/,
		"controller names must remain on one line without colliding with master power");
	assertNotMatches(shellStyle, /\.hero\s+\.power\s*\{[^}]*position\s*:\s*absolute/,
		"mobile master power must remain in flow so it cannot overlap brightness");
	assertMatches(shellStyle, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.hero\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)\s+auto[^}]*}[\s\S]*?\.hero\s+\.power\s*\{[^}]*position\s*:\s*static[^}]*width\s*:\s*60px[^}]*height\s*:\s*60px/,
		"phone layout must reserve a compact in-flow power column beside the controller name");
	assertMatches(shellStyle, /\.color-slots\s*\{[^}]*display\s*:\s*grid[^}]*grid-template-columns\s*:\s*repeat\(3\s*,\s*minmax\(0\s*,\s*1fr\)\)/,
		"color slots must use one fixed three-across row");
	for (let slot = 1; slot <= 3; slot++) {
		assertMatches(shellStyle, new RegExp(`#colorSlot${slot}\\s*\\{[^}]*grid-column\\s*:\\s*${slot}`),
			`color slot ${slot} must retain its WLED position when another slot is hidden`);
	}
	const preview = functionBody(shellScript, "updateColorPresentation");
	assertMatches(preview, /activeButton[\s\S]*?\.color-slot-swatch[\s\S]*?style\.background\s*=\s*hex/,
		"the active color-slot swatch must replace the removed redundant preview");
	assertNotMatches(shellScript, /colorPreview|presetBackup|deviceMeta/);
	assertMatches(shellStyle, /\.editor-fields input\[type="text"\][^}]*font-size\s*:\s*16px/);
	assertMatches(shellStyle, /\.editor-fields input\[type="number"\][^}]*font-size\s*:\s*16px/);
	assertMatches(shellStyle, /\.hex-control input\s*\{[^}]*font-size\s*:\s*16px/);
	assertMatches(shellStyle, /select\s*\{[^}]*font-size\s*:\s*16px/);
	assertMatches(shellStyle, /\.color-expanded-controls\[hidden\]\s*\{[^}]*display\s*:\s*none/);
	assertMatches(shellStyle, /\.swatches\s*\{[^}]*grid-template-columns\s*:\s*repeat\(8\s*,\s*minmax\(0\s*,\s*1fr\)\)/,
		"all eight quick colors must share one row");
	assertMatches(shellStyle, /\.swatches button\s*\{[^}]*max-width\s*:\s*38px[^}]*min-width\s*:\s*0[^}]*aspect-ratio\s*:\s*1/,
		"quick colors must shrink slightly without forcing page overflow");
	assertMatches(shellStyle, /button\[data-color=["']#000000["']\]\s*\{[^}]*border-color/,
		"black must remain visible against the dark card");
	const disclosure = functionBody(shellScript, "setColorPanelExpanded");
	assertMatches(disclosure, /colorExpandedControls\.hidden\s*=\s*!expanded/);
	assertMatches(disclosure, /colorExpand\.setAttribute\(\s*["']aria-expanded["']/);
	assertMatches(disclosure, /requestAnimationFrame[\s\S]*?picker\.resize\(pickerWidth\(\)\)/,
		"opening a picker initialized while hidden must resize it after layout");
	assertMatches(disclosure, /discardPendingColorInteraction/,
		"closing must clear an unfinished color interaction");
	assertNotMatches(disclosure, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/,
		"expanding and collapsing must not contact or mutate the controller");
	const discard = functionBody(shellScript, "discardPendingColorInteraction");
	assertMatches(discard, /pickerInputActive\s*=\s*false[\s\S]*?pendingColorInteraction\s*=\s*null/);
	assertNotMatches(discard, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/);
	const disclosureClick = controlEventBinding(shellScript, "colorExpand", "click");
	assertMatches(disclosureClick, /setColorPanelExpanded\(elements\.colorExpandedControls\.hidden\)/);
	for (const editor of ["openSegmentEditor", "openPresetEditor"]) {
		const body = functionBody(shellScript, editor);
		assertNotMatches(body, /scrollIntoView|\.focus\s*\(|\.select\s*\(/,
			`${editor} must not move the viewport or summon the keyboard when expanded`);
	}
	assertNotMatches(shellHtml, /maximum-scale\s*=|user-scalable\s*=\s*(?:no|0)/i,
		"mobile zoom accessibility must remain enabled");
});

test("color-wheel touch intent gates iro before preview and preserves native scrolling", () => {
	assertNotMatches(shellStyle, /\.color-wheel\s*\{[^}]*touch-action\s*:\s*none/);
	assertMatches(shellStyle, /\.color-wheel\s*\{[^}]*touch-action\s*:\s*auto/);
	const start = functionBody(shellScript, "handlePickerTouchStart");
	assertMatches(start, /event\.stopPropagation\(\)/);
	assertNotMatches(start, /event\.preventDefault\(\)|updatePickerFromTouch|commitPickerColor/,
		"touch-down must neither block scrolling nor preview or commit a color");
	assertMatches(start, /setTimeout\([\s\S]*?pickerTouchDwellMilliseconds/);
	const move = functionBody(shellScript, "handlePickerTouchMove");
	assertMatches(move, /model\.pickerTouchIntent/);
	assertMatches(move, /intent\s*===\s*["']scroll["'][\s\S]*?return/);
	assertMatches(move, /gesture\.state\s*!==\s*["']pick["'][\s\S]*?return[\s\S]*?event\.preventDefault\(\)[\s\S]*?updatePickerFromTouch/,
		"only a deliberate picker gesture may prevent movement and update color");
	const end = functionBody(shellScript, "handlePickerTouchEnd");
	assertMatches(end, /gesture\.state\s*===\s*["']scroll["'][\s\S]*?return/);
	assertMatches(end, /commitPickerColor\(picker\.color\.rgb\s*,\s*context\)/);
	assert.equal((end.match(/commitPickerColor\s*\(/g) || []).length, 1,
		"a deliberate touch gesture must have one release commit site");
	assertMatches(shellScript, /addEventListener\(\s*["']touchstart["']\s*,\s*handlePickerTouchStart\s*,\s*\{\s*capture\s*:\s*true/);
	assertMatches(shellScript, /document\.addEventListener\(\s*["']touchstart["']\s*,\s*cancelPickerOnMultitouch\s*,\s*\{\s*capture\s*:\s*true\s*,\s*passive\s*:\s*true/,
		"a second finger outside the wheel must cancel color selection without blocking pinch zoom");
	assertMatches(functionBody(shellScript, "cancelPickerOnMultitouch"), /event\.touches\.length\s*!==\s*1[\s\S]*?cancelPickerTouchGesture/);
	assertMatches(shellScript, /suppressPickerCompatibilityMouse/,
		"handled touch gestures must not be replayed as an iro mouse gesture");
});

test("RC12 segment geometry is draft-based, non-overlapping, and submitted atomically", () => {
	const controls = functionBody(shellScript, "bindControls");
	for (const control of ["segmentName", "segmentStart", "segmentEnd", "segmentGrouping", "segmentSpacing", "segmentOffset"]) {
		assertMatches(controls, new RegExp(`elements\\.${control}\\b`), `missing ${control} draft binding`);
	}
	assertMatches(controls, /field\.addEventListener\(\s*["']input["']\s*,\s*markSegmentDraftDirty\s*\)/);
	const dirtyDraft = functionBody(shellScript, "markSegmentDraftDirty");
	assertNotMatches(dirtyDraft, /sendState\s*\(/, "editing geometry must remain mutation-free");

	assertMatches(controlEventBinding(shellScript, "segmentPower", "change"), /setSegmentPower/,
		"segment power must remain immediate through the shared per-ID lock");
	for (const control of ["segmentReverse", "segmentMirror"]) {
		const binding = controlEventBinding(shellScript, control, "change");
		assertMatches(binding, /sendImmediateSegmentPatch/);
	}
	const brightnessPreview = controlEventBinding(shellScript, "segmentBrightness", "input");
	assertNotMatches(brightnessPreview, /sendState|sendImmediateSegmentPatch/);
	const brightnessCommit = controlEventBinding(shellScript, "segmentBrightness", "change");
	assertMatches(brightnessCommit, /sendImmediateSegmentPatch/);

	const preview = functionBody(shellScript, "validateCurrentSegmentMutation");
	assertMatches(preview, /model\.buildCreateSegmentMutation\s*\(/);
	assertMatches(preview, /model\.buildEditSegmentMutation\s*\(/);
	const addAvailability = functionBody(shellScript, "renderSegments");
	assertMatches(addAvailability, /model\.newSegmentPlan\s*\(/);
	assertMatches(addAvailability, /elements\.addSegment\.disabled[\s\S]*?!addPlan\.ok/);
	assertMatches(addAvailability, /segmentCreationPlaylistIsClear\s*\(\s*\)/,
		"creation must remain unavailable unless the current playlist status is known and idle");
	assertMatches(addAvailability, /elements\.segmentAvailability\.textContent\s*=\s*addUnavailableReason/,
		"mobile users need a visible explanation when Add Segment is intrinsically unavailable");
	assertMatches(dirtyDraft, /segmentStart[\s\S]*?segmentEnd[\s\S]*?segmentOffset\.value\s*=/,
		"changing split bounds must clamp an inherited offset into the visible range");
	assertMatches(dirtyDraft, /segmentEditorMode\s*===\s*["']create["'][\s\S]*?segmentEditorCreatePlan\?\.mode\s*===\s*["']split["']/,
		"transient edits to an existing segment must never rewrite its hidden offset");

	const submit = functionBody(shellScript, "submitSegmentLayout");
	assertMatches(submit, /validateCurrentSegmentMutation\s*\(/);
	assertMatches(submit, /segmentEditorConflict/);
	const preflight = submit.indexOf("readSegmentSnapshotForWrite");
	const exactPlan = submit.indexOf("model.buildCreateSegmentMutation", preflight);
	const mutation = submit.indexOf("sendState({ seg: payload");
	assert.ok(preflight >= 0 && exactPlan > preflight && mutation > exactPlan,
		"segment layout submission must use a fresh combined state/info snapshot before building and sending its exact plan");
	assertMatches(submit, /const payload\s*=\s*segmentEditorMode\s*===\s*["']create["']\s*\?\s*mutation\.patches\s*:\s*mutation\.patches\[0\]/);
	assertMatches(submit, /sendState\s*\(\s*\{\s*seg\s*:\s*payload\s*\}\s*\)/);
	assert.equal((submit.match(/sendState\s*\(/g) || []).length, 1, "segment submission must have one mutation call site");
	assertMatches(submit, /verifySegmentMutation\s*\(/, "segment writes require complete returned-state or read-only verification");
	assertMatches(submit, /segmentLayoutSignature\(freshState\)\s*===\s*segmentEditorLayoutSignature/,
		"a draft must be rejected if any source geometry changed");
	assertMatches(submit, /segmentConstraintSignature\(freshInfo\)\s*===\s*segmentEditorConstraintSignature/,
		"a draft must be rejected if LED count, segment limit, or matrix mode changed");
	assertMatches(submit, /segmentCreationPlaylistIsClear\(freshState\)/,
		"the combined preflight must fail closed if a playlist is active or its status is missing");
	const snapshot = functionBody(shellScript, "readSegmentSnapshotForWrite");
	assert.ok(snapshot.indexOf("currentInfo = info") < snapshot.indexOf("applyState(state, true)"),
		"fresh limits must become current before state reconciliation so cancel and reopen can recover");
	const reconciliation = functionBody(shellScript, "reconcileSegmentEditor");
	assertMatches(reconciliation, /Boolean\(splitSource\.frz\)\s*!==\s*Boolean\(segmentEditorCreatePlan\.source\?\.frz\)/,
		"a concurrent split-source freeze change must invalidate the open draft and its disclosure");
	const verification = functionBody(shellScript, "verifySegmentMutation");
	assertMatches(verification, /model\.segmentMutationMatchesState\s*\(/,
		"verification must cover all changed IDs, the full final layout, selection, and non-overlap");
});

test("ordered segment batches stage repeated Add taps locally and submit the complete layout once", () => {
	const batchList = elementWithId(shellHtml, "segmentBatchDrafts").markup;
	assertMatches(batchList, /\brole=(?:["']group["']|group)(?=\s|>)/i);
	assertMatches(batchList, /\bhidden(?:\s|=|>)/i);
	assertMatches(functionBody(shellScript, "renderSegmentBatchDrafts"), /aria-pressed/,
		"each staged segment button must expose the currently edited row");
	assertMatches(shellStyle, /\.segment-batch-draft\s*\{[^}]*min-height\s*:\s*44px/,
		"staged rows must remain usable touch targets");
	assertMatches(shellStyle, /\.editor-fields input\[type=["']text["']\][^}]*font-size\s*:\s*16px/,
		"the reused mobile editor must retain a non-zooming input size");

	const opener = functionBody(shellScript, "openSegmentEditor");
	assertMatches(opener, /model\.newSegmentBatchPlan\s*\([\s\S]*?currentInfo\.leds\?\.maxseg\s*,\s*2\s*\)/,
		"the first Add tap must stage a two-piece layout from an eligible full strip");
	assertMatches(opener, /segmentEditorBatchDrafts\s*=\s*segmentEditorCreatePlan\.drafts\.map/);
	const dispatcher = functionBody(shellScript, "handleAddSegment");
	assertMatches(dispatcher, /elements\.segmentEditor\.hidden[\s\S]*?openSegmentEditor\(null\s*,\s*trigger\)/);
	assertMatches(dispatcher, /batchSegmentCreationIsOpen\(\)[\s\S]*?stageAdditionalSegment\(\)/);

	for (const name of ["stageAdditionalSegment", "selectSegmentBatchDraft", "commitCurrentBatchDraft", "renderSegmentBatchDrafts"]) {
		const body = functionBody(shellScript, name);
		assertNotMatches(body, /sendState\s*\(|requestJSON\s*\(|fetch\s*\(/,
			`${name} must remain a local-only staging operation`);
	}
	const staging = functionBody(shellScript, "stageAdditionalSegment");
	assertMatches(staging, /targetSegments\s*\+\s*1/);
	assertMatches(staging, /segmentEditorDirty[\s\S]*?return/,
		"another Add must not silently discard manually edited ranges");
	assertNotMatches(staging, /currentState\s*=/,
		"staged geometry must not be presented as confirmed controller state");

	const rendering = functionBody(shellScript, "renderSegments");
	assertMatches(rendering, /nextBatchPlan[\s\S]*?segmentEditorCreatePlan\.targetSegments\s*\+\s*1/);
	assertMatches(rendering, /batchCreationOpen[\s\S]*?segmentEditorDirty[\s\S]*?elements\.addSegment\.disabled/,
		"Add must remain available only for an untouched, valid staged batch");
	assertMatches(functionBody(shellScript, "segmentMutationLocked"), /batchSegmentCreationIsOpen\(\)/,
		"live segment controls must lock while a source appearance snapshot is staged");

	const submit = functionBody(shellScript, "submitSegmentLayout");
	const preflight = submit.indexOf("readSegmentSnapshotForWrite");
	const compile = submit.indexOf("model.buildCreateSegmentBatchMutation", preflight);
	const send = submit.indexOf("sendState({ seg: payload", compile);
	assert.ok(preflight >= 0 && compile > preflight && send > compile,
		"the complete staged mutation must be rebuilt only after the fresh combined preflight");
	assert.equal((submit.match(/sendState\s*\(/g) || []).length, 1,
		"batch and legacy layout creation must share one non-retrying mutation call site");
	assertMatches(submit, /batchCreation\s*\?[\s\S]*?mutation\.patches/,
		"one segment array must carry the entire staged layout");
	assertMatches(submit, /verifySegmentMutation\s*\(/);
	assertMatches(submit, /batchCreation[\s\S]*?Number\(freshState\.mainseg\)\s*===\s*0/,
		"the ordered full-strip batch must preserve Segment 1 as the main segment");
	assertMatches(functionBody(shellScript, "verifySegmentMutation"), /batch-split[\s\S]*?Number\(state\.mainseg\)\s*===\s*0/);
	assertMatches(submit, /structuralMutationUncertain\s*=\s*true/);

	const close = functionBody(shellScript, "closeSegmentEditor");
	assertMatches(close, /segmentEditorBatchDrafts\s*=\s*\[\]/);
	assertMatches(close, /segmentEditorBatchIndex\s*=\s*-1/);
	assertMatches(close, /renderSegmentBatchDrafts\s*\(\s*\)/,
		"Cancel must discard the memory-only batch without a controller request");
});

test("RC4 segment editor invalidates delete confirmation when its source changes and disables matrix edits", () => {
	const reconciliation = functionBody(shellScript, "reconcileSegmentEditor");
	assertMatches(reconciliation, /signature\s*!==\s*segmentEditorSourceSignature[\s\S]*?segmentDeleteArmed\s*=\s*false/);
	const rendering = functionBody(shellScript, "renderSegments");
	assertMatches(rendering, /toggle\.disabled\s*=\s*matrix\s*\|\|/);
});

test("RC4 destructive segment controls require confirmation before their one mutation", () => {
	const deletion = functionBody(shellScript, "deleteEditedSegment");
	const deleteConfirmation = deletion.indexOf("if (!segmentDeleteArmed)");
	const deletePreflight = deletion.indexOf("readStructuralStateForWrite");
	const deleteMutation = deletion.indexOf("sendState(freshResult.update");
	assert.ok(deleteConfirmation >= 0 && deleteMutation > deleteConfirmation);
	assert.ok(deletePreflight > deleteConfirmation && deleteMutation > deletePreflight,
		"confirmed deletion must use fresh state and rebuild its update before sending");
	assert.equal((deletion.match(/sendState\s*\(/g) || []).length, 1);
	assertMatches(deletion, /buildDeleteSegmentUpdate/);

	const reset = functionBody(shellScript, "resetSegmentLayout");
	assertMatches(reset, /segmentStructuralLocked\s*\(\s*\)/);
	const structuralGuard = functionBody(shellScript, "segmentStructureBusy");
	assertMatches(structuralGuard, /segmentSubmitting\s*\|\|\s*segmentResetSubmitting/);
	const resetConfirmation = reset.indexOf("if (!segmentResetArmed)");
	const resetPreflight = reset.indexOf("readStructuralStateForWrite");
	const resetMutation = reset.indexOf("sendState(freshResult.update");
	assert.ok(resetConfirmation >= 0 && resetMutation > resetConfirmation);
	assert.ok(resetPreflight > resetConfirmation && resetMutation > resetPreflight,
		"confirmed reset must compare its armed layout with a fresh read before sending");
	assert.equal((reset.match(/sendState\s*\(/g) || []).length, 1);
	assertMatches(reset, /buildResetSegmentsUpdate/);
	assertMatches(reset, /segmentResetSubmitting\s*=\s*true[\s\S]*?sendState\s*\(/,
		"the reset in-flight guard must close before the mutation is released");
});

test("RC4 preset writes submit once, lock controls, and verify through GET-only reads", () => {
	const save = functionBody(shellScript, "submitPreset");
	assertMatches(save, /model\.buildPresetSaveUpdate\s*\(/);
	assertMatches(save, /if\s*\(\s*existing\s*&&\s*!presetOverwriteArmed\s*\)/);
	assert.equal((save.match(/sendState\s*\(/g) || []).length, 1, "preset save must have one mutation call site");
	const lock = save.indexOf("setPresetWritePending(true)");
	const queueDrain = save.indexOf("await mutationQueue");
	const statePreflight = save.indexOf("readPresetCaptureStateForWrite");
	const sourcePreflight = save.indexOf("preflightPresetSource");
	const stateSnapshot = save.indexOf("JSON.parse(JSON.stringify(freshState))");
	const mutation = save.indexOf("sendState(built.update");
	const verification = save.indexOf("verifyPresetFile");
	assert.ok(lock >= 0 && queueDrain > lock && statePreflight > queueDrain && sourcePreflight > statePreflight
		&& stateSnapshot > sourcePreflight
		&& mutation > stateSnapshot && verification > mutation,
		"preset controls must lock, drain prior mutations, verify displayed state, recheck the source last, submit once, and remain locked through verification");

	const presetPreflight = functionBody(shellScript, "preflightPresetSource");
	assertMatches(presetPreflight, /requestJSON\s*\(\s*`\/presets\.json\?preflight=/);
	assertNotMatches(presetPreflight, /sendState\s*\(/);
	const stateCapture = functionBody(shellScript, "readPresetCaptureStateForWrite");
	assertMatches(stateCapture, /requestJSON\s*\(\s*`\/json\/state\?capture=/);
	assertNotMatches(stateCapture, /sendState\s*\(/);
	assertMatches(save, /model\.presetCaptureSignature\(draft, freshState\)\s*!==\s*displayedStateSignature[\s\S]*?no save request was sent/i);
	assertMatches(save, /operation\s*!==\s*presetOperationVersion[\s\S]*?setPresetWritePending\(false\)/,
		"superseded save exits must release the write lock");

	const fileVerification = functionSource(shellScript, "verifyPresetFile");
	assertMatches(fileVerification, /requestJSON\s*\(\s*`\/presets\.json\?verify=/);
	assertMatches(fileVerification, /model\.verifyReadOnly/);
	assertMatches(fileVerification, /initialDelayMilliseconds\s*=\s*750/,
		"preset persistence verification must wait before its first read");
	assertNotMatches(fileVerification, /sendState\s*\(/);
	assertMatches(shellScript, /read-only persistence check/i);
	const startupVerification = functionBody(shellScript, "verifyStartupPreset");
	assertMatches(startupVerification, /requestJSON\s*\(\s*["']\/json\/info["']/);
	assertMatches(startupVerification, /requestJSON\s*\(\s*`\/cfg\.json\?verify=/);
	assertMatches(startupVerification, /requestJSON\s*\(\s*`\/presets\.json\?startup=/,
		"startup verification must prove the boot ID resolves to a saved preset");
	assertNotMatches(startupVerification, /sendState\s*\(/);

	const deletion = functionBody(shellScript, "deleteManagedPreset");
	assertMatches(deletion, /if\s*\(\s*!presetDeleteArmed\s*\)/);
	assert.equal((deletion.match(/sendState\s*\(/g) || []).length, 1, "preset delete must have one mutation call site");
	const deleteQueueDrain = deletion.indexOf("await mutationQueue");
	const startupPreflight = deletion.indexOf("readStartupConfigurationForWrite");
	const deleteSourcePreflight = deletion.indexOf("preflightPresetSource");
	const deleteMutation = deletion.indexOf("sendState({ pdel:");
	assert.ok(deleteQueueDrain >= 0 && startupPreflight > deleteQueueDrain && deleteSourcePreflight > startupPreflight
		&& deleteMutation > deleteSourcePreflight,
		"preset deletion must drain prior work, verify startup references, recheck its source last, then issue one mutation");
	assertMatches(deletion, /startupConfiguration\.runtime\s*===\s*id[\s\S]*?no delete request was sent/i,
		"the current startup preset must not be deleted");
	const startupDeletePreflight = functionBody(shellScript, "readStartupConfigurationForWrite");
	assertMatches(startupDeletePreflight, /requestJSON\s*\(\s*["']\/json\/info["']/);
	assertMatches(startupDeletePreflight, /requestJSON\s*\(\s*`\/cfg\.json\?preflight=/);
	assertNotMatches(startupDeletePreflight, /sendState\s*\(/);
	assertMatches(deletion, /startupPresetConfigurationIsUsable/);
	const presetAvailability = functionBody(shellScript, "updatePresetEditorAvailability");
	assertMatches(presetAvailability, /managesStartupPreset/);
	assertMatches(presetAvailability, /deletePreset\.disabled[\s\S]*?startupConfigurationInvalid[\s\S]*?managesStartupPreset/);
	assertMatches(presetAvailability, /savePreset\.disabled[\s\S]*?startupConfigurationInvalid[\s\S]*?!elements\.presetStartup\.checked/,
		"an invalid startup configuration must retain a startup-save repair path");
	assertMatches(deletion, /operation\s*!==\s*presetOperationVersion[\s\S]*?setPresetWritePending\(false\)/,
		"superseded delete exits must release the write lock");
	assertMatches(deletion, /verifyPresetFile\s*\(/);
	const persistenceVerification = deletion.indexOf("verifyPresetFile");
	const stateReconciliation = deletion.indexOf("reconcileCurrentStateReadOnly");
	const postDeleteStartup = deletion.indexOf("verifyPresetDeletionFinalState");
	const successDecision = deletion.indexOf("const verified =");
	assert.ok(stateReconciliation > persistenceVerification && postDeleteStartup > stateReconciliation && successDecision > postDeleteStartup);
	assertMatches(deletion, /finalVerification\.value[\s\S]*?startupPresetConfigurationIsUsable[\s\S]*?startupConfigurationInvalid\s*=\s*true/,
		"deletion must detect a startup reference raced in after its preflight");
	const deleteFinalRead = functionBody(shellScript, "verifyPresetDeletionFinalState");
	const finalInfoRead = deleteFinalRead.indexOf('requestJSON("/json/info"');
	const finalConfigRead = deleteFinalRead.indexOf("/cfg.json?delete=");
	const finalPresetRead = deleteFinalRead.indexOf("/presets.json?delete=");
	assert.ok(finalInfoRead >= 0 && finalConfigRead > finalInfoRead && finalPresetRead > finalConfigRead);
	assertMatches(deleteFinalRead, /value\.presets\[String\(id\)\]\s*==\s*null/);
	assertNotMatches(deleteFinalRead, /sendState\s*\(/);
});

test("RC4 preset recall is one-shot and remains locked through deferred readback", () => {
	const apply = functionBody(shellScript, "applySavedPreset");
	assert.equal((apply.match(/sendState\s*\(/g) || []).length, 1, "preset recall must have one mutation call site");
	const lock = apply.indexOf("setPresetApplyPending(true)");
	const mutation = apply.indexOf("sendState({ ps:");
	const verification = apply.indexOf("verifyPresetApplied");
	const unlock = apply.indexOf("setPresetApplyPending(false)");
	assert.ok(lock >= 0 && mutation > lock && verification > mutation && unlock > verification,
		"preset recall must remain locked until read-only verification settles");
	assertMatches(apply, /if\s*\(\s*!verification\.confirmed\s*\)\s*presetMutationUncertain\s*=\s*true/);

	const readback = functionBody(shellScript, "verifyPresetApplied");
	assertMatches(readback, /requestJSON\s*\(\s*["']\/json\/state["']/);
	assertMatches(readback, /model\.verifyReadOnly/);
	assertNotMatches(readback, /sendState\s*\(/);

	const sender = functionSource(shellScript, "sendState");
	assertMatches(sender, /presetApplyPending\s*&&\s*!allowDuringPresetApply/);
	const refresh = functionBody(shellScript, "refresh");
	assertMatches(refresh, /presetApplyPending/);
	const socket = functionBody(shellScript, "connectWebSocket");
	assertMatches(socket, /presetApplyPending/);
});

test("RC4 preset capture blocks conflicting refresh and WebSocket state", () => {
	const sender = functionSource(shellScript, "sendState");
	assertMatches(sender, /presetWritePending\s*&&\s*!allowDuringPresetWrite/);
	const refresh = functionBody(shellScript, "refresh");
	assertMatches(refresh, /presetWritePending/);
	const socket = functionBody(shellScript, "connectWebSocket");
	assertMatches(socket, /pendingMutations\s*\|\|\s*pickerInputActive\s*\|\|\s*segmentStructureBusy\(\)\s*\|\|\s*presetWritePending/);
});

test("RC4 uncertainty latches survive editor closure and clear only after an explicit successful refresh", () => {
	const sender = functionSource(shellScript, "sendState");
	assertMatches(sender, /presetMutationUncertain/, "preset uncertainty must block every later mutation");
	const segmentLock = functionBody(shellScript, "segmentMutationLocked");
	assertMatches(segmentLock, /structuralMutationUncertain/, "layout uncertainty must block segment-dependent mutations");
	const presetLock = functionBody(shellScript, "presetCaptureLocked");
	assertMatches(presetLock, /structuralMutationUncertain/, "layout uncertainty must block stale preset capture");
	for (const name of ["closeSegmentEditor", "closePresetEditor"]) {
		const close = functionBody(shellScript, name);
		assertNotMatches(close, /(?:structuralMutationUncertain|presetMutationUncertain)\s*=\s*false/,
			`${name} must not clear a controller-wide uncertainty latch`);
	}
	const refresh = functionBody(shellScript, "refresh");
	assertMatches(refresh, /if\s*\(\s*showSuccess\s*\)[\s\S]*?structuralMutationUncertain\s*=\s*false[\s\S]*?presetMutationUncertain\s*=\s*false/,
		"only an explicit successful refresh may clear uncertainty latches");
	assertMatches(refresh, /startupPresetUncertainId[\s\S]*?\/cfg\.json\?refresh=[\s\S]*?config\?\.def\?\.ps/,
		"startup-save uncertainty must recheck durable configuration before it can clear");
	assertMatches(refresh, /startupPresetConfigurationIsUsable[\s\S]*?startupConfigurationKnown\s*=\s*true[\s\S]*?if\s*\(\s*startupExpected\s*==\s*null\s*\|\|\s*startupConfigurationKnown\s*\)[\s\S]*?presetMutationUncertain\s*=\s*false/,
		"a known explicit startup result must release generic locks while retaining the narrower invalid-startup guard");
	assertMatches(refresh, /checkStartupConfiguration\s*=\s*showSuccess\s*\|\|\s*!stateLoaded/,
		"startup configuration must be validated on initial load and explicit refresh");
	for (const flag of ["structuralMutationUncertain", "presetMutationUncertain"]) {
		const falseAssignments = shellScript.match(new RegExp(`${flag}\\s*=\\s*false`, "g")) || [];
		assert.equal(falseAssignments.length, 2, `${flag} must have only its initialization and one explicit-refresh clear site`);
	}
});

test("CastleTek circular picker loads namespaced iro and commits only at pointer end", () => {
	assertMatches(shellScript, /document\.createElement\(["']script["']\)/);
	assertMatches(shellScript, /route\(["']\/iro\.js["']\)/);
	assertMatches(shellScript, /new\s+iro\.ColorPicker\s*\(/);
	assertMatches(shellScript, /iro\.ui\.Wheel/);

	const pickerCommit = eventBinding(shellScript, "input:end");
	assertMatches(pickerCommit, /(?:send|commit|queue|enqueue|flush)/i,
		"input:end must commit the selected color");
	const pickerPreview = eventBinding(shellScript, "color:change");
	assertNotMatches(pickerPreview, /(?:sendState|sendSegment|requestJSON|commit|queue|enqueue|flush)/i,
		"color:change must update only local preview state");
});

test("quick Black clears RGBW only in the active slot while other quick colors preserve white", () => {
	const quickColors = controlEventBinding(shellScript, "swatches", "click");
	assertMatches(quickColors, /const\s+context\s*=\s*currentColorCommandContext\(\)/,
		"quick colors must capture their slot and selected targets before updating the picker");
	assertMatches(quickColors, /hex\s*===\s*["']#000000["']/);
	assertMatches(quickColors, /model\.colorSlotPatch\(context\.slot\s*,\s*\{\s*r\s*:\s*0\s*,\s*g\s*:\s*0\s*,\s*b\s*:\s*0\s*,\s*w\s*:\s*0\s*\}\s*\)/,
		"Black must explicitly clear the selected slot's RGB and white channels");
	assertMatches(quickColors, /sendSegmentState\(patch\s*,\s*context\.targetIds\)/,
		"Black must remain scoped to the selected targets");
	assertMatches(quickColors, /commitPickerColor\(hexToRgb\(hex\)\s*,\s*context\)/,
		"non-black quick colors must retain the existing RGB-only white-preserving path");
	assert.equal((quickColors.match(/sendSegmentState\s*\(/g) || []).length, 1,
		"the delegated quick-color handler must contain only one special Black send site");
});

test("CastleTek shell renders real segment selectors and sends explicit selected-ID arrays", () => {
	assertMatches(shellScript, /document\.createElement\(["']input["']\)/);
	assertMatches(shellScript, /\.type\s*=\s*["']checkbox["']/);
	assertMatches(shellScript, /elements\.segments\.(?:replaceChildren|append|appendChild)/);
	assertMatches(shellScript, /(?:segment-target|segment-chip)/);

	assertMatches(shellScript, /(?:length|size)\s*(?:===?|<=)\s*0|!\s*[^;\n]*(?:length|size)/,
		"selection logic must explicitly handle zero selected segments");
	assertMatches(shellScript, /(?:at least one segment|select a segment|one segment must remain selected)/i);
	assertMatches(shellScript, /\.map\([\s\S]{0,160}?=>\s*\(\{\s*id\s*[:,][\s\S]{0,100}?sel\s*:/,
		"selection persistence must include every segment id and selection value");
	assertMatches(shellScript, /\.map\([\s\S]{0,160}?=>\s*\(\{\s*id\s*[:,][\s\S]{0,100}?\.\.\./,
		"segment commands must map a patch to an explicit array of selected ids");

	for (const property of ["fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"]) {
		assertMatches(shellScript, new RegExp(`\\{\\s*${property}\\s*:`),
			`missing segment-scoped ${property} command`);
	}
	assertMatches(shellScript, /model\.colorSlotPatch\s*\(/,
		"color commands must use the model's sparse WLED slot patch");
	assertNotMatches(shellScript, /seg\s*:\s*\[\s*\{\s*id\s*:\s*mainSegment\s*\(/,
		"appearance commands must not be pinned to only the main segment");
});

test("effect and palette send on selection while sliders send on release", () => {
	for (const control of ["effect", "palette"]) {
		const binding = controlEventBinding(shellScript, control, "change");
		assertMatches(binding, /(?:send|commit|queue|enqueue)/i, `${control} selection must send immediately`);
	}

	for (const control of ["speed", "intensity", "custom1", "custom2", "custom3"]) {
		const preview = controlEventBinding(shellScript, control, "input");
		assertNotMatches(preview, /(?:sendState|sendSegment|requestJSON|commit|queue|enqueue|flush)/i,
			`${control} input must be local preview only`);
		const release = controlEventBinding(shellScript, control, "change");
		assertMatches(release, /(?:send|commit|queue|enqueue)/i, `${control} must send on release/change`);
	}
	for (const [control, property] of [["option1", "o1"], ["option2", "o2"], ["option3", "o3"]]) {
		const change = controlEventBinding(shellScript, control, "change");
		assertMatches(change, new RegExp(`sendSegmentState\\s*\\(\\s*\\{\\s*${property}\\s*:`),
			`${control} must send its WLED boolean immediately`);
		assertMatches(change, new RegExp(`elements\\.${control}\\.checked`),
			`${control} must send a Boolean checkbox value`);
	}
});

test("color value previews locally and commits only on release", () => {
	const previewBinding = controlEventBinding(shellScript, "colorValue", "input");
	assertMatches(previewBinding, /preview/i, "color value input must use a local preview handler");
	assertNotMatches(previewBinding, /(?:sendState|sendSegment|requestJSON|commit|queue|enqueue|flush)/i,
		"color value input must not mutate the controller while sliding");

	const previewBody = functionBody(shellScript, "previewColorValue");
	assertMatches(previewBody, /colorValueValue/, "preview must update the visible percentage output");
	assertMatches(previewBody, /(?:setChannel|updateColorPresentation)/,
		"preview must update the wheel or local color presentation");
	assertNotMatches(previewBody, /(?:sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection)\s*\(/,
		"preview helper must remain mutation-free");

	const releaseBinding = controlEventBinding(shellScript, "colorValue", "change");
	assertMatches(releaseBinding, /commitPickerColor\s*\(/,
		"color value change must commit once when the pointer or finger is released");
});

test("segment capabilities dynamically expose the WLED color sliders", () => {
	const renderer = functionBody(shellScript, "renderColorControls");
	assertMatches(renderer, /model\.colorControls\(activeSegments\(\), selectedSegmentIds\(\)\)/,
		"visibility must use only the current explicit CastleTek targets");
	for (const [element, property] of [
		["colorValueControl", "value"], ["colorTemperatureControl", "kelvin"],
		["whiteBalanceControl", "whiteBalance"], ["whiteChannelControl", "white"]
	]) {
		assertMatches(renderer, new RegExp(`elements\\.${element}\\.hidden\\s*=\\s*!controls\\.${property}`),
			`${element} must follow ${property} capability`);
	}
	assertMatches(renderer, /colorPicker\.hidden\s*=\s*!controls\.rgb/);
	assertMatches(renderer, /swatches\.hidden\s*=\s*!controls\.rgb/);
	assertMatches(renderer, /segment\?\.col\?\.\[activeColorSlot\]/,
		"displayed RGB and W values must come from the active WLED color slot");
	assertMatches(renderer, /segment\?\.cct\s*\?\?\s*127/,
		"White Balance must reflect the reference segment's CCT value");
	const interactionGuard = renderer.match(/if\s*\(\s*!pickerInputActive\s*\)\s*(\{[\s\S]*\})/);
	assert.ok(interactionGuard, "color-state synchronization must be guarded during a drag");
	for (const control of ["colorTemperature", "whiteChannel", "whiteBalance"]) {
		assertMatches(interactionGuard[1], new RegExp(`syncControlValue\\(elements\\.${control}`),
			`${control} must not be reset by a queued response during its drag`);
	}
	assertNotMatches(renderer, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/,
		"capability rendering must stay read-only");

	const segmentsRenderer = functionBody(shellScript, "renderSegments");
	assertMatches(segmentsRenderer, /renderColorControls\(referenceSegment\(\)\)/,
		"optimistic target changes must update color capabilities before their selection request settles");
	assertMatches(shellStyle, /\.color-card\s+\[hidden\]\s*\{[^}]*display\s*:\s*none/,
		"author CSS must keep dynamically unsupported controls hidden");
});

test("Kelvin, White, and White Balance preview locally and send partial state on release", () => {
	for (const [control, previewHelper] of [
		["colorTemperature", "previewColorTemperature"],
		["whiteChannel", "previewWhiteChannel"],
		["whiteBalance", "previewWhiteBalance"]
	]) {
		const preview = controlEventBinding(shellScript, control, "input");
		assertMatches(preview, new RegExp(`${previewHelper}\\b`), `${control} must use its local preview helper`);
		const helper = functionBody(shellScript, previewHelper);
		assertMatches(helper, /beginColorInteraction\s*\(\s*\)/,
			`${control} drag must participate in stale-state suppression`);
		assertNotMatches(helper, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/,
			`${control} input must not mutate the controller while sliding`);
	}

	const kelvinRelease = controlEventBinding(shellScript, "colorTemperature", "change");
	assertMatches(kelvinRelease, /model\.kelvinToRgb\(/,
		"Kelvin must be converted locally into RGB like stock WLED");
	assertMatches(kelvinRelease, /commitPickerColor\s*\(/,
		"Kelvin release must use the existing partial RGB object path");
	assertNotMatches(kelvinRelease, /\bcct\s*:/,
		"Kelvin is a generated RGB color, not segment White Balance");

	const whiteRelease = controlEventBinding(shellScript, "whiteChannel", "change");
	assertMatches(whiteRelease, /model\.colorSlotPatch\(context\.slot\s*,\s*\{\s*w\s*:/,
		"White release must build a sparse patch for the active slot containing only W");
	assertMatches(whiteRelease, /sendSegmentState\s*\(\s*patch\s*,\s*context\.targetIds\s*\)/,
		"White release must send to the targets captured when its drag began");
	assertNotMatches(whiteRelease, /\b[rgb]\s*:/,
		"White release must not replace RGB channels");

	const balanceRelease = controlEventBinding(shellScript, "whiteBalance", "change");
	assertMatches(balanceRelease, /sendSegmentState\s*\(\s*\{\s*cct\s*:/,
		"White Balance release must send segment CCT only");
	assertNotMatches(balanceRelease, /\bcol\s*:/,
		"White Balance must not rewrite color channels");

	const rgbCommit = functionBody(shellScript, "commitPickerColor");
	assertMatches(rgbCommit, /model\.colorSlotPatch\(context\.slot\s*,\s*rgb\s*\)/,
		"wheel, Value, Hex, and Kelvin must build a sparse object-form RGB patch for the captured slot");
	assertMatches(rgbCommit, /sendSegmentState\s*\(\s*patch\s*,\s*context\.targetIds\s*\)/,
		"RGB release must send to the targets captured when its gesture began");
});

test("color-slot controls follow WLED metadata and switch locally without mutating", () => {
	assertMatches(shellScript, /let\s+activeColorSlot\s*=\s*0/);
	const renderer = functionBody(shellScript, "renderColorSlots");
	assertMatches(renderer, /model\.colorSlots\(effectMetadata\s*,\s*segment\?\.fx\s*,\s*segment\?\.pal\)/,
		"slot visibility and labels must use the active effect and palette metadata");
	assertMatches(renderer, /definition\.visible/);
	assertMatches(renderer, /button\.hidden/);
	assertMatches(renderer, /aria-pressed/);
	assertMatches(renderer, /color-slot-swatch/);
	assertNotMatches(renderer, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/,
		"rendering slots must remain read-only");

	const selection = functionBody(shellScript, "selectColorSlot");
	assertMatches(selection, /activeColorSlot\s*=\s*definition\.index/);
	assertMatches(selection, /renderColorControls\s*\(\s*segment\s*\)/);
	assertNotMatches(selection, /sendState|sendSegmentState|requestJSON|commitPickerColor|persistTargetSelection/,
		"choosing a slot must only change which color is being edited");
	assertMatches(shellScript, /button\.addEventListener\(\s*["']click["']\s*,\s*\(\)\s*=>\s*selectColorSlot/);

	const metadataLoader = functionBody(shellScript, "loadEffectMetadata");
	assertMatches(metadataLoader, /renderColorControls\(referenceSegment\(\)\)/,
		"new metadata must immediately refresh slot visibility");
});

test("color gestures retain their starting slot and explicit target IDs", () => {
	const begin = functionBody(shellScript, "beginColorInteraction");
	assertMatches(begin, /context\s*=\s*context\s*\|\|\s*currentColorCommandContext\(\)/);
	assertMatches(begin, /pendingColorInteraction\s*=\s*context/);
	assertMatches(begin, /pickerInputActive\s*=\s*true/);
	const context = functionBody(shellScript, "currentColorCommandContext");
	assertMatches(context, /slot\s*:\s*activeColorSlot/);
	assertMatches(context, /targetIds\s*:\s*selectedSegmentIds\s*\(\s*\)/);
	const finish = functionBody(shellScript, "endColorInteraction");
	assertMatches(finish, /pendingColorInteraction\s*\|\|\s*currentColorCommandContext\s*\(\s*\)/);
	assertMatches(finish, /pendingColorInteraction\s*=\s*null/);
	const slotRenderer = functionBody(shellScript, "renderColorSlots");
	assertMatches(slotRenderer, /!pickerInputActive\s*&&\s*!visible\.some/,
		"state renders must not switch the active slot in the middle of a gesture");
	const sender = functionSource(shellScript, "sendSegmentState");
	assertMatches(sender, /targetIds\s*=\s*selectedSegmentIds\(\)/);
	assertMatches(sender, /Array\.from\(targetIds/,
		"segment commands must accept the explicit IDs captured for a color gesture");

	const hexFocus = controlEventBinding(shellScript, "colorHex", "focus");
	assertMatches(hexFocus, /beginColorInteraction/,
		"hex editing must capture its slot and targets when the field gains focus");
	const hexCommit = functionBody(shellScript, "commitHexInput");
	const contextCapture = hexCommit.indexOf("const context = endColorInteraction()");
	const commit = hexCommit.indexOf("commitPickerColor(hexToRgb(hex), context)");
	assert.ok(contextCapture >= 0 && commit > contextCapture,
		"hex commits must use the slot and targets captured before editing");
	const hexEnter = controlEventBinding(shellScript, "colorHex", "keydown");
	const enterCommit = hexEnter.indexOf("commitHexInput()");
	const enterBlur = hexEnter.indexOf("elements.colorHex.blur()", enterCommit);
	assert.ok(enterCommit >= 0 && enterBlur > enterCommit,
		"Enter must commit the captured hex interaction before leaving the field");
	assertMatches(hexEnter, /hexEnterCommitted\s*=\s*true/,
		"Enter must suppress the duplicate native change event caused by blur");
});

test("controller requests have a bounded abort timeout", () => {
	const request = functionSource(shellScript, "requestResponse");
	assertMatches(request, /new\s+AbortController\s*\(\)/);
	const timeoutMatch = request.match(/setTimeout\s*\(\s*\(\)\s*=>\s*\w+\.abort\s*\(\s*\)\s*,\s*(\w+)\s*\)/);
	assert.ok(timeoutMatch, "requestResponse must abort a stalled fetch after a fixed timeout");
	assert.equal(timeoutMatch[1], "timeoutMilliseconds");
	assertMatches(request, /timeoutMilliseconds\s*=\s*8000/,
		"request timeout must have a positive bounded default");
	assertMatches(request, /signal\s*:\s*\w+\.signal/, "fetch must receive the AbortController signal");
	assertMatches(request, /finally\s*\{[\s\S]*?clearTimeout\s*\(/,
		"request timeout must be cleared on every completion path");
});

test("cancel and focus-loss recovery end picker interaction without a mutation", () => {
	assertMatches(shellScript, /document\.addEventListener\(\s*["']touchcancel["']\s*,\s*cancelPickerInteraction/);
	assertMatches(shellScript, /document\.addEventListener\(\s*["']pointercancel["']\s*,\s*cancelPickerInteraction/);
	assertMatches(shellScript, /window\.addEventListener\(\s*["']blur["']\s*,\s*cancelPickerInteraction/);

	const cancel = functionBody(shellScript, "cancelPickerInteraction");
	assertMatches(cancel, /if\s*\(\s*!pickerInputActive\s*\)\s*return/,
		"cancel recovery must be inert outside an active picker gesture");
	assertMatches(cancel, /pickerInputActive\s*=\s*false/);
	assertMatches(cancel, /pickerStartedBlack\s*=\s*false/);
	assertMatches(cancel, /refresh\s*\(\s*false\s*\)/,
		"cancel recovery should reconcile with a read-only refresh");
	assertNotMatches(cancel, /(?:sendState|sendSegmentState|commitPickerColor|persistTargetSelection)\s*\(/,
		"cancel, pointercancel, touchcancel, and blur must not send a mutation");
});

test("iro loading has per-attempt timeout and a finite retry limit", () => {
	const loader = functionSource(shellScript, "loadColorPicker");
	const perAttemptTimeout = loader.match(/setTimeout\s*\(\s*\(\)\s*=>\s*retry\s*\(\s*\)\s*,\s*(\d+)\s*\)/);
	assert.ok(perAttemptTimeout, "iro loading must time out a stalled script request");
	const timeoutMilliseconds = Number(perAttemptTimeout[1]);
	assert.ok(timeoutMilliseconds > 0 && timeoutMilliseconds <= 10000,
		`iro attempt timeout must be positive and bounded, got ${timeoutMilliseconds}ms`);

	const retryLimit = loader.match(/if\s*\(\s*attempt\s*<\s*(\d+)\s*\)/);
	assert.ok(retryLimit, "iro retries must have a numeric upper bound");
	const maximumRetryIndex = Number(retryLimit[1]);
	assert.ok(maximumRetryIndex >= 1 && maximumRetryIndex <= 5,
		`iro retry limit must remain small and finite, got ${maximumRetryIndex}`);
	assertMatches(loader, /loadColorPicker\s*\(\s*attempt\s*\+\s*1\s*\)/,
		"each retry must advance the bounded attempt counter");
	assertMatches(loader, /script\.remove\s*\(\s*\)/, "failed script elements must be removed before retrying");
	assertMatches(loader, /clearTimeout\s*\(/, "iro timeout must be cleared after load or failure");
	assertMatches(loader, /Color wheel unavailable[\s\S]*?resolve\s*\(\s*\)/,
		"the final failed attempt must settle with the non-modal fallback controls");
});

test("versioned selection responses cannot replace newer optimistic targets", () => {
	assertMatches(shellScript, /let\s+targetSelectionVersion\s*=\s*0/);
	assertMatches(shellScript, /let\s+confirmedTargetSelectionVersion\s*=\s*0/);
	assertMatches(shellScript,
		/function\s+applyState\s*\(\s*state\s*,\s*synchronizeTargets\s*=\s*confirmedTargetSelectionVersion\s*===\s*targetSelectionVersion\s*\)/,
		"state application must gate target synchronization on the latest confirmed selection version");
	const applyState = functionBody(shellScript, "applyState");
	assertMatches(applyState, /if\s*\(\s*synchronizeTargets\s*\)\s*syncTargetsFromState\s*\(/);

	const sender = functionBody(shellScript, "sendState");
	const confirmation = sender.indexOf("selectionVersion === targetSelectionVersion");
	const responseApplication = sender.indexOf("applyState(response.state || response)");
	assert.ok(confirmation >= 0 && responseApplication > confirmation,
		"a selection response must be version-checked before its state is applied");
	assertMatches(sender,
		/if\s*\(\s*selectionVersion\s*===\s*targetSelectionVersion\s*\)\s*confirmedTargetSelectionVersion\s*=\s*selectionVersion/,
		"only the latest selection response may confirm target synchronization");
	const reconciliation = functionBody(shellScript, "reconcileAfterUnconfirmedChange");
	assertMatches(reconciliation,
		/if\s*\(\s*selectionVersion\s*===\s*targetSelectionVersion\s*\)\s*confirmedTargetSelectionVersion\s*=\s*selectionVersion/,
		"read-only reconciliation must preserve a newer optimistic target selection");

	const persistence = functionBody(shellScript, "persistTargetSelection");
	const versionAdvance = persistence.indexOf("targetSelectionVersion += 1");
	const versionedSend = persistence.indexOf("sendState(update, targetSelectionVersion)");
	assert.ok(versionAdvance >= 0 && versionedSend > versionAdvance,
		"selection persistence must advance and attach its version before sending");

	const toggle = functionBody(shellScript, "toggleSegmentTarget");
	const optimisticSet = toggle.indexOf("targetSegmentIds = next");
	const optimisticRender = toggle.indexOf("renderSegments()", optimisticSet);
	const persistenceStart = toggle.indexOf("persistTargetSelection()", optimisticRender);
	assert.ok(optimisticSet >= 0 && optimisticRender > optimisticSet && persistenceStart > optimisticRender,
		"new targets must render optimistically before the versioned request starts");
});

test("expanded color controls use one semantic vertical order at every width", () => {
	assertNotMatches(shellHtml, /\bcolor-layout\b|\bcolor-details\b|\bcolor-picker-column\b/,
		"obsolete two-column wrappers must not alter visual or keyboard order");
	assertMatches(shellStyle, /\.color-expanded-controls\s*\{[^}]*display\s*:\s*grid[^}]*gap\s*:\s*16px/);
});

test("refresh cannot overwrite state received from WebSocket while requests are in flight", () => {
	assertMatches(shellScript, /let\s+stateGeneration\s*=\s*0/,
		"received controller state must have a generation counter");
	const applyState = functionBody(shellScript, "applyState");
	assertMatches(applyState, /stateGeneration\s*\+=\s*1/,
		"every accepted state, including WebSocket state, must advance the generation");
	const socket = functionBody(shellScript, "connectWebSocket");
	assertMatches(socket, /onmessage[\s\S]*?applyState\s*\(/,
		"WebSocket messages must flow through generation-counted state application");

	const refresh = functionBody(shellScript, "refresh");
	const generationCapture = refresh.indexOf("const generation = stateGeneration");
	const firstRequest = refresh.indexOf("await requestJSON");
	const generationGuard = refresh.indexOf("generation !== stateGeneration");
	const stateApplication = refresh.indexOf("applyState(snapshot.state || {}, true)");
	assert.ok(generationCapture >= 0 && firstRequest > generationCapture
		&& generationGuard > firstRequest && stateApplication > generationGuard,
		"refresh must capture generation before awaiting and reject stale results before applying state");
});

test("effect and palette options are not rebuilt on every state render", () => {
	const body = functionBody(shellScript, "fillSelect");
	const rebuild = body.indexOf("replaceChildren");
	assert.ok(rebuild >= 0, "fillSelect must populate the available options");
	const beforeRebuild = body.slice(0, rebuild);
	assertMatches(beforeRebuild, /\bif\s*\(/, "fillSelect must compare existing options before rebuilding");
	assertMatches(beforeRebuild, /\breturn\b/, "fillSelect must return without rebuilding unchanged options");
	assertMatches(body, /\.value\s*=/, "fillSelect must still synchronize the selected value");
	assertMatches(body, /option\.value\s*=\s*String\(entry\.id\)/,
		"sorted options must keep the firmware's original numeric IDs");
	assertNotMatches(body, /option\.value\s*=\s*String\(index\)/,
		"a sorted display index must never be sent as an effect or palette ID");
});

test("effect controls use optional namespaced WLED metadata without adding mutations", () => {
	const loader = functionBody(shellScript, "loadEffectMetadata");
	assertMatches(loader, /requestJSON\s*\(\s*["']\/json\/fxdata["']/,
		"effect metadata must come from the namespaced route helper");
	assertMatches(loader, /values\.length\s*!==\s*expectedLength/,
		"positional metadata must match the current effect catalog");
	assertNotMatches(loader, /sendState|sendSegmentState/,
		"effect metadata loading must remain read-only");

	const renderer = functionBody(shellScript, "renderEffectControls");
	assertMatches(renderer, /model\.effectControls\(effectMetadata, effectId\)/);
	for (const id of ["speedControl", "intensityControl", "custom1Control", "custom2Control", "custom3Control",
		"option1Control", "option2Control", "option3Control"]) {
		assertMatches(renderer, new RegExp(`elements\\.${id}`), `metadata renderer must include ${id}`);
	}
	assertMatches(renderer, /controls\.sliders\[index\]/);
	assertMatches(renderer, /controls\.options\[index\]/);
	assertMatches(renderer, /effectOptions\.hidden\s*=\s*!controls\.options\.some/);
	assertMatches(renderer, /effectChangePending/,
		"effect parameters must remain disabled while new effect defaults are being confirmed");
	assertNotMatches(renderer, /sendState|sendSegmentState/,
		"rendering effect metadata must not create a controller mutation");

	const stateRenderer = functionBody(shellScript, "renderState");
	for (const property of ["c1", "c2", "c3", "o1", "o2", "o3"]) {
		assertMatches(stateRenderer, new RegExp(`segment\\.${property}\\b`),
			`state rendering must synchronize ${property}`);
	}

	const effectChange = controlEventBinding(shellScript, "effect", "change");
	assertMatches(effectChange, /if\s*\(\s*effectChangePending\s*\)\s*return/,
		"rapid duplicate effect events must be ignored while the prior effect is pending");
	const localRender = effectChange.indexOf("renderEffectControls(effectId)");
	const mutation = effectChange.indexOf("sendSegmentState({ fx: effectId");
	assert.ok(localRender >= 0 && mutation > localRender,
		"the selected effect's labels must update immediately before its one existing mutation");
	const lock = effectChange.indexOf("effectChangePending = true", mutation);
	const unlock = effectChange.indexOf("effectChangePending = false", lock);
	assert.ok(lock > mutation && unlock > lock,
		"effect controls must lock after the single mutation is accepted and unlock when it settles");
	const segments = functionBody(shellScript, "renderSegments");
	assertMatches(segments, /effectChangePending\s*&&\s*effectMutationControls\.includes\(control\)/,
		"the rendered effect dropdown, sliders, and checkboxes must stay locked until confirmation");
});

async function readStableGeneratedHeader(relativePath) {
	const absolutePath = path.join(root, relativePath);
	const sourcePaths = [
		"wled00/data/castletek.htm",
		"wled00/data/castletek-control.css",
		"wled00/data/castletek-control-model.js",
		"wled00/data/castletek-control.js",
		"wled00/data/castletek-logo.png",
		"wled00/data/castletek-branding.css",
		"wled00/data/castletek-branding.js",
		"tools/cdata.js"
	].map(source => path.join(root, source));
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const before = fs.statSync(absolutePath);
			if (sourcePaths.some(source => fs.statSync(source).mtimeMs > before.mtimeMs)) return null;
			const first = fs.readFileSync(absolutePath, "utf8");
			await new Promise(resolve => setTimeout(resolve, 15));
			const second = fs.readFileSync(absolutePath, "utf8");
			const after = fs.statSync(absolutePath);
			if (before.size === after.size && before.mtimeMs === after.mtimeMs && first === second) return first;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await new Promise(resolve => setTimeout(resolve, 15));
	}
	return null;
}

function decodeGeneratedPage(header) {
	const lengthMatch = header.match(/const uint16_t PAGE_castletek_length = (\d+);/);
	const arrayMatch = header.match(/const uint8_t PAGE_castletek\[\] PROGMEM = \{([\s\S]*?)\n\};/);
	assert.ok(lengthMatch, "generated page length declaration is missing");
	assert.ok(arrayMatch, "generated page byte array is missing");
	const bytes = Buffer.from([...arrayMatch[1].matchAll(/0x([0-9a-f]{2})/gi)]
		.map(match => Number.parseInt(match[1], 16)));
	assert.equal(bytes.length, Number(lengthMatch[1]), "generated byte count does not match PAGE_castletek_length");
	assert.ok(bytes.length <= 0xffff, "generated PAGE_castletek exceeds its uint16_t length field");
	return zlib.gunzipSync(bytes).toString("utf8");
}

test("generated PAGE_castletek gzip carries the same controls when available", async context => {
	const header = await readStableGeneratedHeader("wled00/html_castletek.h");
	if (!header) {
		context.skip("generated header is absent or another test is rebuilding it");
		return;
	}
	const generatedPage = decodeGeneratedPage(header);
	assertControlMarkup(generatedPage);
	assertRC4Markup(generatedPage);
	assertRC8Markup(generatedPage);
	assertRC9Markup(generatedPage);
	assertRC10Markup(generatedPage);
	assertRC11Markup(generatedPage);
	for (const id of ["segmentEditorHome", "presetEditorHome"]) {
		assertMatches(generatedPage, idPattern(id), `generated page is missing #${id}`);
	}
	assertMatches(generatedPage, idPattern("segmentBatchDrafts"),
		"generated page is missing the staged segment list");
	assertMatches(generatedPage, /newSegmentBatchPlan/,
		"generated page is missing the ordered batch planner");
	assertMatches(generatedPage, /buildCreateSegmentBatchMutation/,
		"generated page is missing the fresh-preflight batch compiler");
	assertMatches(generatedPage, /complete layout is sent only when you choose Create segments/i,
		"generated page is missing the single-submit batch guidance");
	assertMatches(generatedPage, /accordion-toggle segment-expand/);
	assertMatches(generatedPage, /accordion-toggle preset-expand/);
	assertMatches(generatedPage, /data-expand-segment-id/);
	assertMatches(generatedPage, /data-expand-preset-id/);
	assertMatches(generatedPage, /\.segment-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
	assertMatches(generatedPage, /\.preset-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
	assertNotMatches(generatedPage, /segment-edit|preset-manage|>•••</);
	const generatedModel = generatedPage.indexOf("CastleTekControlModel");
	const generatedUse = generatedPage.indexOf("CastleTek control model did not load");
	assert.ok(generatedModel >= 0 && generatedUse > generatedModel, "the generated page must inline the model before its controller use");
	assertNotMatches(generatedPage, /src=(?:["']?)castletek-control-model\.js/i,
		"the embedded firmware page cannot depend on a loose model script");
	assertMatches(generatedPage, /\/iro\.js/);
	assertMatches(generatedPage, /input:end/);
	assertMatches(generatedPage, /color:change/);
	assertMatches(generatedPage, /iro\.ui\.Wheel/);
	assertMatches(generatedPage, /src=(?:["']?)castletek-logo\.png/i);
	assertMatches(generatedPage, /href=(?:["']?)castletek-branding\.css/i);
	assertMatches(generatedPage, /src=(?:["']?)castletek-branding\.js/i);
	assertNotMatches(generatedPage, /data:image\/png;base64/,
		"the approved logo must be cached once, not embedded in each page");
	assertMatches(generatedPage, /\.swatches\{[^}]*grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/,
		"generated page must preserve the eight-across quick-color row");
	assertNotMatches(generatedPage, /\.color-layout\{/,
		"generated page must preserve the single semantic color-control order");
});

// The staged row's selection must remain visible after a direct tap into an editable field.
test("staged segment styling follows persistent selection and every name stays editable", () => {
	assertMatches(shellScript, /button\.setAttribute\("aria-pressed", String\(index === segmentEditorBatchIndex\)\)/);
	assertMatches(shellStyle, /\.segment-batch-draft\[aria-pressed="true"\]\s*\{[^}]*border-color:\s*var\(--cyan\)/);
	assertNotMatches(shellStyle, /\.segment-batch-draft\[aria-selected=/);
	assertNotMatches(shellScript, /elements\.segmentName\.readOnly\s*=/);
	assertNotMatches(elementWithId(shellHtml, "segmentName").markup, /\breadonly(?:\s|=|>)/i);
});
