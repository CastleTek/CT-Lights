"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const common = fs.readFileSync(path.join(root, "wled00/data/common.js"), "utf8");
const branding = fs.readFileSync(path.join(root, "wled00/data/castletek-branding.js"), "utf8");

test("branding assets load only on Compatibility settings and preserve reverse proxy prefixes", () => {
	for (const [pathname, expected] of [
		["/settings", null], ["/settings/wifi", null],
		["/api/castletek/v1/settings", null], ["/proxy/api/castletek/v1/settings/leds", null],
		["/castletek/v10/settings", null], ["/castletek/v1/", null],
		["/castletek/v1/settings", "/castletek/v1"],
		["/proxy/castletek/v1/settings/leds", "/proxy/castletek/v1"]
	]) {
		const assets = [], removed = [];
		const document = {
			readyState: "complete", addEventListener() {}, createElement: tag => ({ tag }),
			head: { appendChild: element => assets.push(element) },
			querySelectorAll: selector => {
				assert.equal(selector, ".helpB");
				return [{ remove: () => removed.push("help") }];
			}
		};
		vm.runInNewContext(common, { document, window: { location: { pathname } }, console });
		assert.deepEqual(assets.map(asset => asset.href || asset.src), expected ? [
			expected + "/castletek-branding.css", expected + "/castletek-branding.js"
		] : [], pathname);
		assert.deepEqual(removed, expected ? ["help"] : [], pathname);
	}
});

test("Home and Design navigation keeps drafts mounted and does not access the network", () => {
	const listeners = new Map();
	const makeElement = () => ({ children: [], attributes: {}, appendChild(child) { this.children.push(child); },
		setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } });
	const body = makeElement();
	body.classList = { contains: name => name === "ct-control", add() {} };
	const draft = { value: "Unsaved lighting look" };
	const home = { dataset: { ctPage: "home" }, hidden: false, draft };
	const design = { dataset: { ctPage: "design" }, hidden: true, draft: { value: "Unsaved segment" } };
	const title = {}, subtitle = {};
	const document = {
		currentScript: { src: "http://localhost/proxy/castletek/v1/castletek-branding.js" },
		readyState: "complete", body, createElement: makeElement,
		getElementById: id => ({ ctHeader: {}, ctPageTitle: title, ctPageSubtitle: subtitle })[id],
		querySelectorAll: () => [home, design]
	};
	const location = { pathname: "/proxy/castletek/v1/", hash: "#design" };
	const window = { location, addEventListener: (name, action) => listeners.set(name, action), scrollTo() {}, dispatchEvent() {} };
	// No fetch or WebSocket is provided: navigation must remain entirely local.
	vm.runInNewContext(branding, { document, window, URL, Event });
	const links = body.children[0].children;
	assert.equal(title.textContent, "Design");
	assert.equal(home.hidden, true);
	assert.equal(design.hidden, false);
	assert.equal(links[1].attributes["aria-current"], "page");
	assert.equal(links[2].href, "/proxy/castletek/v1/settings");
	location.hash = "#home";
	listeners.get("hashchange")();
	assert.equal(home.hidden, false);
	assert.equal(design.hidden, true);
	assert.equal(home.draft, draft);
	assert.equal(home.draft.value, "Unsaved lighting look");
	assert.equal(design.draft.value, "Unsaved segment");
	assert.equal(links[0].attributes["aria-current"], "page");
	assert.equal(links[1].attributes["aria-current"], undefined);
	location.hash = "#unknown";
	listeners.get("hashchange")();
	assert.equal(title.textContent, "Home");
});
