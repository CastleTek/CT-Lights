(() => {
	"use strict";

	const namespace = "/castletek/v1";
	const authenticatedNamespace = "/api/castletek/v1";
	const pathname = window.location.pathname;
	const namespaceIndex = path => {
		if (path === authenticatedNamespace || path.startsWith(authenticatedNamespace + "/")) return -1;
		const index = path.indexOf(namespace);
		const end = index + namespace.length;
		const prefix = index >= 0 ? path.slice(0, index) : "";
		const authenticatedProxy = prefix === "/api" || prefix.endsWith("/api");
		return index >= 0 && !authenticatedProxy && (end === path.length || path.charAt(end) === "/") ? index : -1;
	};
	const marker = namespaceIndex(pathname);
	const proxyPrefix = marker >= 0 ? pathname.slice(0, marker) : "";
	const base = proxyPrefix + namespace;
	const route = path => base + path;
	const byId = id => document.getElementById(id);
	const model = window.CastleTekControlModel;
	if (!model) throw new Error("CastleTek control model did not load");
	const elements = {
		connection: byId("connection"), deviceName: byId("deviceName"),
		renameForm: byId("renameForm"), renameName: byId("renameName"),
		renameSave: byId("renameSave"), renameCancel: byId("renameCancel"), renameStatus: byId("renameStatus"),
		power: byId("power"), powerLabel: byId("powerLabel"), brightness: byId("brightness"),
		brightnessValue: byId("brightnessValue"), colorSlots: byId("colorSlots"), colorPicker: byId("colorPicker"),
		colorExpand: byId("colorExpand"), colorExpandedControls: byId("colorExpandedControls"),
		colorHexControl: byId("colorHexControl"), colorHex: byId("colorHex"),
		colorValueControl: byId("colorValueControl"), colorValue: byId("colorValue"),
		colorValueValue: byId("colorValueValue"), colorTemperatureControl: byId("colorTemperatureControl"),
		colorTemperature: byId("colorTemperature"), colorTemperatureValue: byId("colorTemperatureValue"),
		whiteBalanceControl: byId("whiteBalanceControl"), whiteBalance: byId("whiteBalance"),
		whiteBalanceValue: byId("whiteBalanceValue"), whiteChannelControl: byId("whiteChannelControl"),
		whiteChannel: byId("whiteChannel"), whiteChannelValue: byId("whiteChannelValue"), effect: byId("effect"),
		palette: byId("palette"), speedControl: byId("speedControl"), speedLabel: byId("speedLabel"),
		speed: byId("speed"), speedValue: byId("speedValue"), intensityControl: byId("intensityControl"),
		intensityLabel: byId("intensityLabel"), intensity: byId("intensity"),
		intensityValue: byId("intensityValue"), custom1Control: byId("custom1Control"),
		custom1Label: byId("custom1Label"), custom1: byId("custom1"), custom1Value: byId("custom1Value"),
		custom2Control: byId("custom2Control"), custom2Label: byId("custom2Label"),
		custom2: byId("custom2"), custom2Value: byId("custom2Value"),
		custom3Control: byId("custom3Control"), custom3Label: byId("custom3Label"),
		custom3: byId("custom3"), custom3Value: byId("custom3Value"),
		effectCatalogStatus: byId("effectCatalogStatus"), effectOptions: byId("effectOptions"), option1Control: byId("option1Control"),
		option1Label: byId("option1Label"), option1: byId("option1"),
		option2Control: byId("option2Control"), option2Label: byId("option2Label"),
		option2: byId("option2"), option3Control: byId("option3Control"),
		option3Label: byId("option3Label"), option3: byId("option3"), segments: byId("segments"),
		selectAllSegments: byId("selectAllSegments"), targetSummary: byId("targetSummary"),
		addSegment: byId("addSegment"), segmentAvailability: byId("segmentAvailability"),
		segmentEditorHome: byId("segmentEditorHome"), segmentEditor: byId("segmentEditor"),
		segmentEditorTitle: byId("segmentEditorTitle"), segmentImmediate: byId("segmentImmediate"),
		segmentPower: byId("segmentPower"), segmentReverse: byId("segmentReverse"),
		segmentMirror: byId("segmentMirror"), segmentBrightness: byId("segmentBrightness"),
		segmentBrightnessValue: byId("segmentBrightnessValue"), segmentName: byId("segmentName"),
		segmentBatchDrafts: byId("segmentBatchDrafts"),
		segmentStart: byId("segmentStart"), segmentEnd: byId("segmentEnd"),
		segmentGrouping: byId("segmentGrouping"), segmentSpacing: byId("segmentSpacing"),
		segmentOffset: byId("segmentOffset"), segmentLength: byId("segmentLength"),
		segmentEditorStatus: byId("segmentEditorStatus"), saveSegment: byId("saveSegment"),
		deleteSegment: byId("deleteSegment"), cancelSegment: byId("cancelSegment"),
		resetSegments: byId("resetSegments"), presets: byId("presets"), addPreset: byId("addPreset"),
		presetEditorHome: byId("presetEditorHome"), presetEditor: byId("presetEditor"),
		presetEditorTitle: byId("presetEditorTitle"), presetName: byId("presetName"),
		presetId: byId("presetId"), presetBrightness: byId("presetBrightness"),
		presetBounds: byId("presetBounds"), presetSelectedOnly: byId("presetSelectedOnly"),
		presetStartup: byId("presetStartup"), presetSelectionSummary: byId("presetSelectionSummary"),
		presetStatus: byId("presetStatus"), presetEditorStatus: byId("presetEditorStatus"), savePreset: byId("savePreset"),
		deletePreset: byId("deletePreset"), cancelPreset: byId("cancelPreset"),
		refresh: byId("refresh"), settingsLink: byId("settingsLink"), toast: byId("toast"),
		swatches: byId("swatches"), colorCard: document.querySelector(".color-card")
		};
	const colorSlotButtons = Array.from(elements.colorSlots.querySelectorAll("button[data-color-slot]"));
	const effectMutationControls = [elements.effect, elements.palette, elements.speed, elements.intensity,
		elements.custom1, elements.custom2, elements.custom3, elements.option1, elements.option2, elements.option3];
	const pickerTouchDwellMilliseconds = 100;
	const pickerTouchSlopPixels = 10;

	let currentState = {};
	let currentInfo = {};
	let effects = [];
	let effectCatalog = [];
	let palettes = [];
	let effectCatalogSignature = "";
	let effectCatalogLength = 0;
	let effectMetadata = null;
	let effectMetadataRequest = null;
	let effectMetadataRequestSignature = "";
	let presetData = {};
	let stateLoaded = false;
	let presetsLoaded = false;
	let targetSegmentIds = new Set();
	let targetsInitialized = false;
	let segmentMarkupSignature = null;
	let presetMarkupSignature = null;
	let picker;
	let pickerInputActive = false;
	let pickerStartedBlack = false;
	let pendingPickerHex = "#FFB547";
	let activeColorSlot = 0;
	let pendingColorInteraction = null;
	let pickerTouchGesture = null;
	let suppressPickerMouseUntil = 0;
	let hexEnterCommitted = false;
	let socket;
	let toastTimer;
	let resizeTimer;
	let pendingMutations = 0;
	let effectChangePending = false;
	let mutationVersion = 0;
	let stateGeneration = 0;
	let targetSelectionVersion = 0;
	let confirmedTargetSelectionVersion = 0;
	let mutationQueue = Promise.resolve();
	let segmentEditorId = null;
	let segmentEditorMode = null;
	let segmentEditorDirty = false;
	let segmentEditorConflict = false;
	let segmentEditorSourceSignature = "";
	let segmentEditorLayoutSignature = "";
	let segmentEditorConstraintSignature = "";
	let segmentEditorCreatePlan = null;
	let segmentEditorBatchDrafts = [];
	let segmentEditorBatchIndex = -1;
	let segmentEditorDraftValidation = null;
	let segmentEditorReturnFocus = null;
	let segmentSubmitting = false;
	let segmentBrightnessInputActive = false;
	let segmentDeleteArmed = false;
	let segmentResetArmed = false;
	let segmentResetSubmitting = false;
	let segmentResetTimer;
	let segmentResetSourceSignature = "";
	let structuralMutationUncertain = false;
	const segmentPowerPendingIds = new Set();
	let presetEditorSourceId = null;
	let presetEditorSourceSignature = "";
	let presetEditorReturnFocus = null;
	let presetEditorDirty = false;
	let presetEditorConflict = false;
	let presetOverwriteArmed = false;
	let presetDeleteArmed = false;
	let presetWritePending = false;
	let presetApplyPending = false;
	let presetSubmissionBlocked = false;
	let presetMutationUncertain = false;
	let startupPresetUncertainId = null;
	let startupConfigurationInvalid = false;
	let presetOperationVersion = 0;
	let connectionAnnouncementState = "connecting";
	let renameSubmitting = false;
	let renameMutationUncertain = false;
	let renameExpectedName = "";
	let renameExpectedSimplifiedUI = null;
	let renameSourceName = "";
	let renameSourceRawName = null;
	let renameConflict = false;
	let renameOperationVersion = 0;

	const percent = value => `${Math.round((Number(value) || 0) * 100 / 255)}%`;
	const clampChannel = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
	const segmentId = model.segmentId;
	const rgbObject = color => Array.isArray(color)
		? { r: clampChannel(color[0]), g: clampChannel(color[1]), b: clampChannel(color[2]) }
		: { r: clampChannel(color?.r), g: clampChannel(color?.g), b: clampChannel(color?.b) };
	const rgbToHex = color => {
		const rgb = rgbObject(color);
		return `#${[rgb.r, rgb.g, rgb.b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
	};
	const normalizeHex = value => {
		const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
		return match ? `#${match[1].toUpperCase()}` : "";
	};
	const hexToRgb = value => {
		const hex = normalizeHex(value);
		return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
	};

	function controllerMutationLocked() {
		return !stateLoaded || presetWritePending || presetApplyPending || presetMutationUncertain;
	}

	function segmentStructureBusy() {
		return segmentSubmitting || segmentResetSubmitting;
	}

	function segmentStructuralLocked() {
		return controllerMutationLocked() || structuralMutationUncertain || segmentStructureBusy() || pendingMutations > 0;
	}

	function segmentMutationLocked() {
		return controllerMutationLocked() || structuralMutationUncertain || segmentStructureBusy()
			|| batchSegmentCreationIsOpen();
	}

	function presetCaptureLocked() {
		return controllerMutationLocked() || structuralMutationUncertain || segmentStructureBusy()
			|| (!elements.segmentEditor.hidden && segmentEditorDirty);
	}

	function activeSegments(state = currentState) {
		return model.activeSegments(state);
	}

	function selectedSegmentIds() {
		return activeSegments().map((segment, index) => segmentId(segment, index))
			.filter(id => targetSegmentIds.has(id));
	}

	function referenceSegment() {
		const segments = activeSegments();
		const selected = new Set(selectedSegmentIds());
		const mainId = Number(currentState.mainseg);
		return segments.find((segment, index) => segmentId(segment, index) === mainId && selected.has(mainId))
			|| segments.find((segment, index) => selected.has(segmentId(segment, index)))
			|| segments.find((segment, index) => segmentId(segment, index) === mainId)
			|| segments[0]
			|| {};
	}

	function segmentName(segment, index = 0) {
		const name = typeof segment?.n === "string" ? segment.n.trim() : "";
		return name || `Segment ${segmentId(segment, index) + 1}`;
	}

	function setConnection(kind, label) {
		const state = kind === "online" ? "online"
			: kind === "offline" ? "offline"
			: label === "Reconnecting" ? "reconnecting"
			: "connecting";
		if (state === connectionAnnouncementState) return;
		connectionAnnouncementState = state;
		elements.connection.dataset.state = state;
		elements.connection.textContent = {
			connecting: "Connecting to controller",
			online: "Controller connected",
			reconnecting: "Controller connection interrupted; reconnecting",
			offline: "Controller unavailable"
		}[state];
	}

	function toast(message, isError = false) {
		clearTimeout(toastTimer);
		elements.toast.textContent = message;
		elements.toast.className = `toast show${isError ? " error" : ""}`;
		toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 2600);
	}

	async function requestResponse(path, options = {}, timeoutMilliseconds = 8000) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
		try {
			const response = await fetch(route(path), { cache: "no-store", ...options, signal: controller.signal });
			if (!response.ok) {
				const error = new Error(`${response.status} ${response.statusText}`);
				error.status = response.status;
				throw error;
			}
			return response;
		} catch (error) {
			if (error.name === "AbortError") throw new Error("request timed out");
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	async function requestJSON(path, options = {}, timeoutMilliseconds = 8000) {
		return await (await requestResponse(path, options, timeoutMilliseconds)).json();
	}

	function loadEffectMetadata() {
		const signature = effectCatalogSignature;
		const expectedLength = effectCatalogLength;
		if (!signature || !expectedLength) return Promise.resolve(null);
		if (Array.isArray(effectMetadata)) return Promise.resolve(effectMetadata);
		if (effectMetadataRequest && effectMetadataRequestSignature === signature) return effectMetadataRequest;
		elements.effectCatalogStatus.hidden = false;
		elements.effectCatalogStatus.textContent = "Loading effects…";
		const request = requestJSON("/json/fxdata", {}, 3000).then(values => {
			if (signature !== effectCatalogSignature) return null;
			if (!Array.isArray(values) || values.length !== expectedLength
				|| !values.every(value => typeof value === "string")) throw new Error("Invalid effect metadata");
			effectMetadata = model.normalizeEffectMetadata(values);
			effects = model.orderedEffectEntries(effectCatalog, effectMetadata);
			elements.effectCatalogStatus.hidden = true;
			if (stateLoaded) {
				fillSelect(elements.effect, effects, referenceSegment().fx, effectCatalog[referenceSegment().fx] || "Current effect");
				renderEffectControls(referenceSegment().fx);
				renderColorControls(referenceSegment());
			}
			return effectMetadata;
		}).catch(() => {
			if (signature === effectCatalogSignature) {
				elements.effectCatalogStatus.hidden = false;
				elements.effectCatalogStatus.textContent = "Couldn’t load the effect list. Refresh to try again.";
			}
			return null;
		}).finally(() => {
			if (effectMetadataRequest === request) {
				effectMetadataRequest = null;
				effectMetadataRequestSignature = "";
			}
		});
		effectMetadataRequest = request;
		effectMetadataRequestSignature = signature;
		return request;
	}

	function syncTargetsFromState(state) {
		const segments = activeSegments(state);
		const activeIds = new Set(segments.map((segment, index) => segmentId(segment, index)));
		const hasSelectionData = segments.some(segment => Object.prototype.hasOwnProperty.call(segment, "sel"));
		const nextTargets = new Set();

		if (hasSelectionData) {
			for (const [index, segment] of segments.entries()) {
				if (segment.sel) nextTargets.add(segmentId(segment, index));
			}
		} else if (targetsInitialized) {
			for (const id of targetSegmentIds) {
				if (activeIds.has(id)) nextTargets.add(id);
			}
		}

		if (!nextTargets.size && segments.length && !hasSelectionData) {
			const mainId = Number(state.mainseg);
			const fallback = activeIds.has(mainId) ? mainId : segmentId(segments[0], 0);
			nextTargets.add(fallback);
		}

		targetSegmentIds = nextTargets;
		targetsInitialized = true;
	}

	function applyState(state, synchronizeTargets = confirmedTargetSelectionVersion === targetSelectionVersion) {
		if (!state || typeof state !== "object") return;
		currentState = state;
		stateLoaded = true;
		stateGeneration += 1;
		if (synchronizeTargets) syncTargetsFromState(currentState);
		renderState();
	}

	async function reconcileAfterUnconfirmedChange(originalError, selectionVersion) {
		try {
			const snapshot = await requestJSON("/json/state");
			if (selectionVersion === targetSelectionVersion) confirmedTargetSelectionVersion = selectionVersion;
			applyState(snapshot.state || snapshot);
			setConnection("online", "Connected");
			toast("The change was not confirmed; controller state was refreshed.", true);
			return { refreshed: true, state: snapshot.state || snapshot };
		} catch (_) {
			setConnection("offline", "Unavailable");
			toast(`The change was not confirmed. Refresh before trying again: ${originalError.message}`, true);
			return { refreshed: false, state: null };
		}
	}

	function sendState(update, selectionVersion = null, allowDuringPresetWrite = false, allowDuringPresetApply = false) {
		if (!stateLoaded || presetMutationUncertain || (presetWritePending && !allowDuringPresetWrite)
			|| (presetApplyPending && !allowDuringPresetApply)) {
			return Promise.resolve({ confirmed: false, blocked: true });
		}
		pendingMutations += 1;
		mutationVersion += 1;
		mutationQueue = mutationQueue.then(async () => {
			try {
				const response = await requestJSON("/json/state", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ...update, v: true })
				});
				if (selectionVersion === targetSelectionVersion) confirmedTargetSelectionVersion = selectionVersion;
				applyState(response.state || response);
				setConnection("online", "Connected");
				return { confirmed: true, blocked: false, state: response.state || response };
			} catch (error) {
				const reconciliation = await reconcileAfterUnconfirmedChange(error, selectionVersion);
				return { confirmed: false, blocked: false, error, ...reconciliation };
			} finally {
				pendingMutations -= 1;
				if (pendingMutations === 0) {
					renderSegments();
					renderPresets();
					updateSegmentEditorAvailability();
					updatePresetEditorAvailability();
				}
			}
		});
		return mutationQueue;
	}

	function sendSegmentState(patch, targetIds = selectedSegmentIds()) {
		if (segmentMutationLocked()) {
			if (structuralMutationUncertain) toast("Refresh the controller before sending another segment command.", true);
			return Promise.resolve({ confirmed: false, blocked: true });
		}
		const ids = Array.from(targetIds || [], Number).filter(Number.isFinite);
		if (!ids.length) {
			toast("Select a segment before changing its color or animation.", true);
			return Promise.resolve();
		}
		const segments = ids.map(id => ({ id, ...patch }));
		return sendState({ seg: segments });
	}

	function fillSelect(select, entries, selected, currentName) {
		// An existing hidden effect remains selected without becoming a menu choice.
		const currentId = Number(selected);
		if (currentName && selected != null && Number.isInteger(currentId) && currentId >= 0 && currentId <= 255
			&& !entries.some(entry => entry.id === currentId)) {
			entries = [{ id: currentId, name: `${currentName} (current)`, unavailable: true }, ...entries];
		}
		const signature = entries.map(entry => `${entry.id}\u001e${entry.name}${entry.unavailable ? "\u001d" : ""}`).join("\u001f");
		if (select.dataset.catalogSignature === signature) {
			if (document.activeElement !== select) select.value = String(selected ?? 0);
			return;
		}
		select.replaceChildren(...entries.map(entry => {
			const option = document.createElement("option");
			option.value = String(entry.id);
			option.textContent = entry.name;
			option.disabled = Boolean(entry.unavailable);
			option.hidden = Boolean(entry.unavailable);
			return option;
		}));
		select.dataset.catalogSignature = signature;
		select.value = String(selected ?? 0);
	}

	function renderEffectControls(effectId) {
		const controls = model.effectControls(effectMetadata, effectId);
		const sliders = [
			[elements.speedControl, elements.speedLabel, elements.speed],
			[elements.intensityControl, elements.intensityLabel, elements.intensity],
			[elements.custom1Control, elements.custom1Label, elements.custom1],
			[elements.custom2Control, elements.custom2Label, elements.custom2],
			[elements.custom3Control, elements.custom3Label, elements.custom3]
		];
		const options = [
			[elements.option1Control, elements.option1Label, elements.option1],
			[elements.option2Control, elements.option2Label, elements.option2],
			[elements.option3Control, elements.option3Label, elements.option3]
		];
		const disabled = selectedSegmentIds().length === 0 || segmentMutationLocked() || effectChangePending;
		sliders.forEach(([container, label, input], index) => {
			const definition = controls.sliders[index];
			container.hidden = !definition.visible;
			label.textContent = definition.label;
			input.disabled = disabled || !definition.visible;
		});
		options.forEach(([container, label, input], index) => {
			const definition = controls.options[index];
			container.hidden = !definition.visible;
			label.textContent = definition.label;
			input.disabled = disabled || !definition.visible;
		});
		elements.effectOptions.hidden = !controls.options.some(control => control.visible);
	}

	function colorSlotDisplayHex(color) {
		const rgb = rgbObject(color);
		const white = clampChannel(Array.isArray(color) ? color[3] : color?.w);
		return rgb.r || rgb.g || rgb.b || !white ? rgbToHex(rgb) : rgbToHex([white, white, white]);
	}

	function renderColorSlots(segment) {
		const definitions = model.colorSlots(effectMetadata, segment?.fx, segment?.pal);
		const visible = definitions.filter(definition => definition.visible);
		if (!pickerInputActive && !visible.some(definition => definition.index === activeColorSlot)) {
			activeColorSlot = visible[0]?.index ?? 0;
		}
		elements.colorSlots.hidden = visible.length === 0;
		for (const button of colorSlotButtons) {
			const index = Number(button.dataset.colorSlot);
			const definition = definitions[index] || { index, label: `Color ${index + 1}`, visible: false };
			const stateHex = colorSlotDisplayHex(segment?.col?.[index]);
			const hex = pickerInputActive && index === activeColorSlot ? pendingPickerHex : stateHex;
			button.hidden = !definition.visible;
			button.disabled = !definition.visible || selectedSegmentIds().length === 0 || segmentMutationLocked();
			button.classList.toggle("active", definition.visible && index === activeColorSlot);
			button.setAttribute("aria-pressed", String(definition.visible && index === activeColorSlot));
			button.setAttribute("aria-label", `Edit ${definition.label} color, currently ${hex}`);
			button.querySelector(".color-slot-swatch").style.background = hex;
			button.querySelector("span:last-child").textContent = definition.label;
		}
		return definitions;
	}

	function selectColorSlot(index) {
		if (pickerInputActive) return;
		const segment = referenceSegment();
		const definition = model.colorSlots(effectMetadata, segment?.fx, segment?.pal)
			.find(slot => slot.index === Number(index));
		if (!definition?.visible) return;
		activeColorSlot = definition.index;
		renderColorControls(segment);
	}

	function renderColorControls(segment) {
		const controls = model.colorControls(activeSegments(), selectedSegmentIds());
		const definitions = renderColorSlots(segment);
		elements.colorPicker.hidden = !controls.rgb;
		elements.colorHexControl.hidden = !controls.rgb;
		elements.colorValueControl.hidden = !controls.value;
		elements.colorTemperatureControl.hidden = !controls.kelvin;
		elements.whiteBalanceControl.hidden = !controls.whiteBalance;
		elements.whiteChannelControl.hidden = !controls.white;
		elements.swatches.hidden = !controls.rgb;
		const activeLabel = definitions.find(definition => definition.index === activeColorSlot)?.label || `Color ${activeColorSlot + 1}`;
		for (const swatch of elements.swatches.querySelectorAll("button[data-color]")) {
			const colorName = swatch.dataset.colorName || swatch.getAttribute("aria-label") || "color";
			swatch.dataset.colorName = colorName;
			swatch.setAttribute("aria-label", `Set ${activeLabel} to ${colorName}`);
		}

		const color = segment?.col?.[activeColorSlot];
		const rgb = rgbObject(color);
		if (!pickerInputActive) {
			syncPickerColor(rgbToHex(rgb));
			const kelvin = model.rgbToKelvin(rgb);
			syncControlValue(elements.colorTemperature, kelvin);
			elements.colorTemperatureValue.value = `${kelvin} K`;
			const white = clampChannel(Array.isArray(color) ? color[3] : color?.w);
			syncControlValue(elements.whiteChannel, white);
			elements.whiteChannelValue.value = String(white);
			const balance = clampChannel(segment?.cct ?? 127);
			syncControlValue(elements.whiteBalance, balance);
			elements.whiteBalanceValue.value = String(balance);
		}
		return controls;
	}

	function restoreEditorHome(editor, home) {
		if (editor.parentElement !== home.parentElement || editor.previousElementSibling !== home) {
			home.insertAdjacentElement("afterend", editor);
		}
	}

	function mountSegmentEditor() {
		if (elements.segmentEditor.hidden || segmentEditorMode !== "edit") {
			restoreEditorHome(elements.segmentEditor, elements.segmentEditorHome);
			return;
		}
		const toggle = elements.segments.querySelector(`button[data-expand-segment-id="${segmentEditorId}"]`);
		const item = toggle?.closest(".segment-item");
		if (item) {
			if (elements.segmentEditor.parentElement !== item) item.append(elements.segmentEditor);
		} else restoreEditorHome(elements.segmentEditor, elements.segmentEditorHome);
	}

	function mountPresetEditor() {
		if (elements.presetEditor.hidden || presetEditorSourceId == null) {
			restoreEditorHome(elements.presetEditor, elements.presetEditorHome);
			return;
		}
		const toggle = elements.presets.querySelector(`button[data-expand-preset-id="${presetEditorSourceId}"]`);
		const item = toggle?.closest(".preset-item");
		if (item) {
			if (elements.presetEditor.parentElement !== item) item.append(elements.presetEditor);
		} else restoreEditorHome(elements.presetEditor, elements.presetEditorHome);
	}

	function focusFirstAvailable(controls) {
		const control = controls.find(candidate => candidate?.isConnected && !candidate.disabled && candidate.getClientRects().length);
		control?.focus({ preventScroll: true });
	}

	function captureEditorFocus(editor) {
		const control = document.activeElement;
		if (!control || !editor.contains(control)) return null;
		return {
			control,
			selectionStart: typeof control.selectionStart === "number" ? control.selectionStart : null,
			selectionEnd: typeof control.selectionEnd === "number" ? control.selectionEnd : null
		};
	}

	function restoreEditorFocus(snapshot) {
		const control = snapshot?.control;
		if (!control?.isConnected || control.disabled || !control.getClientRects().length) return;
		control.focus({ preventScroll: true });
		if (snapshot.selectionStart != null && typeof control.setSelectionRange === "function") {
			control.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
		}
	}

	function renderPresets() {
		const entries = Object.entries(presetData)
			.filter(([id, preset]) => Number(id) > 0 && preset && typeof preset === "object")
			.sort(([left], [right]) => Number(left) - Number(right));
		const bootId = Number(currentInfo.leds?.bootps || 0);
		const signature = `${bootId}\u001e${entries.map(([id, preset]) => `${id}:${preset.n || ""}:${Boolean(preset.playlist)}`).join("\u001f")}`;

		const editorFocus = signature !== presetMarkupSignature ? captureEditorFocus(elements.presetEditor) : null;
		if (signature !== presetMarkupSignature) {
			restoreEditorHome(elements.presetEditor, elements.presetEditorHome);
			presetMarkupSignature = signature;
			if (!entries.length) {
				const empty = document.createElement("p");
				empty.className = "empty";
				empty.textContent = "No presets saved yet.";
				elements.presets.replaceChildren(empty);
			} else {
				elements.presets.replaceChildren(...entries.map(([id, preset]) => {
					const item = document.createElement("div");
					item.className = "preset-item";
					const button = document.createElement("button");
					button.type = "button";
					button.className = "preset-button";
					button.dataset.presetId = id;
					const name = document.createElement("strong");
					name.textContent = preset.n || `Preset ${id}`;
					const details = document.createElement("small");
					const badges = [`Preset ${id}`];
					if (Number(id) === bootId) badges.push("Startup");
					if (preset.playlist) badges.push("Playlist");
					details.textContent = badges.join(" • ");
					button.append(name, details);
					button.setAttribute("aria-pressed", "false");
					button.addEventListener("click", () => applySavedPreset(Number(id)));
					const toggle = document.createElement("button");
					toggle.type = "button";
					toggle.className = "accordion-toggle preset-expand";
					toggle.dataset.expandPresetId = id;
					toggle.dataset.itemName = name.textContent;
					toggle.setAttribute("aria-label", `Show editable options for ${name.textContent}`);
					toggle.setAttribute("aria-controls", "presetEditor");
					toggle.setAttribute("aria-expanded", "false");
					const caret = document.createElement("span");
					caret.className = "accordion-caret";
					caret.setAttribute("aria-hidden", "true");
					toggle.append(caret);
					toggle.addEventListener("click", () => togglePresetEditor(Number(id), toggle));
					item.append(button, toggle);
					return item;
				}));
			}
		}

		for (const button of elements.presets.querySelectorAll("button[data-preset-id]")) {
			const id = Number(button.dataset.presetId);
			const active = Number(currentState.ps) === id || Number(currentState.pl) === id;
			button.classList.toggle("active", active);
			button.setAttribute("aria-pressed", String(active));
		}
		for (const control of elements.presets.querySelectorAll("button.preset-button")) {
			control.disabled = segmentMutationLocked() || !presetsLoaded || !elements.segmentEditor.hidden || !elements.presetEditor.hidden;
		}
		for (const toggle of elements.presets.querySelectorAll("button[data-expand-preset-id]")) {
			const id = Number(toggle.dataset.expandPresetId);
			const expanded = !elements.presetEditor.hidden && presetEditorSourceId === id;
			toggle.setAttribute("aria-expanded", String(expanded));
			toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} editable options for ${toggle.dataset.itemName}`);
			toggle.closest(".preset-item")?.classList.toggle("expanded", expanded);
			toggle.disabled = segmentMutationLocked() || !presetsLoaded || !elements.segmentEditor.hidden
				|| (!elements.presetEditor.hidden && !expanded);
		}
		elements.addPreset.setAttribute("aria-expanded", String(!elements.presetEditor.hidden && presetEditorSourceId == null));
		elements.addPreset.disabled = presetCaptureLocked() || !presetsLoaded || !elements.presetEditor.hidden
			|| !elements.segmentEditor.hidden || !activeSegments().length || model.lowestUnusedPresetId(presetData) == null;
		elements.refresh.disabled = presetWritePending || presetApplyPending;
		reconcilePresetEditor();
		mountPresetEditor();
		restoreEditorFocus(editorFocus);
	}

	function segmentRange(segment) {
		if (segment.start == null || segment.stop == null) return `Target ID ${segment.id}`;
		return `LEDs ${Number(segment.start) + 1}–${Number(segment.stop)}`;
	}

	function resetSegmentResetConfirmation(render = true) {
		clearTimeout(segmentResetTimer);
		segmentResetTimer = null;
		segmentResetArmed = false;
		segmentResetSourceSignature = "";
		elements.resetSegments.textContent = "Reset layout";
		if (render) renderSegments();
	}

	function renderSegments() {
		const segments = activeSegments();
		const layoutSignature = segments.map((segment, index) => model.segmentGeometrySignature(segment, index)).join("\u001e");
		if (segmentResetArmed && !segmentResetSubmitting && layoutSignature !== segmentResetSourceSignature) {
			resetSegmentResetConfirmation(false);
		}
		const signature = segments.map((segment, index) => [
			segmentId(segment, index), segmentName(segment, index), segment.start, segment.stop
		].join(":" )).join("\u001f");

		const editorFocus = signature !== segmentMarkupSignature ? captureEditorFocus(elements.segmentEditor) : null;
		if (signature !== segmentMarkupSignature) {
			restoreEditorHome(elements.segmentEditor, elements.segmentEditorHome);
			segmentMarkupSignature = signature;
			if (!segments.length) {
				const empty = document.createElement("p");
				empty.className = "empty";
				empty.textContent = "No active segments are configured.";
				elements.segments.replaceChildren(empty);
			} else {
				elements.segments.replaceChildren(...segments.map((segment, index) => {
					const id = segmentId(segment, index);
					const item = document.createElement("div");
					item.className = "segment-item";
					const power = document.createElement("button");
					power.type = "button";
					power.className = "segment-power-toggle";
					power.dataset.segmentPowerId = String(id);
					const powerIcon = document.createElement("span");
					powerIcon.className = "segment-power-icon";
					powerIcon.setAttribute("aria-hidden", "true");
					power.append(powerIcon);
					power.addEventListener("click", () => toggleSegmentPower(id));
					const label = document.createElement("label");
					label.className = "segment-target";
					const input = document.createElement("input");
					input.type = "checkbox";
					input.dataset.segmentId = String(id);
					input.setAttribute("aria-describedby", "targetSummary");
					input.addEventListener("change", () => toggleSegmentTarget(id, input.checked));
					const check = document.createElement("span");
					check.className = "segment-check";
					check.setAttribute("aria-hidden", "true");
					const copy = document.createElement("span");
					copy.className = "segment-copy";
					const name = document.createElement("strong");
					name.textContent = segmentName(segment, index);
					const range = document.createElement("small");
					range.textContent = segmentRange(segment);
					copy.append(name, range);
					label.append(input, check, copy);
					const toggle = document.createElement("button");
					toggle.type = "button";
					toggle.className = "accordion-toggle segment-expand";
					toggle.dataset.expandSegmentId = String(id);
					toggle.dataset.itemName = name.textContent;
					toggle.setAttribute("aria-label", `Show editable options for ${name.textContent}`);
					toggle.setAttribute("aria-controls", "segmentEditor");
					toggle.setAttribute("aria-expanded", "false");
					const caret = document.createElement("span");
					caret.className = "accordion-caret";
					caret.setAttribute("aria-hidden", "true");
					toggle.append(caret);
					toggle.addEventListener("click", () => toggleSegmentEditor(id, toggle));
					item.append(power, label, toggle);
					return item;
				}));
			}
		}

		const selectedIds = selectedSegmentIds();
		const colorControls = renderColorControls(referenceSegment());
		const matrix = Boolean(currentInfo.leds?.matrix);
		for (const button of elements.segments.querySelectorAll("button[data-segment-power-id]")) {
			const id = Number(button.dataset.segmentPowerId);
			const segment = findSegment(id);
			const index = activeSegments().indexOf(segment);
			const name = segment ? segmentName(segment, index) : `Segment ${id + 1}`;
			const isOn = Boolean(segment) && segment.on !== false;
			button.classList.toggle("on", isOn);
			button.setAttribute("aria-pressed", String(isOn));
			button.setAttribute("aria-label", `${isOn ? "Turn off" : "Turn on"} ${name}`);
			button.disabled = !segment || segmentMutationLocked() || segmentPowerPendingIds.has(id);
		}
		for (const input of elements.segments.querySelectorAll('input[type="checkbox"][data-segment-id]')) {
			const selected = targetSegmentIds.has(Number(input.dataset.segmentId));
			input.checked = selected;
			input.disabled = segmentMutationLocked() || (selected && selectedIds.length === 1);
			input.closest(".segment-target").classList.toggle("selected", selected);
			input.nextElementSibling.textContent = selected ? "✓" : "";
		}
		for (const toggle of elements.segments.querySelectorAll("button[data-expand-segment-id]")) {
			const id = Number(toggle.dataset.expandSegmentId);
			const expanded = !elements.segmentEditor.hidden && segmentEditorMode === "edit" && segmentEditorId === id;
			toggle.setAttribute("aria-expanded", String(expanded));
			toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} editable options for ${toggle.dataset.itemName}`);
			toggle.closest(".segment-item")?.classList.toggle("expanded", expanded);
			toggle.disabled = matrix || segmentStructuralLocked() || !elements.presetEditor.hidden
				|| (!elements.segmentEditor.hidden && !expanded);
			toggle.title = matrix ? "1D segment layout editing is unavailable for matrix configurations." : "";
		}

		const allSelected = segments.length > 0 && selectedIds.length === segments.length;
		elements.selectAllSegments.disabled = segmentMutationLocked() || !segments.length || allSelected;
		elements.selectAllSegments.setAttribute("aria-pressed", String(allSelected));
		if (!segments.length) {
			elements.targetSummary.textContent = "Configure at least one segment in the CastleTek app or controller settings.";
		} else if (!selectedIds.length) {
			elements.targetSummary.textContent = "Select at least one segment to enable color and animation controls.";
		} else {
			const reference = referenceSegment();
			const shown = segmentName(reference, segments.indexOf(reference));
			elements.targetSummary.textContent = selectedIds.length === 1
				? `${shown} receives color and animation changes.`
				: `${selectedIds.length} segments selected; controls show ${shown}.`;
		}

		const batchCreationOpen = batchSegmentCreationIsOpen();
		const disabled = selectedIds.length === 0 || segmentMutationLocked();
		for (const control of document.querySelectorAll("[data-segment-control]")) {
			control.disabled = disabled || control.hidden || Boolean(control.closest("label")?.hidden)
				|| (effectChangePending && effectMutationControls.includes(control));
		}
		elements.power.disabled = controllerMutationLocked() || batchCreationOpen;
		elements.brightness.disabled = controllerMutationLocked() || batchCreationOpen;
		elements.colorHex.disabled = disabled || !colorControls.rgb;
		for (const swatch of elements.swatches.querySelectorAll("button[data-color]")) {
			swatch.disabled = disabled || !colorControls.rgb;
		}
		elements.colorPicker.setAttribute("aria-disabled", String(disabled || !colorControls.rgb));
		elements.colorCard.classList.toggle("controls-disabled", disabled);

		const ledCount = Number(currentInfo.leds?.count);
		const maxSegments = Number(currentInfo.leds?.maxseg);
		const batchStartPlan = model.newSegmentBatchPlan(segments, ledCount, maxSegments, 2);
		const addPlan = batchStartPlan.ok ? batchStartPlan : model.newSegmentPlan(segments, ledCount, maxSegments);
		const nextBatchPlan = batchCreationOpen && !segmentEditorDirty
			? model.newSegmentBatchPlan(segments, ledCount, maxSegments, segmentEditorCreatePlan.targetSegments + 1)
			: null;
		const batchSourceCurrent = !batchCreationOpen || model.buildCreateSegmentBatchMutation(
			segmentEditorCreatePlan.drafts,
			segmentEditorCreatePlan,
			segments,
			ledCount,
			maxSegments
		).ok;
		const playlist = Number(currentState.pl);
		const intrinsicAddUnavailableReason = matrix
			? "Segment layout editing is unavailable for matrix configurations."
			: !Number.isInteger(ledCount) || ledCount < 1
				? "LED count is unavailable; refresh before adding a segment."
				: !Number.isInteger(playlist)
					? "Playlist status is unavailable; refresh before adding a segment."
					: playlist >= 0
						? "Stop the active playlist and refresh before adding a segment."
						: !addPlan.ok ? addPlan.error : "";
		const addUnavailableReason = intrinsicAddUnavailableReason
			|| (batchCreationOpen && segmentEditorDirty ? "Create or cancel the staged layout before adding another segment." : "")
			|| (batchCreationOpen && (segmentEditorConflict || !batchSourceCurrent)
				? "The controller changed; cancel the staged layout and start again." : "")
			|| (batchCreationOpen && nextBatchPlan && !nextBatchPlan.ok ? nextBatchPlan.error : "")
			|| (!elements.segmentEditor.hidden && !batchCreationOpen ? "Update or cancel the open segment draft first." : "")
			|| (!elements.presetEditor.hidden ? "Save or cancel the open preset draft first." : "");
		elements.addSegment.setAttribute("aria-expanded", String(!elements.segmentEditor.hidden && segmentEditorMode === "create"));
		elements.addSegment.disabled = segmentStructuralLocked() || (!elements.segmentEditor.hidden && !batchCreationOpen) || !elements.presetEditor.hidden
			|| matrix || !Number.isInteger(ledCount) || ledCount < 1 || !segmentCreationPlaylistIsClear()
			|| !addPlan.ok || (batchCreationOpen && (segmentEditorDirty || segmentEditorConflict || !batchSourceCurrent || !nextBatchPlan?.ok));
		elements.addSegment.title = addUnavailableReason;
		elements.addSegment.setAttribute("aria-label", addUnavailableReason
			? `${batchCreationOpen ? "Stage another segment" : "Add segment"} unavailable: ${addUnavailableReason}`
			: batchCreationOpen ? "Stage another segment" : "Add segment");
		elements.segmentAvailability.textContent = addUnavailableReason;
		elements.segmentAvailability.hidden = !addUnavailableReason;
		elements.resetSegments.disabled = segmentStructuralLocked() || !elements.segmentEditor.hidden || !elements.presetEditor.hidden || matrix || !segments.length;
		reconcileSegmentEditor();
		mountSegmentEditor();
		restoreEditorFocus(editorFocus);
		updatePresetSelectionSummary();
	}

	function updateCurrentSelection() {
		if (!Array.isArray(currentState.seg)) return;
		currentState = {
			...currentState,
			seg: currentState.seg.map((segment, index) => ({
				...segment,
				sel: targetSegmentIds.has(segmentId(segment, index))
			}))
		};
	}

	function persistTargetSelection() {
		if (segmentMutationLocked()) return;
		const segments = activeSegments();
		const selection = segments.map((segment, index) => ({ id: segmentId(segment, index), sel: targetSegmentIds.has(segmentId(segment, index)) }));
		if (!selection.length || !targetSegmentIds.size) return;
		const update = { seg: selection };
		const mainId = Number(currentState.mainseg);
		if (!targetSegmentIds.has(mainId)) update.mainseg = selectedSegmentIds()[0];
		targetSelectionVersion += 1;
		sendState(update, targetSelectionVersion);
	}

	function toggleSegmentTarget(id, selected) {
		if (segmentMutationLocked()) return;
		const next = new Set(targetSegmentIds);
		if (selected) next.add(id);
		else next.delete(id);
		if (!next.size && activeSegments().length) {
			toast("At least one segment must remain selected.", true);
			renderSegments();
			return;
		}
		targetSegmentIds = next;
		updateCurrentSelection();
		renderSegments();
		persistTargetSelection();
	}

	function selectAllSegments() {
		if (segmentMutationLocked()) return;
		const segments = activeSegments();
		if (!segments.length) return;
		targetSegmentIds = new Set(segments.map((segment, index) => segmentId(segment, index)));
		updateCurrentSelection();
		renderSegments();
		persistTargetSelection();
	}

	function controllerLedCount() {
		const count = Number(currentInfo.leds?.count);
		return Number.isInteger(count) && count > 0 ? count : null;
	}

	function findSegment(id) {
		return activeSegments().find((segment, index) => segmentId(segment, index) === Number(id)) || null;
	}

	function findSegmentInState(state, id) {
		return activeSegments(state).find((segment, index) => segmentId(segment, index) === Number(id)) || null;
	}

	async function setSegmentPower(id, desired) {
		id = Number(id);
		const segment = findSegment(id);
		if (!segment || segmentMutationLocked() || segmentPowerPendingIds.has(id)) return;
		desired = Boolean(desired);
		if ((segment.on !== false) === desired) {
			renderSegments();
			return;
		}
		segmentPowerPendingIds.add(id);
		renderSegments();
		try {
			const outcome = await sendSegmentState({ on: desired }, [id]);
			const verified = !outcome?.blocked && await verifyState(state => findSegmentInState(state, id)?.on === desired);
			if (!verified && !outcome?.blocked) {
				toast("The segment power change could not be verified. Refresh before trying again.", true);
			}
		} finally {
			segmentPowerPendingIds.delete(id);
			renderSegments();
		}
	}

	function toggleSegmentPower(id) {
		const segment = findSegment(id);
		if (!segment) return;
		return setSegmentPower(id, segment.on === false);
	}

	function segmentLayoutSignature(state) {
		return activeSegments(state).map((segment, index) => model.segmentGeometrySignature(segment, index)).join("\u001e");
	}

	function segmentConstraintSignature(info = currentInfo) {
		return [Number(info?.leds?.count), Number(info?.leds?.maxseg), Boolean(info?.leds?.matrix)].join("\u001f");
	}

	function segmentCreationPlaylistIsClear(state = currentState) {
		const playlist = Number(state?.pl);
		return Number.isInteger(playlist) && playlist < 0;
	}

	function setSegmentEditorStatus(message = "", isError = false) {
		elements.segmentEditorStatus.textContent = message;
		elements.segmentEditorStatus.classList.toggle("error", isError);
	}

	function batchSegmentCreationIsOpen() {
		return segmentEditorMode === "create" && segmentEditorCreatePlan?.mode === "batch-split";
	}

	function selectedBatchSegmentDraft() {
		return batchSegmentCreationIsOpen() ? segmentEditorBatchDrafts[segmentEditorBatchIndex] || null : null;
	}

	function currentSegmentDraft() {
		const batchDraft = selectedBatchSegmentDraft();
		return {
			id: batchDraft?.id ?? segmentEditorId,
			name: elements.segmentName.value,
			start: elements.segmentStart.value,
			end: elements.segmentEnd.value,
			grouping: elements.segmentGrouping.value,
			spacing: elements.segmentSpacing.value,
			offset: elements.segmentOffset.value
		};
	}

	function commitCurrentBatchDraft() {
		if (!batchSegmentCreationIsOpen() || !selectedBatchSegmentDraft()) return;
		segmentEditorBatchDrafts[segmentEditorBatchIndex] = currentSegmentDraft();
	}

	function renderSegmentBatchDrafts() {
		const isBatch = batchSegmentCreationIsOpen();
		elements.segmentBatchDrafts.hidden = !isBatch;
		if (!isBatch) {
			elements.segmentBatchDrafts.replaceChildren();
			return;
		}
		const controls = segmentEditorBatchDrafts.map((draft, index) => {
			const button = document.createElement("button");
			button.id = `segmentBatchDraft${draft.id}`;
			button.type = "button";
			button.className = "segment-batch-draft";
			button.setAttribute("aria-pressed", String(index === segmentEditorBatchIndex));
			button.dataset.batchSegmentIndex = String(index);
			const name = document.createElement("strong");
			const draftName = String(draft.name || "").trim();
			name.textContent = `Segment ${draft.id + 1}${draftName ? ` • ${draftName}` : ""}`;
			const range = document.createElement("small");
			range.textContent = `LEDs ${draft.start}–${draft.end}`;
			button.append(name, range);
			button.addEventListener("click", () => selectSegmentBatchDraft(index));
			return button;
		});
		elements.segmentBatchDrafts.replaceChildren(...controls);
	}

	function selectSegmentBatchDraft(index) {
		if (!batchSegmentCreationIsOpen() || segmentSubmitting) return;
		index = Number(index);
		if (!Number.isInteger(index) || index < 0 || index >= segmentEditorBatchDrafts.length) return;
		commitCurrentBatchDraft();
		segmentEditorBatchIndex = index;
		const draft = selectedBatchSegmentDraft();
		setSegmentGeometryFields(draft);
		renderSegmentBatchDrafts();
	}

	function stageAdditionalSegment() {
		if (!batchSegmentCreationIsOpen()) return;
		if (segmentEditorDirty || segmentEditorConflict || segmentStructuralLocked()) {
			toast(segmentEditorDirty
				? "Create or cancel the staged layout before adding another segment."
				: "The staged layout cannot be expanded right now.", true);
			return;
		}
		const currentPlanStillMatches = model.buildCreateSegmentBatchMutation(
			segmentEditorCreatePlan.drafts,
			segmentEditorCreatePlan,
			activeSegments(),
			controllerLedCount(),
			currentInfo.leds?.maxseg
		);
		if (!currentPlanStillMatches.ok
			|| segmentLayoutSignature(currentState) !== segmentEditorLayoutSignature
			|| segmentConstraintSignature() !== segmentEditorConstraintSignature
			|| Number(currentState.mainseg) !== 0
			|| !segmentCreationPlaylistIsClear()) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("The controller changed while you were staging this layout. Cancel and start again.", true);
			updateSegmentEditorAvailability();
			renderSegments();
			return;
		}
		const nextPlan = model.newSegmentBatchPlan(
			activeSegments(),
			controllerLedCount(),
			currentInfo.leds?.maxseg,
			segmentEditorCreatePlan.targetSegments + 1
		);
		if (!nextPlan.ok) {
			toast(nextPlan.error, true);
			renderSegments();
			return;
		}
		segmentEditorCreatePlan = nextPlan;
		segmentEditorBatchDrafts = nextPlan.drafts.map(draft => ({ ...draft }));
		segmentEditorBatchIndex = segmentEditorBatchDrafts.length - 1;
		elements.segmentEditorTitle.textContent = `Create ${nextPlan.targetSegments} segments`;
		elements.saveSegment.textContent = `Create ${nextPlan.targetSegments} segments`;
		setSegmentGeometryFields(selectedBatchSegmentDraft());
		renderSegmentBatchDrafts();
		renderSegments();
		renderPresets();
	}

	function handleAddSegment(trigger) {
		if (elements.segmentEditor.hidden) {
			openSegmentEditor(null, trigger);
			return;
		}
		if (batchSegmentCreationIsOpen()) {
			stageAdditionalSegment();
			return;
		}
		toast("Update or cancel the open segment draft first.", true);
	}

	function validateCurrentSegmentMutation(segments = activeSegments(), ledCount = controllerLedCount(), maximumSegments = currentInfo.leds?.maxseg) {
		if (segmentEditorMode === "create") {
			if (batchSegmentCreationIsOpen()) {
				return model.buildCreateSegmentBatchMutation(
					segmentEditorBatchDrafts, segmentEditorCreatePlan, segments, ledCount, maximumSegments);
			}
			return model.buildCreateSegmentMutation(currentSegmentDraft(), segmentEditorCreatePlan, segments, ledCount, maximumSegments);
		}
		if (segmentEditorMode === "edit") {
			return model.buildEditSegmentMutation(currentSegmentDraft(), segments, ledCount, maximumSegments);
		}
		return { ok: false, error: "Open a segment editor before changing the layout." };
	}

	function updateSegmentLength() {
		if (batchSegmentCreationIsOpen()) commitCurrentBatchDraft();
		const result = model.validateSegmentDraft(currentSegmentDraft(), controllerLedCount());
		if (!result.ok) {
			segmentEditorDraftValidation = result;
			const rangeError = /^(Start|End) LED\b|Start and end LEDs/.test(result.error);
			elements.segmentStart.setAttribute("aria-invalid", String(rangeError));
			elements.segmentEnd.setAttribute("aria-invalid", String(rangeError));
			elements.segmentLength.classList.add("error");
			elements.segmentLength.textContent = result.error;
			if (batchSegmentCreationIsOpen()) renderSegmentBatchDrafts();
			return;
		}
		segmentEditorDraftValidation = validateCurrentSegmentMutation();
		const rangeError = !segmentEditorDraftValidation.ok && Boolean(segmentEditorDraftValidation.rangeError);
		elements.segmentStart.setAttribute("aria-invalid", String(rangeError));
		elements.segmentEnd.setAttribute("aria-invalid", String(rangeError));
		elements.segmentLength.classList.toggle("error", !segmentEditorDraftValidation.ok);
		if (!segmentEditorDraftValidation.ok) {
			elements.segmentLength.textContent = segmentEditorDraftValidation.error;
			if (batchSegmentCreationIsOpen()) renderSegmentBatchDrafts();
			return;
		}
		elements.segmentOffset.min = String(-(result.length - 1));
		elements.segmentOffset.max = String(result.length - 1);
		if (batchSegmentCreationIsOpen()) {
			const count = segmentEditorBatchDrafts.length;
			elements.segmentLength.textContent = `${count} staged segments cover LEDs 1–${controllerLedCount()} in Segment-number order. ${segmentEditorDirty
				? "Choose Create segments to submit the complete layout once."
				: "Tap Add segment now to stage more, then edit any range if needed."}`;
			renderSegmentBatchDrafts();
			return;
		}
		const virtualLength = segmentEditorMode === "edit" && elements.segmentMirror.checked
			? Math.ceil(result.virtualLength / 2)
			: result.virtualLength;
		let summary = virtualLength === result.length
			? `${result.length} physical and virtual LEDs.`
			: `${result.length} physical LEDs • ${virtualLength} virtual pixels.`;
		if (segmentEditorDraftValidation.mode === "split") {
			const sourcePatch = segmentEditorDraftValidation.patches[0];
			const source = findSegment(sourcePatch.id);
			summary += ` ${segmentName(source)} will become LEDs ${sourcePatch.start + 1}–${sourcePatch.stop}.`;
			summary += " Creating the split will leave both pieces unfrozen because a held pixel frame cannot be copied.";
		}
		elements.segmentLength.textContent = summary;
	}

	function setSegmentGeometryFields(draft) {
		elements.segmentName.value = draft.name;
		elements.segmentStart.value = String(draft.start);
		elements.segmentEnd.value = String(draft.end);
		elements.segmentGrouping.value = String(draft.grouping);
		elements.segmentSpacing.value = String(draft.spacing);
		elements.segmentOffset.value = String(draft.offset);
		const count = controllerLedCount();
		elements.segmentStart.min = "1";
		elements.segmentEnd.min = "1";
		if (count) {
			elements.segmentStart.max = String(count);
			elements.segmentEnd.max = String(count);
		}
		updateSegmentLength();
	}

	function syncSegmentImmediateFields(segment) {
		if (!segment) return;
		elements.segmentPower.checked = segment.on !== false;
		elements.segmentReverse.checked = Boolean(segment.rev);
		elements.segmentMirror.checked = Boolean(segment.mi);
		if (!segmentBrightnessInputActive) {
			const brightness = Math.max(1, Math.min(255, Number(segment.bri) || 255));
			elements.segmentBrightness.value = String(brightness);
			elements.segmentBrightnessValue.value = percent(brightness);
		}
		updateSegmentLength();
	}

	function updateSegmentEditorAvailability() {
		if (elements.segmentEditor.hidden) return;
		const segmentPowerBusy = segmentEditorMode === "edit" && segmentPowerPendingIds.has(segmentEditorId);
		const busy = presetWritePending || segmentStructureBusy() || pendingMutations > 0 || segmentPowerBusy;
		const mutationBlocked = busy || presetMutationUncertain || structuralMutationUncertain;
		for (const field of elements.segmentEditor.querySelectorAll("input")) field.disabled = mutationBlocked;
		for (const button of elements.segmentEditor.querySelectorAll("button")) button.disabled = busy;
		elements.segmentImmediate.disabled = mutationBlocked || segmentEditorMode === "create";
		elements.saveSegment.disabled = mutationBlocked || segmentEditorConflict || !segmentEditorDraftValidation?.ok;
		elements.deleteSegment.disabled = mutationBlocked || segmentEditorConflict || segmentEditorMode === "create" || activeSegments().length < 2;
		elements.segmentEditor.setAttribute("aria-busy", String(busy));
	}

	function toggleSegmentEditor(id, trigger) {
		const expanded = !elements.segmentEditor.hidden && segmentEditorMode === "edit" && segmentEditorId === id;
		if (expanded) {
			closeSegmentEditor();
			return;
		}
		openSegmentEditor(id, trigger);
	}

	function openSegmentEditor(id, trigger = null) {
		if (!elements.segmentEditor.hidden) {
			toast("Update or cancel the open segment draft first.", true);
			return;
		}
		if (!elements.presetEditor.hidden) {
			toast("Save or cancel the open preset draft first.", true);
			return;
		}
		if (structuralMutationUncertain || presetMutationUncertain) {
			toast("Refresh the controller before editing the segment layout.", true);
			return;
		}
		if (!segmentCreationPlaylistIsClear() && id == null) {
			toast(Number(currentState.pl) >= 0
				? "Stop the active playlist and refresh before adding a segment."
				: "Refresh the controller before adding a segment.", true);
			return;
		}
		if (segmentStructuralLocked() || currentInfo.leds?.matrix) return;
		const segment = id == null ? null : findSegment(id);
		let draft;
		if (segment) {
			const index = activeSegments().indexOf(segment);
			draft = model.segmentDraft(segment, index);
			segmentEditorMode = "edit";
			segmentEditorCreatePlan = null;
			segmentEditorBatchDrafts = [];
			segmentEditorBatchIndex = -1;
			segmentEditorSourceSignature = model.segmentGeometrySignature(segment, index);
		} else {
			const batchPlan = model.newSegmentBatchPlan(activeSegments(), controllerLedCount(), currentInfo.leds?.maxseg, 2);
			segmentEditorCreatePlan = batchPlan.ok && Number(currentState.mainseg) === 0
				? batchPlan
				: model.newSegmentPlan(activeSegments(), controllerLedCount(), currentInfo.leds?.maxseg);
			if (!segmentEditorCreatePlan.ok) {
				toast(segmentEditorCreatePlan.error, true);
				segmentEditorCreatePlan = null;
				return;
			}
			segmentEditorMode = "create";
			if (segmentEditorCreatePlan.mode === "batch-split") {
				segmentEditorBatchDrafts = segmentEditorCreatePlan.drafts.map(entry => ({ ...entry }));
				segmentEditorBatchIndex = segmentEditorBatchDrafts.length - 1;
				draft = selectedBatchSegmentDraft();
			} else {
				segmentEditorBatchDrafts = [];
				segmentEditorBatchIndex = -1;
				draft = segmentEditorCreatePlan.draft;
			}
			segmentEditorSourceSignature = "";
		}
		segmentEditorId = batchSegmentCreationIsOpen() ? null : draft.id;
		segmentEditorLayoutSignature = segmentLayoutSignature(currentState);
		segmentEditorConstraintSignature = segmentConstraintSignature();
		segmentEditorDirty = false;
		segmentEditorConflict = false;
		segmentBrightnessInputActive = false;
		segmentDeleteArmed = false;
		segmentEditorReturnFocus = trigger || document.activeElement;
		setSegmentGeometryFields(draft);
		renderSegmentBatchDrafts();
		elements.segmentEditorTitle.textContent = segment
			? `Edit ${segmentName(segment)}`
			: batchSegmentCreationIsOpen()
				? `Create ${segmentEditorCreatePlan.targetSegments} segments`
				: `Create segment ${draft.id + 1}`;
		elements.segmentImmediate.hidden = !segment;
		elements.saveSegment.textContent = segment
			? "Update segment"
			: batchSegmentCreationIsOpen()
				? `Create ${segmentEditorCreatePlan.targetSegments} segments`
				: "Create segment";
		elements.deleteSegment.hidden = !segment;
		elements.deleteSegment.textContent = "Delete segment";
		if (segment) syncSegmentImmediateFields(segment);
		setSegmentEditorStatus(segment
			? "Layout changes remain drafts until you update this segment."
			: batchSegmentCreationIsOpen()
				? "Tap Add segment until the desired count is staged, then review each row. The complete layout is sent only when you choose Create segments."
			: segmentEditorCreatePlan.mode === "split"
				? "Keep the new range against either the first or last edge of the source segment. Nothing changes until you choose Create segment."
				: "The new segment is not created until you choose Create segment. Segment ranges cannot overlap.");
		elements.segmentEditor.hidden = false;
		updateSegmentEditorAvailability();
		renderSegments();
		renderPresets();
	}

	function closeSegmentEditor(returnFocus = true) {
		const closingId = segmentEditorId;
		const previousFocus = segmentEditorReturnFocus;
		elements.segmentEditor.hidden = true;
		restoreEditorHome(elements.segmentEditor, elements.segmentEditorHome);
		segmentEditorId = null;
		segmentEditorMode = null;
		segmentEditorDirty = false;
		segmentEditorConflict = false;
		segmentEditorSourceSignature = "";
		segmentEditorLayoutSignature = "";
		segmentEditorConstraintSignature = "";
		segmentEditorCreatePlan = null;
		segmentEditorBatchDrafts = [];
		segmentEditorBatchIndex = -1;
		segmentEditorDraftValidation = null;
		segmentBrightnessInputActive = false;
		segmentSubmitting = false;
		segmentDeleteArmed = false;
		renderSegmentBatchDrafts();
		setSegmentEditorStatus();
		elements.segmentLength.classList.remove("error");
		elements.segmentStart.removeAttribute("aria-invalid");
		elements.segmentEnd.removeAttribute("aria-invalid");
		segmentEditorReturnFocus = null;
		renderSegments();
		renderPresets();
		if (returnFocus) requestAnimationFrame(() => {
			focusFirstAvailable([
				previousFocus,
				document.querySelector(`button[data-expand-segment-id="${closingId}"]`),
				elements.addSegment,
				elements.refresh,
				elements.resetSegments
			]);
		});
	}

	function markSegmentDraftDirty(event) {
		if (segmentEditorMode === "create" && (segmentEditorCreatePlan?.mode === "split"
			|| segmentEditorCreatePlan?.mode === "batch-split")
			&& (event?.target === elements.segmentStart || event?.target === elements.segmentEnd)) {
			const start = Number(elements.segmentStart.value);
			const end = Number(elements.segmentEnd.value);
			const offset = Number(elements.segmentOffset.value);
			if (Number.isInteger(start) && Number.isInteger(end) && end >= start && Number.isInteger(offset)) {
				const maximumOffset = end - start;
				elements.segmentOffset.value = String(Math.max(-maximumOffset, Math.min(maximumOffset, offset)));
			}
		}
		const wasDirty = segmentEditorDirty;
		segmentEditorDirty = true;
		if (batchSegmentCreationIsOpen()) commitCurrentBatchDraft();
		segmentDeleteArmed = false;
		elements.deleteSegment.textContent = "Delete segment";
		updateSegmentLength();
		reconcileSegmentEditor();
		if (!wasDirty && batchSegmentCreationIsOpen()) renderSegments();
	}

	function reconcileSegmentEditor() {
		if (elements.segmentEditor.hidden) return;
		if (segmentEditorMode === "create") {
			const batchCreation = batchSegmentCreationIsOpen();
			const splitSource = !batchCreation && segmentEditorCreatePlan?.mode === "split"
				? findSegment(segmentEditorCreatePlan.source?.id)
				: null;
			const splitSourceChanged = !batchCreation && segmentEditorCreatePlan?.mode === "split"
				&& (!splitSource || Boolean(splitSource.frz) !== Boolean(segmentEditorCreatePlan.source?.frz));
			const batchSourceChanged = batchCreation && !model.buildCreateSegmentBatchMutation(
				segmentEditorCreatePlan.drafts,
				segmentEditorCreatePlan,
				activeSegments(),
				controllerLedCount(),
				currentInfo.leds?.maxseg
			).ok;
			if (!segmentCreationPlaylistIsClear() || (batchCreation && Number(currentState.mainseg) !== 0)
				|| (!batchCreation && findSegment(segmentEditorId))
				|| segmentLayoutSignature(currentState) !== segmentEditorLayoutSignature
				|| segmentConstraintSignature() !== segmentEditorConstraintSignature || splitSourceChanged || batchSourceChanged) {
				segmentEditorConflict = true;
				setSegmentEditorStatus(batchCreation
					? "The controller changed while you were staging this layout. Cancel and start again."
					: "The controller layout changed while you were preparing this segment. Cancel and reopen before submitting.", true);
			}
			updateSegmentEditorAvailability();
			return;
		}
		if (segmentEditorId == null) return;
		const segment = findSegment(segmentEditorId);
		if (!segment) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("This segment no longer exists. Cancel and reopen the editor.", true);
			updateSegmentEditorAvailability();
			return;
		}
		const index = activeSegments().indexOf(segment);
		const signature = model.segmentGeometrySignature(segment, index);
		syncSegmentImmediateFields(segment);
		if (!segmentEditorDirty && !segmentSubmitting && signature !== segmentEditorSourceSignature) {
			segmentDeleteArmed = false;
			elements.deleteSegment.textContent = "Delete segment";
			setSegmentGeometryFields(model.segmentDraft(segment, index));
			segmentEditorSourceSignature = signature;
			elements.segmentEditorTitle.textContent = `Edit ${segmentName(segment, index)}`;
			setSegmentEditorStatus("The controller layout changed; the editor now shows its latest values. Layout changes remain drafts until you update this segment.");
		} else if (segmentEditorDirty && !segmentSubmitting && signature !== segmentEditorSourceSignature) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("The controller layout changed while you were editing. Cancel and reopen before submitting.", true);
		}
		updateSegmentEditorAvailability();
	}

	async function verifyState(predicate) {
		if (predicate(currentState)) return true;
		try {
			const snapshot = await requestJSON("/json/state");
			applyState(snapshot.state || snapshot);
			return predicate(currentState);
		} catch (_) {
			return false;
		}
	}

	async function readStructuralStateForWrite() {
		const response = await requestJSON(`/json/state?preflight=${mutationVersion}-${Date.now()}`, {}, 1500);
		const state = response.state || response;
		if (!state || typeof state !== "object" || !Array.isArray(state.seg)) {
			throw new Error("controller returned an invalid segment state");
		}
		applyState(state, true);
		return state;
	}

	async function readSegmentSnapshotForWrite() {
		const response = await requestJSON(`/json?segment-preflight=${mutationVersion}-${Date.now()}`, {}, 5000);
		const state = response?.state;
		const info = response?.info;
		if (!state || typeof state !== "object" || !Array.isArray(state.seg)) {
			throw new Error("controller returned an invalid segment state");
		}
		if (!info || !Number.isInteger(Number(info.leds?.count)) || !Number.isInteger(Number(info.leds?.maxseg))) {
			throw new Error("controller returned invalid segment limits");
		}
		currentInfo = info;
		renderInfo();
		applyState(state, true);
		return { state, info };
	}

	function verifySegmentMutation(mutation, ledCount, maximumSegments) {
		return verifyState(state => model.segmentMutationMatchesState(state, mutation, ledCount, maximumSegments)
			&& (mutation?.mode !== "batch-split" || Number(state.mainseg) === 0));
	}

	async function submitSegmentLayout(event) {
		event.preventDefault();
		const batchCreation = batchSegmentCreationIsOpen();
		if (batchCreation) commitCurrentBatchDraft();
		if (segmentEditorConflict || segmentStructuralLocked()) {
			if (pendingMutations > 0) setSegmentEditorStatus("Wait for the current controller change to finish before updating the layout.", true);
			return;
		}
		if (segmentEditorMode === "create" && !segmentCreationPlaylistIsClear()) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("Stop the active playlist, refresh, then reopen the segment editor. No request was sent.", true);
			updateSegmentEditorAvailability();
			return;
		}
		const submittedDraft = currentSegmentDraft();
		const preview = validateCurrentSegmentMutation();
		segmentEditorDraftValidation = preview;
		if (!preview.ok) {
			setSegmentEditorStatus(preview.error, true);
			if (preview.rangeError) requestAnimationFrame(() => elements.segmentStart.focus());
			updateSegmentEditorAvailability();
			return;
		}
		const existing = batchCreation ? null : findSegment(segmentEditorId);
		if (segmentEditorMode === "create" && !batchCreation && existing) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("That segment slot is now in use. Cancel and reopen before submitting.", true);
			updateSegmentEditorAvailability();
			return;
		}
		if (segmentEditorMode === "edit" && !existing) {
			segmentEditorConflict = true;
			setSegmentEditorStatus("This segment no longer exists. Cancel and reopen the editor.", true);
			updateSegmentEditorAvailability();
			return;
		}
		segmentSubmitting = true;
		setSegmentEditorStatus("Checking the latest controller layout before submitting…");
		updateSegmentEditorAvailability();
		renderPresets();
		let freshSnapshot;
		try {
			freshSnapshot = await readSegmentSnapshotForWrite();
		} catch (error) {
			segmentSubmitting = false;
			setSegmentEditorStatus(`Could not verify the latest layout, so no segment request was sent: ${error.message}`, true);
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		const freshState = freshSnapshot.state;
		const freshInfo = freshSnapshot.info;
		const freshCount = Number(freshInfo.leds.count);
		const freshMaximumSegments = Number(freshInfo.leds.maxseg);
		const freshSegment = batchCreation ? null : findSegmentInState(freshState, segmentEditorId);
		const freshIndex = activeSegments(freshState).indexOf(freshSegment);
		const fullLayoutMatches = segmentLayoutSignature(freshState) === segmentEditorLayoutSignature
			&& segmentConstraintSignature(freshInfo) === segmentEditorConstraintSignature
			&& !Boolean(freshInfo.leds.matrix)
			&& (segmentEditorMode !== "create" || segmentCreationPlaylistIsClear(freshState));
		const sourceMatches = fullLayoutMatches && (batchCreation
			? Number(freshState.mainseg) === 0
			: segmentEditorMode === "create"
				? !freshSegment
			: freshSegment && model.segmentGeometrySignature(freshSegment, freshIndex) === segmentEditorSourceSignature);
		if (!sourceMatches) {
			segmentSubmitting = false;
			segmentEditorConflict = true;
			segmentDeleteArmed = false;
			elements.deleteSegment.textContent = "Delete segment";
			setSegmentEditorStatus("The controller layout changed before submission. No request was sent; cancel and reopen the editor.", true);
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		const mutation = batchCreation
			? model.buildCreateSegmentBatchMutation(
				segmentEditorBatchDrafts, segmentEditorCreatePlan, activeSegments(freshState), freshCount, freshMaximumSegments)
			: segmentEditorMode === "create"
				? model.buildCreateSegmentMutation(submittedDraft, segmentEditorCreatePlan, activeSegments(freshState), freshCount, freshMaximumSegments)
			: model.buildEditSegmentMutation(submittedDraft, activeSegments(freshState), freshCount, freshMaximumSegments);
		if (!mutation.ok) {
			segmentSubmitting = false;
			setSegmentEditorStatus(`No request was sent: ${mutation.error}`, true);
			if (mutation.rangeError) requestAnimationFrame(() => elements.segmentStart.focus());
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		if (segmentEditorMode === "edit" && model.segmentMatchesPatch(freshSegment, mutation.patches[0], freshIndex)) {
			segmentSubmitting = false;
			segmentEditorDirty = false;
			setSegmentEditorStatus("No layout changes to save.");
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		setSegmentEditorStatus(batchCreation ? `Creating ${mutation.targetSegments} segments in one submission…`
			: mutation.mode === "split" ? "Splitting segment…"
			: segmentEditorMode === "create" ? "Creating segment…" : "Updating segment…");
		const payload = segmentEditorMode === "create" ? mutation.patches : mutation.patches[0];
		const outcome = await sendState({ seg: payload });
		const verified = !outcome.blocked && await verifySegmentMutation(mutation, freshCount, freshMaximumSegments);
		segmentSubmitting = false;
		if (verified) {
			toast(batchCreation ? `${mutation.targetSegments} segments created`
				: segmentEditorMode === "create" ? "Segment created" : "Segment updated");
			closeSegmentEditor();
			return;
		}
		setSegmentEditorStatus("The layout submission was not verified. Refresh before deciding whether to submit a new request.", true);
		structuralMutationUncertain = true;
		segmentEditorConflict = true;
		renderSegments();
		renderPresets();
		updateSegmentEditorAvailability();
	}

	async function sendImmediateSegmentPatch(patch) {
		if (segmentEditorMode !== "edit" || segmentEditorId == null || segmentMutationLocked()) return;
		segmentDeleteArmed = false;
		elements.deleteSegment.textContent = "Delete segment";
		await sendState({ seg: { id: segmentEditorId, ...patch } });
	}

	async function deleteEditedSegment() {
		if (segmentEditorMode !== "edit" || segmentStructuralLocked()) {
			if (pendingMutations > 0) setSegmentEditorStatus("Wait for the current controller change to finish before deleting this segment.", true);
			return;
		}
		const result = model.buildDeleteSegmentUpdate(activeSegments(), segmentEditorId, targetSegmentIds, currentState.mainseg);
		if (!result.ok) {
			setSegmentEditorStatus(result.error, true);
			return;
		}
		if (!segmentDeleteArmed) {
			segmentDeleteArmed = true;
			elements.deleteSegment.textContent = "Confirm delete";
			setSegmentEditorStatus("Deleting removes this runtime segment. Choose Confirm Delete to continue.", true);
			elements.deleteSegment.focus();
			return;
		}

		segmentSubmitting = true;
		setSegmentEditorStatus("Checking the latest controller layout before deleting…");
		updateSegmentEditorAvailability();
		renderPresets();
		let freshState;
		try {
			freshState = await readStructuralStateForWrite();
		} catch (error) {
			segmentSubmitting = false;
			segmentDeleteArmed = false;
			elements.deleteSegment.textContent = "Delete segment";
			setSegmentEditorStatus(`Could not verify the latest layout, so no delete request was sent: ${error.message}`, true);
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		const freshSegment = findSegmentInState(freshState, segmentEditorId);
		const freshIndex = activeSegments(freshState).indexOf(freshSegment);
		if (!freshSegment || model.segmentGeometrySignature(freshSegment, freshIndex) !== segmentEditorSourceSignature) {
			segmentSubmitting = false;
			segmentEditorConflict = true;
			segmentDeleteArmed = false;
			elements.deleteSegment.textContent = "Delete segment";
			setSegmentEditorStatus("This segment changed before deletion. No request was sent; cancel and reopen the editor.", true);
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		const freshResult = model.buildDeleteSegmentUpdate(activeSegments(freshState), segmentEditorId, targetSegmentIds, freshState.mainseg);
		if (!freshResult.ok) {
			segmentSubmitting = false;
			segmentEditorConflict = true;
			segmentDeleteArmed = false;
			elements.deleteSegment.textContent = "Delete segment";
			setSegmentEditorStatus(`${freshResult.error} No delete request was sent.`, true);
			updateSegmentEditorAvailability();
			renderPresets();
			return;
		}
		setSegmentEditorStatus("Deleting once, then checking the resulting layout…");
		targetSelectionVersion += 1;
		const outcome = await sendState(freshResult.update, targetSelectionVersion);
		const deleted = !outcome.blocked && await verifyState(state => model.deletedSegmentMatchesState(
			state, segmentEditorId, freshResult.remainingIds, freshResult.selectedIds, freshResult.update.mainseg));
		segmentSubmitting = false;
		if (deleted) {
			targetSegmentIds = new Set(freshResult.selectedIds);
			toast("Segment deleted");
			closeSegmentEditor();
			return;
		}
		setSegmentEditorStatus("The deletion was not verified. Refresh before deciding whether to submit a new request.", true);
		structuralMutationUncertain = true;
		segmentEditorConflict = true;
		renderSegments();
		renderPresets();
		updateSegmentEditorAvailability();
	}

	async function resetSegmentLayout() {
		if (segmentStructuralLocked()) {
			if (pendingMutations > 0) toast("Wait for the current controller change to finish before resetting the layout.", true);
			return;
		}
		if (!elements.segmentEditor.hidden || !elements.presetEditor.hidden) {
			toast("Close the open editor before resetting the segment layout.", true);
			return;
		}
		const result = model.buildResetSegmentsUpdate(activeSegments(), controllerLedCount());
		if (!result.ok) {
			toast(result.error, true);
			return;
		}
		if (!segmentResetArmed) {
			segmentResetArmed = true;
			segmentResetSourceSignature = activeSegments().map((segment, index) => model.segmentGeometrySignature(segment, index)).join("\u001e");
			elements.resetSegments.textContent = "Confirm reset";
			toast("Reset removes every segment except one full-strip segment.", true);
			elements.resetSegments.focus();
			clearTimeout(segmentResetTimer);
			segmentResetTimer = setTimeout(() => resetSegmentResetConfirmation(), 7000);
			return;
		}
		const expectedLayoutSignature = segmentResetSourceSignature;
		resetSegmentResetConfirmation(false);
		segmentResetSubmitting = true;
		renderSegments();
		renderPresets();
		let freshState;
		try {
			freshState = await readStructuralStateForWrite();
		} catch (error) {
			segmentResetSubmitting = false;
			toast(`Could not verify the latest layout, so no reset request was sent: ${error.message}`, true);
			renderSegments();
			renderPresets();
			return;
		}
		if (segmentLayoutSignature(freshState) !== expectedLayoutSignature) {
			segmentResetSubmitting = false;
			toast("The segment layout changed before reset. No request was sent; review it and confirm again.", true);
			renderSegments();
			renderPresets();
			return;
		}
		const freshResult = model.buildResetSegmentsUpdate(activeSegments(freshState), controllerLedCount());
		if (!freshResult.ok) {
			segmentResetSubmitting = false;
			toast(`${freshResult.error} No reset request was sent.`, true);
			renderSegments();
			renderPresets();
			return;
		}
		targetSelectionVersion += 1;
		const outcome = await sendState(freshResult.update, targetSelectionVersion);
		const verified = !outcome.blocked && await verifyState(state => model.resetSegmentsMatchState(state, freshResult.update));
		segmentResetSubmitting = false;
		if (verified) {
			targetSegmentIds = new Set([0]);
			toast("Segment layout reset");
			renderSegments();
			renderPresets();
			requestAnimationFrame(() => elements.resetSegments.focus());
			return;
		}
		structuralMutationUncertain = true;
		toast("The reset was not verified. Refresh before deciding whether to submit a new request.", true);
		renderSegments();
		renderPresets();
	}

	function setPresetEditorStatus(message = "", isError = false) {
		elements.presetEditorStatus.textContent = message;
		elements.presetEditorStatus.classList.toggle("error", isError);
	}

	function setPresetStatus(message = "", isError = false) {
		elements.presetStatus.textContent = message;
		elements.presetStatus.classList.toggle("error", isError);
	}

	function currentPresetDraft() {
		return {
			id: elements.presetId.value,
			name: elements.presetName.value,
			includeBrightness: elements.presetBrightness.checked,
			saveSegmentBounds: elements.presetBounds.checked,
			selectedOnly: elements.presetSelectedOnly.checked,
			useAtStartup: elements.presetStartup.checked
		};
	}

	function updatePresetSelectionSummary() {
		const selected = selectedSegmentIds().length;
		const active = activeSegments().length;
		elements.presetSelectionSummary.textContent = !active
			? "No active segments are available to save."
			: elements.presetSelectedOnly.checked && !selected
				? "Select at least one segment before saving selected targets only."
				: elements.presetSelectedOnly.checked
			? `Saves ${selected} selected ${selected === 1 ? "segment" : "segments"}; the others remain unchanged when recalled.`
			: `Saves all ${active} active ${active === 1 ? "segment" : "segments"}.`;
	}

	function presetSignature(preset) {
		return preset && typeof preset === "object" ? JSON.stringify(preset) : "";
	}

	function reconcilePresetEditor() {
		if (elements.presetEditor.hidden || presetWritePending) return;
		const targetId = Number(elements.presetId.value);
		const current = Number.isInteger(targetId) ? presetData[String(targetId)] : null;
		if (presetEditorSourceId == null) {
			if (presetSignature(current) !== presetEditorSourceSignature) {
				presetEditorConflict = true;
				resetPresetConfirmations(false);
				setPresetEditorStatus("That preset ID became occupied while you were editing. Cancel and reopen before submitting.", true);
			}
		} else if (!current || presetSignature(current) !== presetEditorSourceSignature) {
			presetEditorConflict = true;
			resetPresetConfirmations(false);
			setPresetEditorStatus("This preset changed while you were editing. Refresh, then cancel and reopen before submitting.", true);
		}
		updatePresetEditorAvailability();
	}

	function updatePresetEditorAvailability() {
		if (elements.presetEditor.hidden) return;
		const mutationBlocked = presetWritePending || presetSubmissionBlocked || presetMutationUncertain || structuralMutationUncertain;
		const noSavableSegments = !activeSegments().length || (elements.presetSelectedOnly.checked && !selectedSegmentIds().length);
		const managesStartupPreset = presetEditorSourceId != null
			&& Number(currentInfo.leds?.bootps || 0) === Number(presetEditorSourceId);
		for (const control of elements.presetEditor.querySelectorAll("input")) control.disabled = mutationBlocked;
		for (const control of elements.presetEditor.querySelectorAll("button")) control.disabled = presetWritePending;
		elements.savePreset.disabled = mutationBlocked || presetEditorConflict || presetCaptureLocked() || noSavableSegments
			|| (startupConfigurationInvalid && !elements.presetStartup.checked);
		elements.deletePreset.disabled = mutationBlocked || presetEditorConflict || startupConfigurationInvalid || managesStartupPreset;
		elements.presetEditor.setAttribute("aria-busy", String(presetWritePending));
	}

	function resetPresetConfirmations(clearStatus = true) {
		presetOverwriteArmed = false;
		presetDeleteArmed = false;
		elements.savePreset.textContent = presetEditorSourceId == null ? "Save preset" : "Replace with current look";
		elements.deletePreset.textContent = "Delete preset";
		if (clearStatus) setPresetEditorStatus();
	}

	function togglePresetEditor(id, trigger) {
		const expanded = !elements.presetEditor.hidden && presetEditorSourceId === id;
		if (expanded) {
			closePresetEditor();
			return;
		}
		openPresetEditor(id, trigger);
	}

	function openPresetEditor(id = null, trigger = null) {
		if (!elements.presetEditor.hidden) {
			toast("Save or cancel the open preset draft first.", true);
			return;
		}
		if (!elements.segmentEditor.hidden) {
			toast(segmentEditorDirty ? "Update or cancel the segment draft before saving a preset." : "Close the segment editor before saving a preset.", true);
			return;
		}
		if (presetMutationUncertain || structuralMutationUncertain) {
			toast("Refresh the controller before saving a preset.", true);
			return;
		}
		if (presetWritePending || presetApplyPending || !stateLoaded || !presetsLoaded) {
			if (!presetWritePending && !presetApplyPending) toast("Refresh the controller before saving a preset.", true);
			return;
		}
		if (!activeSegments().length) {
			toast("Configure at least one active segment before saving a preset.", true);
			return;
		}
		const sourceId = id == null ? null : Number(id);
		const existing = sourceId == null ? null : presetData[String(sourceId)];
		const targetId = sourceId ?? model.lowestUnusedPresetId(presetData);
		if (targetId == null) {
			toast("All preset IDs from 1 through 250 are already used.", true);
			return;
		}

		presetEditorSourceId = sourceId;
		presetEditorSourceSignature = presetSignature(existing);
		presetEditorDirty = false;
		presetEditorConflict = false;
		presetSubmissionBlocked = false;
		presetEditorReturnFocus = trigger || document.activeElement;
		elements.presetName.value = existing?.n || `Preset ${targetId}`;
		elements.presetId.value = String(targetId);
		elements.presetId.readOnly = existing != null;
		elements.presetBrightness.checked = true;
		elements.presetBounds.checked = true;
		elements.presetSelectedOnly.checked = false;
		elements.presetStartup.checked = Number(currentInfo.leds?.bootps || 0) === targetId;
		elements.presetEditorTitle.textContent = existing ? `Manage ${existing.n || `Preset ${targetId}`}` : "Save current look";
		elements.deletePreset.hidden = !existing;
		resetPresetConfirmations(false);
		updatePresetSelectionSummary();
		setPresetEditorStatus(startupConfigurationInvalid
			? "Startup preset storage is inconsistent. Select Use at startup and save a valid preset to repair it."
			: Number(currentInfo.leds?.bootps || 0) === targetId
				? "This is the startup preset. Save another preset for startup before deleting this one."
				: existing?.playlist
					? "This is a playlist. Replacing it converts this ID into a current-state preset."
					: "Preset writes are confirmed with a read-only persistence check.");
		elements.presetEditor.hidden = false;
		updatePresetEditorAvailability();
		renderPresets();
		renderSegments();
	}

	function closePresetEditor(returnFocus = true) {
		const closingId = Number(elements.presetId.value);
		const previousFocus = presetEditorReturnFocus;
		elements.presetEditor.hidden = true;
		restoreEditorHome(elements.presetEditor, elements.presetEditorHome);
		presetEditorSourceId = null;
		presetEditorSourceSignature = "";
		presetEditorDirty = false;
		presetEditorConflict = false;
		presetSubmissionBlocked = false;
		resetPresetConfirmations(false);
		setPresetEditorStatus();
		presetEditorReturnFocus = null;
		renderPresets();
		renderSegments();
		if (returnFocus) requestAnimationFrame(() => {
			focusFirstAvailable([
				previousFocus,
				elements.presets.querySelector(`button[data-expand-preset-id="${closingId}"]`),
				elements.addPreset,
				elements.refresh
			]);
		});
	}

	function markPresetDraftDirty(event) {
		presetEditorDirty = true;
		if (event?.currentTarget === elements.presetId && presetEditorSourceId == null) {
			const targetId = Number(elements.presetId.value);
			presetEditorSourceSignature = Number.isInteger(targetId) ? presetSignature(presetData[String(targetId)]) : "";
			presetEditorConflict = false;
		}
		resetPresetConfirmations();
		updatePresetEditorAvailability();
	}

	function setPresetWritePending(pending) {
		presetWritePending = pending;
		document.body.classList.toggle("preset-write-pending", pending);
		updatePresetEditorAvailability();
		updateSegmentEditorAvailability();
		renderSegments();
		renderPresets();
		updatePresetSelectionSummary();
	}

	function setPresetApplyPending(pending) {
		presetApplyPending = pending;
		document.body.classList.toggle("preset-apply-pending", pending);
		updatePresetEditorAvailability();
		updateSegmentEditorAvailability();
		renderSegments();
		renderPresets();
	}

	async function verifyPresetApplied(id) {
		return model.verifyReadOnly(async () => {
			const stateResponse = await requestJSON("/json/state", {}, 1500);
			applyState(stateResponse.state || stateResponse);
			return currentState;
		}, state => Number(state.ps) === Number(id) || Number(state.pl) === Number(id), {
			attempts: 6,
			delayMilliseconds: 250,
			initialDelayMilliseconds: 150
		});
	}

	async function applySavedPreset(id) {
		if (segmentMutationLocked() || !presetsLoaded || !elements.segmentEditor.hidden || !elements.presetEditor.hidden) return;
		const preset = presetData[String(id)];
		if (!preset) {
			toast("That preset is no longer available. Refresh and try again.", true);
			return;
		}
		if (Number(currentState.ps) === Number(id) || Number(currentState.pl) === Number(id)) {
			toast(`${preset.n || `Preset ${id}`} is already active.`);
			return;
		}
		const name = preset.n || `Preset ${id}`;
		setPresetStatus(`Loading ${name} and verifying the controller response…`);
		setPresetApplyPending(true);
		const outcome = await sendState({ ps: Number(id) }, null, false, true);
		const verification = !outcome.blocked ? await verifyPresetApplied(id) : { confirmed: false };
		if (!verification.confirmed) presetMutationUncertain = true;
		setPresetApplyPending(false);
		if (verification.confirmed) {
			setPresetStatus(`${name} loaded.`);
			toast(`Loaded ${name}`);
		} else {
			setPresetStatus("Preset application was not verified. Refresh before sending another command.", true);
			toast("Preset application was not verified. Refresh before sending another command.", true);
		}
	}

	function presetReferenceWarning(id) {
		const warnings = [];
		if (Number(currentInfo.leds?.bootps || 0) === Number(id)) warnings.push("it is the startup preset");
		const playlists = Object.entries(presetData).filter(([, preset]) => Array.isArray(preset?.playlist?.ps)
			&& preset.playlist.ps.some(entry => Number(entry) === Number(id)));
		if (playlists.length) warnings.push(`${playlists.length} ${playlists.length === 1 ? "playlist references" : "playlists reference"} it`);
		return warnings.length ? ` Warning: ${warnings.join(" and ")}.` : "";
	}

	async function verifyPresetFile(id, predicate, initialDelayMilliseconds = 750) {
		return model.verifyReadOnly(async attempt => {
			const presets = await requestJSON(`/presets.json?verify=${presetOperationVersion}-${attempt}-${Date.now()}`, {}, 1500);
			presetData = presets && typeof presets === "object" ? presets : {};
			presetsLoaded = true;
			renderPresets();
			return presetData;
		}, presets => predicate(presets[String(id)]), { attempts: 5, delayMilliseconds: 350, initialDelayMilliseconds });
	}

	async function preflightPresetSource(id, expectedSignature) {
		const presets = await requestJSON(`/presets.json?preflight=${presetOperationVersion}-${Date.now()}`, {}, 1500);
		if (!presets || typeof presets !== "object" || Array.isArray(presets)) {
			throw new Error("controller returned invalid preset data");
		}
		presetData = presets;
		presetsLoaded = true;
		renderPresets();
		return presetSignature(presetData[String(id)]) === expectedSignature;
	}

	async function readPresetCaptureStateForWrite() {
		const response = await requestJSON(`/json/state?capture=${presetOperationVersion}-${Date.now()}`, {}, 1500);
		const state = response.state || response;
		if (!state || typeof state !== "object" || !Array.isArray(state.seg)) {
			throw new Error("controller returned invalid state data");
		}
		return state;
	}

	async function readStartupConfigurationForWrite() {
		const infoResponse = await requestJSON("/json/info", {}, 1500);
		const info = infoResponse.info || infoResponse;
		if (!info || typeof info !== "object") throw new Error("controller returned invalid information");
		const config = await requestJSON(`/cfg.json?preflight=${presetOperationVersion}-${Date.now()}`, {}, 1500);
		currentInfo = info;
		renderInfo();
		renderPresets();
		return {
			runtime: Number(info.leds?.bootps),
			persisted: Number(config?.def?.ps)
		};
	}

	async function verifyPresetDeletionFinalState(id) {
		return model.verifyReadOnly(async attempt => {
			const infoResponse = await requestJSON("/json/info", {}, 1500);
			const info = infoResponse.info || infoResponse;
			if (!info || typeof info !== "object") throw new Error("controller returned invalid information");
			const config = await requestJSON(`/cfg.json?delete=${presetOperationVersion}-${attempt}-${Date.now()}`, {}, 1500);
			const presets = await requestJSON(`/presets.json?delete=${presetOperationVersion}-${attempt}-${Date.now()}`, {}, 1500);
			if (!presets || typeof presets !== "object" || Array.isArray(presets)) {
				throw new Error("controller returned invalid preset data");
			}
			currentInfo = info;
			presetData = presets;
			presetsLoaded = true;
			renderInfo();
			renderPresets();
			return { runtime: Number(info.leds?.bootps), persisted: Number(config?.def?.ps), presets };
		}, value => value.presets[String(id)] == null && model.startupPresetConfigurationIsUsable(
			value.runtime, value.persisted, value.presets), {
			attempts: 3,
			delayMilliseconds: 250
		});
	}

	async function verifyStartupPreset(id) {
		return model.verifyReadOnly(async attempt => {
			const infoResponse = await requestJSON("/json/info", {}, 1500);
			const info = infoResponse.info || infoResponse;
			if (info && typeof info === "object") {
				currentInfo = info;
				renderInfo();
				renderPresets();
			}
			const config = await requestJSON(`/cfg.json?verify=${presetOperationVersion}-${attempt}-${Date.now()}`, {}, 1500);
			const presets = await requestJSON(`/presets.json?startup=${presetOperationVersion}-${attempt}-${Date.now()}`, {}, 1500);
			return {
				runtime: Number(info?.leds?.bootps),
				persisted: Number(config?.def?.ps),
				presets
			};
		}, value => model.startupPresetMatchesConfiguration(value.runtime, value.persisted, id, value.presets), {
			attempts: 4,
			delayMilliseconds: 300,
			initialDelayMilliseconds: 150
		});
	}

	async function reconcileCurrentStateReadOnly() {
		try {
			const stateResponse = await requestJSON("/json/state", {}, 1500);
			const state = stateResponse.state || stateResponse;
			if (!state || typeof state !== "object" || !Array.isArray(state.seg)) return false;
			applyState(state);
			return true;
		} catch (_) {
			return false;
		}
	}

	async function submitPreset(event) {
		event.preventDefault();
		if (presetCaptureLocked() || presetSubmissionBlocked || presetEditorConflict || !presetsLoaded) return;
		const draft = currentPresetDraft();
		if (startupConfigurationInvalid && !draft.useAtStartup) {
			setPresetEditorStatus("Select Use at startup and save this preset to repair startup preset storage.", true);
			return;
		}
		if (!activeSegments().length || (draft.selectedOnly && !selectedSegmentIds().length)) {
			setPresetEditorStatus(draft.selectedOnly
				? "Select at least one segment before saving selected targets only."
				: "Configure at least one active segment before saving a preset.", true);
			return;
		}
		const targetId = Number(draft.id);
		const existing = presetData[String(targetId)] || null;
		if (typeof existing?.ql === "string") draft.quickLoad = existing.ql;
		const built = model.buildPresetSaveUpdate(draft, existing);
		if (!built.ok) {
			setPresetEditorStatus(built.error, true);
			return;
		}
		if (existing && !presetOverwriteArmed) {
			presetOverwriteArmed = true;
			presetDeleteArmed = false;
			elements.savePreset.textContent = "Confirm replace";
			elements.deletePreset.textContent = "Delete preset";
			setPresetEditorStatus(`Preset ${built.id} already exists. Confirm to replace it with the controller’s current look.${presetReferenceWarning(built.id)}`, true);
			elements.savePreset.focus();
			return;
		}

		const operation = ++presetOperationVersion;
		const expectedSourceSignature = presetEditorSourceSignature;
		setPresetWritePending(true);
		setPresetEditorStatus("Finishing earlier changes before capturing the preset…");
		await mutationQueue;
		if (operation !== presetOperationVersion) {
			setPresetWritePending(false);
			return;
		}
		const displayedStateSignature = model.presetCaptureSignature(draft, currentState);
		let freshState;
		try {
			freshState = await readPresetCaptureStateForWrite();
		} catch (error) {
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus(`Could not verify the current controller look, so no save request was sent: ${error.message}`, true);
			updatePresetEditorAvailability();
			return;
		}
		if (model.presetCaptureSignature(draft, freshState) !== displayedStateSignature) {
			applyState(freshState, true);
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus("The controller look changed before capture. No save request was sent; review it and confirm the save again.", true);
			updatePresetEditorAvailability();
			return;
		}
		applyState(freshState, true);
		let sourceMatches;
		try {
			sourceMatches = await preflightPresetSource(built.id, expectedSourceSignature);
		} catch (error) {
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus(`Could not verify the latest preset data, so no save request was sent: ${error.message}`, true);
			updatePresetEditorAvailability();
			return;
		}
		if (!sourceMatches) {
			presetEditorConflict = true;
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus("This preset changed before the save. No request was sent; cancel and reopen the editor.", true);
			updatePresetEditorAvailability();
			return;
		}
		const stateSnapshot = JSON.parse(JSON.stringify(freshState));
		const selectedSnapshot = Array.from(targetSegmentIds);
		const maxSegmentsSnapshot = Number(currentInfo.leds?.maxseg);
		setPresetEditorStatus("Saving once, then checking persistent storage…");
		const outcome = await sendState(built.update, null, true);
		const fileVerification = await verifyPresetFile(built.id, preset =>
			model.presetMatchesCurrentState(preset, draft, stateSnapshot, selectedSnapshot, maxSegmentsSnapshot));
		let startupVerification = { confirmed: true };
		if (draft.useAtStartup && fileVerification.confirmed) startupVerification = await verifyStartupPreset(built.id);
		const stateReconciled = fileVerification.confirmed && startupVerification.confirmed
			? await reconcileCurrentStateReadOnly()
			: false;
		if (operation !== presetOperationVersion) {
			setPresetWritePending(false);
			return;
		}
		const verified = !outcome.blocked && fileVerification.confirmed && startupVerification.confirmed && stateReconciled;
		if (!verified) {
			presetMutationUncertain = true;
			presetSubmissionBlocked = true;
			if (draft.useAtStartup) startupPresetUncertainId = built.id;
		}
		setPresetWritePending(false);

		if (verified) {
			if (draft.useAtStartup) {
				startupConfigurationInvalid = false;
				startupPresetUncertainId = null;
			}
			toast(`Saved ${built.name}`);
			closePresetEditor();
			return;
		}
		setPresetEditorStatus("The save was accepted or may have been accepted, but persistence was not verified. Refresh before submitting a new save.", true);
		resetPresetConfirmations(false);
		updatePresetEditorAvailability();
	}

	async function deleteManagedPreset() {
		if (presetEditorSourceId == null || controllerMutationLocked() || presetEditorConflict) return;
		const id = Number(presetEditorSourceId);
		const preset = presetData[String(id)];
		if (!preset) {
			setPresetEditorStatus("That preset no longer exists.", true);
			return;
		}
		if (!presetDeleteArmed) {
			presetDeleteArmed = true;
			presetOverwriteArmed = false;
			elements.deletePreset.textContent = "Confirm delete";
			elements.savePreset.textContent = "Replace with current look";
			setPresetEditorStatus(`Deleting Preset ${id} cannot be undone.${presetReferenceWarning(id)} Choose Confirm Delete to continue.`, true);
			elements.deletePreset.focus();
			return;
		}

		const operation = ++presetOperationVersion;
		const expectedSourceSignature = presetEditorSourceSignature;
		setPresetWritePending(true);
		setPresetEditorStatus("Finishing earlier changes and checking the latest preset before deleting…");
		await mutationQueue;
		if (operation !== presetOperationVersion) {
			setPresetWritePending(false);
			return;
		}
		let startupConfiguration;
		try {
			startupConfiguration = await readStartupConfigurationForWrite();
		} catch (error) {
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus(`Could not verify startup preset storage, so no delete request was sent: ${error.message}`, true);
			updatePresetEditorAvailability();
			return;
		}
		let sourceMatches;
		try {
			sourceMatches = await preflightPresetSource(id, expectedSourceSignature);
		} catch (error) {
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus(`Could not verify the latest preset data, so no delete request was sent: ${error.message}`, true);
			updatePresetEditorAvailability();
			return;
		}
		if (!sourceMatches) {
			presetEditorConflict = true;
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus("This preset changed before deletion. No request was sent; cancel and reopen the editor.", true);
			updatePresetEditorAvailability();
			return;
		}
		const startupConfigurationUsable = model.startupPresetConfigurationIsUsable(
			startupConfiguration.runtime, startupConfiguration.persisted, presetData);
		if (!startupConfigurationUsable) {
			startupConfigurationInvalid = true;
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus("Startup preset storage is inconsistent. No delete request was sent; save a valid preset with Use at startup first.", true);
			updatePresetEditorAvailability();
			return;
		}
		if (startupConfiguration.runtime === id) {
			setPresetWritePending(false);
			resetPresetConfirmations(false);
			setPresetEditorStatus("This is the current startup preset. No delete request was sent; save another startup preset first.", true);
			updatePresetEditorAvailability();
			return;
		}
		setPresetEditorStatus("Deleting once, then checking persistent storage…");
		const outcome = await sendState({ pdel: id }, null, true);
		const verification = await verifyPresetFile(id, presetValue => presetValue == null, 250);
		const stateReconciled = verification.confirmed ? await reconcileCurrentStateReadOnly() : false;
		const finalVerification = verification.confirmed && stateReconciled
			? await verifyPresetDeletionFinalState(id)
			: { confirmed: false, value: null };
		if (finalVerification.value && !model.startupPresetConfigurationIsUsable(
			finalVerification.value.runtime, finalVerification.value.persisted, finalVerification.value.presets)) {
			startupConfigurationInvalid = true;
		}
		if (operation !== presetOperationVersion) {
			setPresetWritePending(false);
			return;
		}
		const verified = !outcome.blocked && verification.confirmed && stateReconciled && finalVerification.confirmed;
		if (!verified) {
			presetMutationUncertain = true;
			presetSubmissionBlocked = true;
		}
		setPresetWritePending(false);
		if (verified) {
			toast("Preset deleted");
			closePresetEditor();
			return;
		}
		setPresetEditorStatus("The deletion was accepted or may have been accepted, but persistence was not verified. Refresh before submitting a new request.", true);
		resetPresetConfirmations(false);
		updatePresetEditorAvailability();
	}

	function updateColorPresentation(value) {
		const hex = normalizeHex(value) || "#000000";
		const rgb = hexToRgb(hex);
		const colorValue = Math.round(Math.max(rgb.r, rgb.g, rgb.b) * 100 / 255);
		pendingPickerHex = hex;
		const activeButton = colorSlotButtons.find(button => Number(button.dataset.colorSlot) === activeColorSlot);
		const activeSwatch = activeButton?.querySelector(".color-slot-swatch");
		if (activeSwatch) activeSwatch.style.background = hex;
		if (activeButton && !activeButton.hidden) {
			const label = activeButton.querySelector("span:last-child")?.textContent || `Color ${activeColorSlot + 1}`;
			activeButton.setAttribute("aria-label", `Edit ${label} color, currently ${hex}`);
		}
		if (document.activeElement !== elements.colorHex || pickerInputActive) elements.colorHex.value = hex;
		if (document.activeElement !== elements.colorValue) elements.colorValue.value = String(colorValue);
		elements.colorValueValue.value = `${colorValue}%`;
		elements.colorHex.removeAttribute("aria-invalid");
	}

	function currentColorCommandContext() {
		return { slot: activeColorSlot, targetIds: selectedSegmentIds() };
	}

	function beginColorInteraction(context) {
		context = context || currentColorCommandContext();
		if (!pickerInputActive) pendingColorInteraction = context;
		pickerInputActive = true;
	}

	function endColorInteraction() {
		const context = pendingColorInteraction || currentColorCommandContext();
		pickerInputActive = false;
		pendingColorInteraction = null;
		return context;
	}

	function syncPickerColor(value) {
		const hex = normalizeHex(value) || "#000000";
		updateColorPresentation(hex);
		if (!picker || pickerInputActive || document.activeElement === elements.colorHex) return;
		if (hex === "#000000") {
			if (picker.color.value !== 0) picker.color.setChannel("hsv", "v", 0);
		} else if (picker.color.hexString.toUpperCase() !== hex) {
			picker.color.set(hex);
		}
	}

	function commitPickerColor(color, context = currentColorCommandContext()) {
		const rgb = rgbObject(color);
		updateColorPresentation(rgbToHex(rgb));
		const patch = model.colorSlotPatch(context.slot, rgb);
		if (patch) sendSegmentState(patch, context.targetIds);
	}

	function pickerWidth() {
		const available = elements.colorPicker.getBoundingClientRect().width || 260;
		return Math.round(Math.min(280, Math.max(160, available)));
	}

	function discardPendingColorInteraction() {
		if (pickerTouchGesture) clearPickerTouchTimer(pickerTouchGesture);
		pickerTouchGesture = null;
		pickerInputActive = false;
		pickerStartedBlack = false;
		pendingColorInteraction = null;
		renderColorControls(referenceSegment());
	}

	function setColorPanelExpanded(expanded) {
		expanded = Boolean(expanded);
		if (!expanded && (pickerTouchGesture || pickerInputActive)) discardPendingColorInteraction();
		elements.colorExpandedControls.hidden = !expanded;
		elements.colorExpand.setAttribute("aria-expanded", String(expanded));
		elements.colorExpand.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} color picker controls`);
		if (expanded && picker) {
			requestAnimationFrame(() => {
				if (!elements.colorExpandedControls.hidden) picker.resize(pickerWidth());
			});
		}
	}

	function pickerTouchByIdentifier(event, identifier) {
		return Array.from(event.changedTouches || event.touches || [])
			.find(touch => touch.identifier === identifier) || null;
	}

	function clearPickerTouchTimer(gesture) {
		if (!gesture?.timer) return;
		clearTimeout(gesture.timer);
		gesture.timer = null;
	}

	function activatePickerTouchGesture(gesture) {
		if (!gesture || pickerTouchGesture !== gesture || gesture.state !== "pending") return;
		gesture.state = "pick";
		clearPickerTouchTimer(gesture);
		beginColorInteraction(gesture.context);
		pickerStartedBlack = gesture.startedBlack;
	}

	function cancelPickerTouchGesture() {
		const gesture = pickerTouchGesture;
		if (!gesture) return;
		clearPickerTouchTimer(gesture);
		pickerTouchGesture = null;
		if (gesture.state === "pick") cancelPickerInteraction();
	}

	function updatePickerFromTouch(touch) {
		const wheel = elements.colorPicker.querySelector(".IroWheel");
		if (!wheel || !picker || !touch) return false;
		const bounds = wheel.getBoundingClientRect();
		const hsv = model.pickerWheelHsv(
			{ x: touch.clientX, y: touch.clientY },
			{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
			picker.color.value
		);
		if (!hsv) return false;
		picker.color.set(hsv);
		return true;
	}

	function handlePickerTouchStart(event) {
		const target = event.target instanceof Element ? event.target : event.target?.parentElement;
		if (!target?.closest(".IroWheel") || !picker || elements.colorPicker.getAttribute("aria-disabled") === "true") return;
		event.stopPropagation();
		if (event.touches.length !== 1) {
			cancelPickerTouchGesture();
			return;
		}
		cancelPickerTouchGesture();
		const touch = event.changedTouches[0] || event.touches[0];
		const gesture = {
			identifier: touch.identifier,
			startX: touch.clientX,
			startY: touch.clientY,
			lastX: touch.clientX,
			lastY: touch.clientY,
			startTime: performance.now(),
			startScrollX: window.scrollX,
			startScrollY: window.scrollY,
			state: "pending",
			context: currentColorCommandContext(),
			startedBlack: picker.color.value === 0,
			timer: null
		};
		pickerTouchGesture = gesture;
		gesture.timer = setTimeout(() => activatePickerTouchGesture(gesture), pickerTouchDwellMilliseconds);
	}

	function handlePickerTouchMove(event) {
		const gesture = pickerTouchGesture;
		if (!gesture) return;
		if (event.touches.length !== 1) {
			event.stopPropagation();
			cancelPickerTouchGesture();
			return;
		}
		const touch = pickerTouchByIdentifier(event, gesture.identifier);
		if (!touch) return;
		gesture.lastX = touch.clientX;
		gesture.lastY = touch.clientY;
		const distance = Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY);
		if (gesture.state === "pending") {
			const intent = model.pickerTouchIntent(performance.now() - gesture.startTime, distance,
				pickerTouchDwellMilliseconds, pickerTouchSlopPixels);
			if (intent === "scroll") {
				gesture.state = "scroll";
				clearPickerTouchTimer(gesture);
				return;
			}
			if (intent === "pick") activatePickerTouchGesture(gesture);
		}
		if (gesture.state !== "pick") {
			event.stopPropagation();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		updatePickerFromTouch(touch);
	}

	function handlePickerTouchEnd(event) {
		const gesture = pickerTouchGesture;
		if (!gesture) return;
		const touch = pickerTouchByIdentifier(event, gesture.identifier);
		if (!touch) return;
		if (gesture.state === "scroll") {
			clearPickerTouchTimer(gesture);
			pickerTouchGesture = null;
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (gesture.state === "pending") activatePickerTouchGesture(gesture);
		updatePickerFromTouch(touch);
		if (pickerStartedBlack && picker.color.value === 0) picker.color.setChannel("hsv", "v", 100);
		const context = endColorInteraction();
		pickerStartedBlack = false;
		clearPickerTouchTimer(gesture);
		pickerTouchGesture = null;
		suppressPickerMouseUntil = Date.now() + 600;
		commitPickerColor(picker.color.rgb, context);
	}

	function handlePickerTouchCancel(event) {
		if (!pickerTouchGesture) return;
		event.stopPropagation();
		cancelPickerTouchGesture();
	}

	function cancelPickerOnMultitouch(event) {
		if (pickerTouchGesture && event.touches.length !== 1) cancelPickerTouchGesture();
	}

	function handlePickerPageScroll() {
		const gesture = pickerTouchGesture;
		if (!gesture || gesture.state !== "pending") return;
		if (window.scrollX === gesture.startScrollX && window.scrollY === gesture.startScrollY) return;
		gesture.state = "scroll";
		clearPickerTouchTimer(gesture);
	}

	function suppressPickerCompatibilityMouse(event) {
		if (Date.now() >= suppressPickerMouseUntil) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	function initializeColorPicker() {
		if (picker) return;
		elements.colorPicker.replaceChildren();
		picker = new iro.ColorPicker(elements.colorPicker, {
			width: pickerWidth(),
			color: pendingPickerHex,
			wheelLightness: false,
			wheelAngle: 270,
			wheelDirection: "clockwise",
			layout: [{ component: iro.ui.Wheel, options: {} }]
		});
		picker.on("input:start", () => {
			beginColorInteraction();
			pickerStartedBlack = picker.color.value === 0;
		});
		picker.on("color:change", color => {
			updateColorPresentation(color.hexString);
		});
		picker.on("input:end", color => {
			if (pickerStartedBlack && picker.color.value === 0) picker.color.setChannel("hsv", "v", 100);
			const context = endColorInteraction();
			pickerStartedBlack = false;
			commitPickerColor(picker.color.rgb || color.rgb, context);
		});
		syncPickerColor(pendingPickerHex);
	}

	function showPickerMessage(text) {
		const message = document.createElement("span");
		message.className = "picker-loading";
		message.textContent = text;
		elements.colorPicker.replaceChildren(message);
	}

	function loadColorPicker(attempt = 0) {
		if (picker) return Promise.resolve();
		if (window.iro) {
			initializeColorPicker();
			return Promise.resolve();
		}
		return new Promise(resolve => {
			const script = document.createElement("script");
			let settled = false;
			const timeout = setTimeout(() => retry(), 4000);
			const retry = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				script.remove();
				if (attempt < 3) {
					showPickerMessage("Retrying color wheel…");
					setTimeout(() => loadColorPicker(attempt + 1).then(resolve), 300 * (attempt + 1));
				} else {
					showPickerMessage("Color wheel unavailable. Use a quick color or hex value.");
					resolve();
				}
			};
			script.src = route("/iro.js");
			script.async = true;
			script.onload = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				try {
					initializeColorPicker();
				} catch (_) {
					showPickerMessage("Color wheel unavailable. Use a quick color or hex value.");
				}
				resolve();
			};
			script.onerror = retry;
			document.head.appendChild(script);
		});
	}

	function cancelPickerInteraction() {
		if (pickerTouchGesture) {
			clearPickerTouchTimer(pickerTouchGesture);
			pickerTouchGesture = null;
		}
		if (!pickerInputActive) return;
		pickerInputActive = false;
		pickerStartedBlack = false;
		pendingColorInteraction = null;
		refresh(false);
	}

	function syncControlValue(control, value) {
		if (document.activeElement !== control) control.value = String(value);
	}

	function renderState() {
		const segment = referenceSegment();
		const isOn = Boolean(currentState.on);
		elements.power.classList.toggle("on", isOn);
		elements.power.setAttribute("aria-pressed", String(isOn));
		elements.powerLabel.textContent = isOn ? "Turn off" : "Turn on";
		syncControlValue(elements.brightness, currentState.bri ?? 128);
		elements.brightnessValue.value = percent(currentState.bri ?? 128);
		syncControlValue(elements.speed, segment.sx ?? 128);
		elements.speedValue.value = percent(segment.sx ?? 128);
		syncControlValue(elements.intensity, segment.ix ?? 128);
		elements.intensityValue.value = percent(segment.ix ?? 128);
		syncControlValue(elements.custom1, segment.c1 ?? 128);
		elements.custom1Value.value = String(segment.c1 ?? 128);
		syncControlValue(elements.custom2, segment.c2 ?? 128);
		elements.custom2Value.value = String(segment.c2 ?? 128);
		syncControlValue(elements.custom3, segment.c3 ?? 16);
		elements.custom3Value.value = String(segment.c3 ?? 16);
		elements.option1.checked = Boolean(segment.o1);
		elements.option2.checked = Boolean(segment.o2);
		elements.option3.checked = Boolean(segment.o3);
		if (effectCatalog.length) fillSelect(elements.effect, effects, segment.fx, effectCatalog[segment.fx] || "Current effect");
		if (palettes.length) fillSelect(elements.palette, palettes, segment.pal);
		renderEffectControls(segment.fx);
		renderSegments();
		renderPresets();
	}

	function rawControllerName(info = currentInfo) {
		return typeof info?.name === "string" ? info.name : null;
	}

	function controllerName(info = currentInfo) {
		const name = rawControllerName(info)?.trim() || "";
		return name || "CastleTek Controller";
	}

	function renameMatchesInfo(info, expectedName, expectedSimplifiedUI) {
		return rawControllerName(info) === expectedName
			&& typeof info?.simplifiedui === "boolean"
			&& info.simplifiedui === expectedSimplifiedUI;
	}

	function renameRequestId() {
		if (typeof window.crypto?.getRandomValues === "function") {
			const values = new Uint32Array(2);
			window.crypto.getRandomValues(values);
			return Array.from(values, value => value.toString(16).padStart(8, "0")).join("");
		}
		return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 32);
	}

	function setRenameStatus(message = "", isError = false) {
		elements.renameStatus.textContent = message;
		elements.renameStatus.classList.toggle("error", Boolean(message) && isError);
	}

	function updateRenameAvailability() {
		const infoReady = rawControllerName(currentInfo) !== null;
		elements.deviceName.disabled = !infoReady || renameSubmitting;
		elements.renameName.disabled = renameSubmitting;
		elements.renameSave.disabled = renameSubmitting || renameMutationUncertain || renameConflict;
		elements.renameCancel.disabled = renameSubmitting;
	}

	function fitDeviceName() {
		const element = elements.deviceName;
		element.style.removeProperty("font-size");
		const available = element.clientWidth;
		const maximum = Number.parseFloat(getComputedStyle(element).fontSize);
		if (!available || !Number.isFinite(maximum)) return;
		const minimum = window.matchMedia("(max-width: 720px)").matches ? 16 : 20;
		if (element.scrollWidth <= available) {
			element.dataset.fitted = "false";
			return;
		}
		let lower = minimum;
		let upper = maximum;
		for (let step = 0; step < 8; step++) {
			const candidate = (lower + upper) / 2;
			element.style.fontSize = `${candidate}px`;
			if (element.scrollWidth <= available) lower = candidate;
			else upper = candidate;
		}
		element.style.fontSize = `${Math.max(minimum, lower)}px`;
		element.dataset.fitted = "true";
	}

	function renderInfo() {
		const name = controllerName();
		elements.deviceName.textContent = name;
		elements.deviceName.title = `Rename controller: ${name}`;
		elements.deviceName.setAttribute("aria-label", `Rename controller: ${name}`);
		document.title = `${name} · CastleTek`;
		if (!elements.renameForm.hidden && !renameSubmitting && rawControllerName(currentInfo) !== renameSourceRawName) {
			renameConflict = true;
			setRenameStatus("The controller name changed while you were editing. Close and reopen the editor.", true);
		}
		updateRenameAvailability();
		requestAnimationFrame(fitDeviceName);
	}

	function openRenameEditor() {
		if (elements.deviceName.disabled || renameSubmitting) return;
		if (!elements.renameForm.hidden) {
			elements.renameName.focus({ preventScroll: true });
			return;
		}
		renameSourceName = controllerName();
		renameSourceRawName = rawControllerName();
		renameConflict = false;
		elements.renameName.value = renameSourceName;
		elements.renameForm.hidden = false;
		elements.deviceName.setAttribute("aria-expanded", "true");
		setRenameStatus(renameMutationUncertain
			? "Refresh the controller before submitting another name."
			: "Use up to 25 characters and 32 UTF-8 bytes.", renameMutationUncertain);
		updateRenameAvailability();
		requestAnimationFrame(() => {
			elements.renameName.focus({ preventScroll: true });
			elements.renameName.select();
		});
	}

	function closeRenameEditor(restoreFocus = true) {
		if (renameSubmitting) return;
		elements.renameForm.hidden = true;
		elements.deviceName.setAttribute("aria-expanded", "false");
		renameConflict = false;
		renameSourceName = "";
		renameSourceRawName = null;
		setRenameStatus();
		updateRenameAvailability();
		if (restoreFocus) requestAnimationFrame(() => elements.deviceName.focus({ preventScroll: true }));
	}

	async function submitControllerRename(event) {
		event.preventDefault();
		if (renameSubmitting || renameMutationUncertain || renameConflict) return;
		const validation = model.validateControllerName(elements.renameName.value, renameSourceName);
		if (!validation.ok) {
			elements.renameName.setAttribute("aria-invalid", "true");
			setRenameStatus(validation.error, true);
			return;
		}
		elements.renameName.removeAttribute("aria-invalid");
		if (!validation.changed) {
			closeRenameEditor();
			return;
		}

		renameSubmitting = true;
		renameOperationVersion += 1;
		const operation = renameOperationVersion;
		setRenameStatus("Checking controller settings…");
		updateRenameAvailability();

		let preflight;
		try {
			preflight = await requestJSON("/json/info", {}, 2000);
		} catch (error) {
			if (operation !== renameOperationVersion) return;
			renameSubmitting = false;
			setRenameStatus(`Could not verify controller settings: ${error.message}`, true);
			updateRenameAvailability();
			return;
		}
		if (operation !== renameOperationVersion) return;
		const preflightName = rawControllerName(preflight);
		if (preflightName === null) {
			currentInfo = preflight;
			renameSubmitting = false;
			renderInfo();
			setRenameStatus("Controller name status is unavailable. Refresh before renaming.", true);
			return;
		}
		if (preflightName !== renameSourceRawName) {
			currentInfo = preflight;
			renameSubmitting = false;
			renameConflict = true;
			renderInfo();
			setRenameStatus("The controller name changed before saving. Close and reopen the editor.", true);
			return;
		}
		if (typeof preflight.simplifiedui !== "boolean") {
			currentInfo = preflight;
			renameSubmitting = false;
			renderInfo();
			setRenameStatus("Simplified UI status is unavailable. Refresh before renaming.", true);
			return;
		}

		const body = new URLSearchParams();
		body.set("DS", validation.name);
		if (preflight.simplifiedui) body.set("SU", "on");
		body.set("CTRID", renameRequestId());
		let submissionError = null;
		let accepted = false;
		setRenameStatus("Saving controller name…");
		try {
			await requestResponse("/settings/ui", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
				body: body.toString()
			}, 8000);
			accepted = true;
		} catch (error) {
			submissionError = error;
		}
		if (operation !== renameOperationVersion) return;

		const verification = await model.verifyReadOnly(
			() => requestJSON("/json/info", {}, 2000),
			info => renameMatchesInfo(info, validation.name, preflight.simplifiedui),
			{ attempts: 4, initialDelayMilliseconds: 120, delayMilliseconds: 300 }
		);
		if (operation !== renameOperationVersion) return;
		renameSubmitting = false;
		if (verification.confirmed) {
			currentInfo = verification.value;
			renameMutationUncertain = false;
			renameExpectedName = "";
			renameExpectedSimplifiedUI = null;
			renameSourceName = validation.name;
			renameSourceRawName = validation.name;
			renderInfo();
			closeRenameEditor();
			toast("Controller name saved");
			return;
		}

		const rejectedStatus = Number(submissionError?.status);
		if (!accepted && (rejectedStatus === 401 || rejectedStatus === 403 || rejectedStatus === 404)) {
			setRenameStatus(rejectedStatus === 401
				? "Controller settings are locked. Unlock them under Security & Updates, then try again."
				: rejectedStatus === 404
					? "Controller rename is unavailable on this firmware."
					: "The controller rejected the rename request.", true);
			updateRenameAvailability();
			return;
		}

		renameMutationUncertain = true;
		renameExpectedName = validation.name;
		renameExpectedSimplifiedUI = preflight.simplifiedui;
		setRenameStatus(accepted
			? "The name was accepted but could not be verified. Refresh before trying again."
			: `The rename was not confirmed${submissionError ? `: ${submissionError.message}` : ""}. Refresh before trying again.`, true);
		updateRenameAvailability();
	}

	async function refresh(showSuccess = false) {
		if (pendingMutations || pickerInputActive || presetWritePending || presetApplyPending || renameSubmitting) return;
		const version = mutationVersion;
		const generation = stateGeneration;
		const renameVersion = renameOperationVersion;
		const checkStartupConfiguration = showSuccess || !stateLoaded;
		if (showSuccess || !Object.keys(currentState).length) setConnection("", "Connecting");
		try {
			const snapshot = await requestJSON("/json");
			const presets = await requestJSON("/presets.json");
			const startupExpected = startupPresetUncertainId;
			let startupConfigurationConsistent = true;
			let startupConfigurationKnown = !checkStartupConfiguration;
			let startupRequestMatched = true;
			if (checkStartupConfiguration) {
				try {
					const config = await requestJSON(`/cfg.json?refresh=${presetOperationVersion}-${Date.now()}`, {}, 1500);
					startupConfigurationConsistent = model.startupPresetConfigurationIsUsable(
						snapshot.info?.leds?.bootps, config?.def?.ps, presets);
					startupConfigurationKnown = true;
					if (startupPresetUncertainId != null) {
						startupRequestMatched = model.startupPresetMatchesConfiguration(
							snapshot.info?.leds?.bootps, config?.def?.ps, startupPresetUncertainId, presets);
					}
				} catch (_) {
					startupConfigurationConsistent = false;
					startupConfigurationKnown = false;
					startupRequestMatched = false;
				}
			}
			if (pendingMutations || pickerInputActive || presetWritePending || presetApplyPending || renameSubmitting
				|| version !== mutationVersion || generation !== stateGeneration || renameVersion !== renameOperationVersion) return;
			currentInfo = snapshot.info || {};
			let renameRefreshResolution = null;
			if (showSuccess && renameMutationUncertain) {
				renameRefreshResolution = renameMatchesInfo(
					currentInfo, renameExpectedName, renameExpectedSimplifiedUI) ? "confirmed" : "not-confirmed";
				renameMutationUncertain = false;
				renameExpectedName = "";
				renameExpectedSimplifiedUI = null;
				renameSourceName = controllerName(currentInfo);
				renameSourceRawName = rawControllerName(currentInfo);
				renameConflict = false;
			}
			const rawEffects = Array.isArray(snapshot.effects) ? snapshot.effects : [];
			const nextEffectCatalogSignature = JSON.stringify(rawEffects);
			if (nextEffectCatalogSignature !== effectCatalogSignature) {
				effectCatalogSignature = nextEffectCatalogSignature;
				effectCatalogLength = rawEffects.length;
				effectMetadata = null;
			}
			effectCatalog = rawEffects;
			effects = model.orderedEffectEntries(effectCatalog, effectMetadata);
			palettes = model.orderedCatalogEntries(snapshot.palettes);
			presetData = presets || {};
			presetsLoaded = true;
			if (checkStartupConfiguration) startupConfigurationInvalid = !startupConfigurationConsistent;
			if (showSuccess) {
				structuralMutationUncertain = false;
				if (startupExpected == null || startupConfigurationKnown) {
					presetMutationUncertain = false;
					presetSubmissionBlocked = false;
					if (startupConfigurationKnown) startupPresetUncertainId = null;
				}
				segmentEditorConflict = false;
				presetEditorConflict = false;
				resetSegmentResetConfirmation(false);
			}
			confirmedTargetSelectionVersion = targetSelectionVersion;
			renderInfo();
			if (renameRefreshResolution === "confirmed") closeRenameEditor();
			else if (renameRefreshResolution === "not-confirmed") {
				setRenameStatus(`The controller still reports “${controllerName()}”. Review the name and save again if wanted.`, true);
				updateRenameAvailability();
			}
			applyState(snapshot.state || {}, true);
			loadEffectMetadata();
			setConnection("online", "Connected");
			if (checkStartupConfiguration) setPresetStatus(startupConfigurationInvalid
				? "Startup preset storage is inconsistent or references a missing preset. Save a valid preset with Use at startup to repair it."
				: "", startupConfigurationInvalid);
			if (showSuccess) {
				const startupValue = Number(snapshot.info?.leds?.bootps);
				toast(!startupConfigurationConsistent
					? startupExpected != null
						? "Controller data refreshed, but startup preset storage is inconsistent or unavailable. Changes remain locked."
						: "Controller data refreshed, but startup preset storage needs repair before preset deletion or a non-startup save."
					: !startupRequestMatched && startupExpected != null
						? `Controller refreshed. Startup preset is ${startupValue}; requested preset ${startupExpected} was not confirmed. Retry the save if needed.`
						: "Controller refreshed",
					!startupConfigurationConsistent || (!startupRequestMatched && startupExpected != null));
			}
		} catch (error) {
			setConnection("offline", "Unavailable");
			toast(`Could not reach controller: ${error.message}`, true);
		}
	}

	function connectWebSocket() {
		if (socket && socket.readyState < WebSocket.CLOSING) return;
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		socket = new WebSocket(`${protocol}//${window.location.host}${route("/ws")}`);
		socket.onopen = () => setConnection("online", "Live");
		socket.onmessage = event => {
			if (typeof event.data !== "string" || pendingMutations || pickerInputActive || segmentStructureBusy() || presetWritePending || presetApplyPending) return;
			try {
				const payload = JSON.parse(event.data);
				if (payload.state) applyState(payload.state);
				else if (Object.prototype.hasOwnProperty.call(payload, "on")) applyState(payload);
				if (payload.info) {
					currentInfo = payload.info;
					renderInfo();
				}
			} catch (_) { /* Binary live-preview frames are intentionally ignored. */ }
		};
		socket.onclose = () => {
			setConnection("", "Reconnecting");
			setTimeout(connectWebSocket, 2500);
		};
		socket.onerror = () => socket.close();
	}

	function commitHexInput() {
		const context = endColorInteraction();
		const hex = normalizeHex(elements.colorHex.value);
		if (!hex) {
			elements.colorHex.setAttribute("aria-invalid", "true");
			toast("Enter a six-digit hex color, such as #FFB547.", true);
			return;
		}
		elements.colorHex.removeAttribute("aria-invalid");
		if (picker) picker.color.set(hex);
		else updateColorPresentation(hex);
		commitPickerColor(hexToRgb(hex), context);
	}

	function previewColorValue() {
		beginColorInteraction();
		const value = Number(elements.colorValue.value);
		elements.colorValueValue.value = `${Math.round(value)}%`;
		if (picker) {
			picker.color.setChannel("hsv", "v", value);
			return;
		}
		const rgb = hexToRgb(pendingPickerHex);
		const maximum = Math.max(rgb.r, rgb.g, rgb.b);
		const target = value * 2.55;
		const scale = maximum ? target / maximum : 0;
		const adjusted = maximum
			? { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale }
			: { r: target, g: target, b: target };
		updateColorPresentation(rgbToHex(adjusted));
	}

	function previewColorTemperature() {
		beginColorInteraction();
		const kelvin = Math.max(1900, Math.min(10091, Math.round(Number(elements.colorTemperature.value) || 6550)));
		elements.colorTemperatureValue.value = `${kelvin} K`;
		const rgb = model.kelvinToRgb(kelvin);
		if (picker) picker.color.set({ kelvin });
		else updateColorPresentation(rgbToHex(rgb));
	}

	function previewWhiteChannel() {
		beginColorInteraction();
		elements.whiteChannelValue.value = String(clampChannel(elements.whiteChannel.value));
	}

	function previewWhiteBalance() {
		beginColorInteraction();
		elements.whiteBalanceValue.value = String(clampChannel(elements.whiteBalance.value));
	}

	function bindControls() {
		elements.settingsLink.href = route("/settings");
		elements.deviceName.addEventListener("click", openRenameEditor);
		elements.renameForm.addEventListener("submit", submitControllerRename);
		elements.renameCancel.addEventListener("click", () => closeRenameEditor());
		elements.renameName.addEventListener("input", () => {
			elements.renameName.removeAttribute("aria-invalid");
			if (!renameMutationUncertain && !renameConflict) setRenameStatus("Use up to 25 characters and 32 UTF-8 bytes.");
		});
		elements.renameName.addEventListener("keydown", event => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			closeRenameEditor();
		});
		elements.power.addEventListener("click", () => {
			if (!batchSegmentCreationIsOpen()) sendState({ on: !Boolean(currentState.on) });
		});
		elements.brightness.addEventListener("input", () => { elements.brightnessValue.value = percent(elements.brightness.value); });
		elements.brightness.addEventListener("change", () => {
			if (!batchSegmentCreationIsOpen()) sendState({ bri: Number(elements.brightness.value) });
		});
		elements.colorExpand.addEventListener("click", () => setColorPanelExpanded(elements.colorExpandedControls.hidden));
		elements.effect.addEventListener("change", () => {
			if (effectChangePending) return;
			const effectId = Number(elements.effect.value);
			renderEffectControls(effectId);
			const request = sendSegmentState({ fx: effectId, fxdef: true });
			effectChangePending = true;
			renderSegments();
			request.finally(() => {
				effectChangePending = false;
				renderState();
			});
		});
		elements.palette.addEventListener("change", () => sendSegmentState({ pal: Number(elements.palette.value) }));
		elements.speed.addEventListener("input", () => { elements.speedValue.value = percent(elements.speed.value); });
		elements.speed.addEventListener("change", () => sendSegmentState({ sx: Number(elements.speed.value) }));
		elements.intensity.addEventListener("input", () => { elements.intensityValue.value = percent(elements.intensity.value); });
		elements.intensity.addEventListener("change", () => sendSegmentState({ ix: Number(elements.intensity.value) }));
		elements.custom1.addEventListener("input", () => { elements.custom1Value.value = elements.custom1.value; });
		elements.custom1.addEventListener("change", () => sendSegmentState({ c1: Number(elements.custom1.value) }));
		elements.custom2.addEventListener("input", () => { elements.custom2Value.value = elements.custom2.value; });
		elements.custom2.addEventListener("change", () => sendSegmentState({ c2: Number(elements.custom2.value) }));
		elements.custom3.addEventListener("input", () => { elements.custom3Value.value = elements.custom3.value; });
		elements.custom3.addEventListener("change", () => sendSegmentState({ c3: Number(elements.custom3.value) }));
		elements.option1.addEventListener("change", () => sendSegmentState({ o1: elements.option1.checked }));
		elements.option2.addEventListener("change", () => sendSegmentState({ o2: elements.option2.checked }));
		elements.option3.addEventListener("change", () => sendSegmentState({ o3: elements.option3.checked }));
		for (const button of colorSlotButtons) {
			button.addEventListener("click", () => selectColorSlot(button.dataset.colorSlot));
		}
		elements.colorHex.addEventListener("focus", beginColorInteraction);
		elements.colorHex.addEventListener("change", () => {
			if (hexEnterCommitted) {
				hexEnterCommitted = false;
				return;
			}
			commitHexInput();
		});
		elements.colorHex.addEventListener("blur", () => {
			hexEnterCommitted = false;
			if (pickerInputActive) endColorInteraction();
		});
		elements.colorHex.addEventListener("keydown", event => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			hexEnterCommitted = true;
			commitHexInput();
			elements.colorHex.blur();
		});
		elements.colorValue.addEventListener("input", previewColorValue);
		elements.colorValue.addEventListener("change", () => {
			const color = picker ? picker.color.rgb : hexToRgb(pendingPickerHex);
			commitPickerColor(color, endColorInteraction());
		});
		elements.colorTemperature.addEventListener("input", previewColorTemperature);
		elements.colorTemperature.addEventListener("change", () => {
			const rgb = model.kelvinToRgb(elements.colorTemperature.value);
			commitPickerColor(rgb, endColorInteraction());
		});
		elements.whiteChannel.addEventListener("input", previewWhiteChannel);
		elements.whiteChannel.addEventListener("change", () => {
			const context = endColorInteraction();
			const patch = model.colorSlotPatch(context.slot, { w: elements.whiteChannel.value });
			if (patch) sendSegmentState(patch, context.targetIds);
		});
		elements.whiteBalance.addEventListener("input", previewWhiteBalance);
		elements.whiteBalance.addEventListener("change", () => {
			const context = endColorInteraction();
			sendSegmentState({ cct: clampChannel(elements.whiteBalance.value) }, context.targetIds);
		});
		elements.selectAllSegments.addEventListener("click", selectAllSegments);
		elements.addSegment.addEventListener("click", event => handleAddSegment(event.currentTarget));
		elements.segmentEditor.addEventListener("submit", submitSegmentLayout);
		elements.cancelSegment.addEventListener("click", () => closeSegmentEditor());
		for (const cancel of document.querySelectorAll("[data-cancel-segment]")) cancel.addEventListener("click", () => closeSegmentEditor());
		elements.deleteSegment.addEventListener("click", deleteEditedSegment);
		elements.resetSegments.addEventListener("click", resetSegmentLayout);
		for (const field of [elements.segmentName, elements.segmentStart, elements.segmentEnd,
			elements.segmentGrouping, elements.segmentSpacing, elements.segmentOffset]) {
			field.addEventListener("input", markSegmentDraftDirty);
		}
		elements.segmentPower.addEventListener("change", () => setSegmentPower(segmentEditorId, elements.segmentPower.checked));
		elements.segmentReverse.addEventListener("change", () => sendImmediateSegmentPatch({ rev: elements.segmentReverse.checked }));
		elements.segmentMirror.addEventListener("change", () => {
			updateSegmentLength();
			sendImmediateSegmentPatch({ mi: elements.segmentMirror.checked });
		});
		elements.segmentBrightness.addEventListener("input", () => {
			segmentBrightnessInputActive = true;
			elements.segmentBrightnessValue.value = percent(elements.segmentBrightness.value);
		});
		elements.segmentBrightness.addEventListener("change", () => {
			segmentBrightnessInputActive = false;
			sendImmediateSegmentPatch({ bri: Number(elements.segmentBrightness.value) });
		});
		elements.segmentBrightness.addEventListener("blur", () => {
			segmentBrightnessInputActive = false;
			reconcileSegmentEditor();
		});
		elements.addPreset.addEventListener("click", event => openPresetEditor(null, event.currentTarget));
		elements.presetEditor.addEventListener("submit", submitPreset);
		elements.cancelPreset.addEventListener("click", () => closePresetEditor());
		for (const cancel of document.querySelectorAll("[data-cancel-preset]")) cancel.addEventListener("click", () => closePresetEditor());
		elements.deletePreset.addEventListener("click", deleteManagedPreset);
		for (const field of [elements.presetName, elements.presetId, elements.presetBrightness,
			elements.presetBounds, elements.presetStartup]) {
			field.addEventListener("input", markPresetDraftDirty);
		}
		elements.presetSelectedOnly.addEventListener("input", () => {
			markPresetDraftDirty();
			updatePresetSelectionSummary();
		});
		elements.refresh.addEventListener("click", () => refresh(true));
		elements.swatches.addEventListener("click", event => {
			const button = event.target.closest("button[data-color]");
			if (!button || button.disabled) return;
			const hex = normalizeHex(button.dataset.color);
			const context = currentColorCommandContext();
			if (picker) picker.color.set(hex);
			else updateColorPresentation(hex);
			if (hex === "#000000") {
				const patch = model.colorSlotPatch(context.slot, { r: 0, g: 0, b: 0, w: 0 });
				if (patch) sendSegmentState(patch, context.targetIds);
				return;
			}
			commitPickerColor(hexToRgb(hex), context);
		});
		window.addEventListener("castletek:pagechange", () => {
			if (pickerInputActive || pickerTouchGesture) discardPendingColorInteraction();
			if (picker && !pickerInputActive) picker.resize(pickerWidth());
			fitDeviceName();
		});
		window.addEventListener("resize", () => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				if (picker && !pickerInputActive) picker.resize(pickerWidth());
				fitDeviceName();
			}, 120);
		});
		elements.colorPicker.addEventListener("touchstart", handlePickerTouchStart, { capture: true, passive: false });
		elements.colorPicker.addEventListener("touchmove", handlePickerTouchMove, { capture: true, passive: false });
		elements.colorPicker.addEventListener("touchend", handlePickerTouchEnd, { capture: true, passive: false });
		elements.colorPicker.addEventListener("touchcancel", handlePickerTouchCancel, { capture: true, passive: true });
		elements.colorPicker.addEventListener("mousedown", suppressPickerCompatibilityMouse, true);
		elements.colorPicker.addEventListener("click", suppressPickerCompatibilityMouse, true);
		document.addEventListener("touchstart", cancelPickerOnMultitouch, { capture: true, passive: true });
		document.addEventListener("touchmove", cancelPickerOnMultitouch, { capture: true, passive: true });
		window.addEventListener("scroll", handlePickerPageScroll, { passive: true });
		document.addEventListener("touchcancel", cancelPickerInteraction, { passive: true });
		document.addEventListener("pointercancel", cancelPickerInteraction, { passive: true });
		window.addEventListener("blur", cancelPickerInteraction);
	}

	bindControls();
	refresh().then(loadColorPicker).then(() => {
		connectWebSocket();
		setInterval(() => refresh(false), 15000);
	});
})();
