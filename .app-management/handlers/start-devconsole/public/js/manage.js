/*eslint no-reserved-keys:0*/
/*eslint-env browser*/
/*global $ confirm*/
var suspended, hardRefresh;
var STRINGS = {
	noname: "Unknown app",
	running: "Your app is running.",
	not_running: "Your app is not running.",
	suspended: "Your app is suspended.",
	gotoDebug: "Visit the Debugger to continue.",
	enable: "Enable %s",
	open: "Open %s",
	enabling: "Enabling %s\u2026",
	unsupported: "Sorry, your browser is not supported. The debugger requires Google Chrome.\n\nContinue anyway?",
};

// Helpers
function fmt(s) {
	var args = arguments, len = arguments.length;
	var i = 1;
	return String.prototype.replace.call(s, /%s/g, function(match) {
		return i < len ? args[i++] : match;
	});
}

function _transformError(jqxhr) {
	var error;
	try {
		var json = JSON.parse(jqxhr.responseText);
		error = new Error(json.message);
		error.serverStack = json.stack;
	} catch (e) {
		error = new Error(jqxhr.statusText);
	}
	error.status = jqxhr.status;
	error.statusText = jqxhr.statusText;
	return new $.Deferred().reject(error); // TODO reject via throw
}

function checkCompat(e) {
	function isChrome() {
		// Also matches Opera/Blink
		return navigator.userAgent.match(/(?:chrome|crios|chromium)\/(\d+)/i) !== null;
	}
	if (!isChrome() && !localStorage.skipBrowserCheck) {
		if (confirm(STRINGS.unsupported)) {
			localStorage.skipBrowserCheck = true;
		} else {
			e.preventDefault && e.preventDefault();
		}
	}
}

function Model() {
	this.model = null;
}
// Build the UI model from the manage REST response
Model.prototype.load = function() {
	function toLabel(name) {
		return name && name[0].toUpperCase() + name.substr(1);
	}

	return $.ajax({
		type: "GET",
		url: "./tools/",
	}).then(function(resp) {
		var tools = resp.tool.map(function(json) {
			return {
				name: json.name,
				label: json.label || toLabel(json.name),
				state: json.state,
				started: (json.state === "start"),
				starting: (json.state === "starting"),
			};
		});

		var runtime;
		tools.some(function(tool, i) {
			if (tool.name === "runtime") {
				runtime = tool;
				tools.splice(i, 1);
				return true; // break
			}
		});

		var model = this.model = {};
		model.app = resp.vcap_application;
		model.hiddenButtons = resp.hiddenButtons;
		model.runtime = runtime;
		model.tools = tools;

		runtime.debugging = tools.some(function(tool) {
			return tool.name === "inspector" && tool.started;
		});
		runtime.running = runtime && runtime.state === "start";
		return model;
	}, _transformError);
};
Model.prototype.equals = function(other) {
	if (!other)
		return false;
	return JSON.stringify(other.model) === JSON.stringify(this.model);
};

function Controller() {}
Controller.prototype.enableTool = function(tool/*, event*/) {
	return $.ajax({
		type: "PUT",
		url: "./tools/" + tool.name,
		data: JSON.stringify({ state: "start" }),
		contentType: "application/json",
		processData: false,
	}).then(null, _transformError);
};
Controller.prototype.changeRuntimeState = function(button) {
	var shouldBreak = (button === "restart-break" || button === "start-break") ? true : false,
		state = (button === "stop") ? "stop": "start";
	return $.ajax({
		type: "PUT",
		url: "./tools/runtime",
		data: JSON.stringify({
			state: state,
			"break": shouldBreak,
		}),
		contentType: "application/json",
		processData: false,
	}).then(null, _transformError);
};

function UI(model, control) {
	this.model = model;
	this.control = control;
}
UI.prototype.runtimeButtons = ["restart", "restart-break", "start", "start-break", "stop"];
// Sets given element to .working while promise runs. Shows rejection in error DIV.
UI.prototype.showProgressWhile = function(promise, elem) {
	elem = $(elem);
	var HIDE = "disabled", WORKING = "working";
	var restore = function() {
		elem.removeClass(WORKING);
	};
	elem.addClass(WORKING).removeClass(HIDE);
	var error = $("#error").addClass(HIDE),
	    _self = this;
	return promise.then(function(value) {
		restore();
		error.addClass(HIDE);
		return value;
	}, function(e) {
		restore();
		_self.showResult("Error: " + e.message);
		return new $.Deferred().reject(e); // TODO reject via throw
	});
};
UI.prototype.showResult = function(text) {
	$("#error").text(text).removeClass("disabled");
};
UI.prototype.getVisibleButtons = function() {
	var buttons = this.runtimeButtons,
	    toShow = Object.create(null);
	var hide = function(/*ids*/) {
		for (var i = 0; i < arguments.length; i++) {
			delete toShow[arguments[i]];
		}
	};
	buttons.forEach(function(id) {
		toShow[id] = true;
	});
	// If !debugging, hide the 'break' buttons
	var runtime = this.model.runtime;
	if (!runtime.debugging) {
		hide("restart-break", "start-break");
	}
	if (runtime.running) {
		hide("start", "start-break");
	} else {
		hide("restart", "restart-break", "stop");
	}
	this.model.hiddenButtons.forEach(hide);
	return toShow;
};
UI.prototype.render = function() {
	function cap(s) {
		return typeof s === "string" ? s.charAt(0).toUpperCase() + s.slice(1) : null;
	}
	// Basic app info
	var app = this.model.app || {},
	    name = cap(app.application_name) || STRINGS.noname,
	    uri = app.application_uris[0];
	$("#app-name").text(name);
	$("#app-route-link").prop("href", uri ? "//" + uri : "../../").text(uri || name);

	// Runtime status
	var run = this.model.runtime.running,
	    clhide = "disabled",
	    state, clicon;
	if (run && !suspended) {
		state = STRINGS.running;
		clicon = "run";
	} else if (suspended) {
		state = STRINGS.suspended;
		clicon = "suspend";
		this.showResult(STRINGS.gotoDebug);
	} else {
		state = STRINGS.not_running,
		clicon = "stop";
	}
	$("#state").text(state).removeClass(clhide);
	$("#icon").removeClass(["run stop suspend"].join(" ")).addClass(clicon).removeClass(clhide);

	// Hide a subset of runtime controls depending on state.
	var visibleBtns = this.getVisibleButtons();
	this.runtimeButtons.forEach(function(id) {
		var element = $("#" + id);
		if (visibleBtns[id])
			element.prop("disabled", false).removeClass(clhide);
		else
			element.prop("disabled", true).addClass(clhide);
	});

	var control = this.control,
		_self = this;
	this.runtimeButtons.forEach(function(id) {
		var button = $("#" + id);
		button.off().on("click", function() {
			button.prop("disabled", true);
			$("#state,#icon").addClass(clhide);
			_self.showProgressWhile(control.changeRuntimeState(id), button).then(function() {
				// TODO 'suspended' should be explicit runtime state given by server. This is just a transient flag
				suspended = /-break$/.test(id);
			}).always(hardRefresh);
		});
	});

	// Tools
	this.model.tools.forEach(function(tool) {
		_self.renderTool(tool);
		var elem = $("#tool-" + tool.name),
		    title = $(".tool-label", elem), btn = $(".enable-tool", elem), link = $(".tool-link", elem), main = $(".tool", elem),
		    ON = "active",
		    enabling = fmt(STRINGS.enabling, tool.label);

		var toolState = tool.state;
		if (toolState === "start") {
			// stated -- create link, hide button
			title.text(fmt(STRINGS.open, tool.label)).removeClass(clhide);
			btn.addClass(clhide);
			main.addClass(ON);
			if (link.length === 0) {
				var toolUrl = "../" + tool.name + "/";
				link = $(document.createElement("a")).prop("href", toolUrl).prop("target", "_blank").addClass("tool-link");
				// FIXME hack for Node-Inspector compatibility warning.
				if (tool.name === "inspector") {
					link.off().on("click", checkCompat);
				}
				main.wrap(link);
			}
		} else if (toolState === "starting") {
			// starting -- remove link, hide button, show title as "Enabling {tool}"
			title.text(enabling).removeClass(clhide);
			btn.addClass(clhide);
			main.removeClass(ON);
			if (main.parent().is("a")) {
				main.unwrap();
			}
		} else {
			// stopped -- remove link, show button
			title.text(tool.label).addClass(clhide);
			btn.prop("disabled", false).removeClass(clhide);
			main.removeClass(ON);
			if (main.parent().is("a")) {
				main.unwrap();
			}
		}
		btn.off().on("click", function() {
			title.text(enabling).removeClass(clhide);
			btn.prop("disabled", true).addClass(clhide);
			_self.showProgressWhile(control.enableTool(tool)).always(hardRefresh);
		});
	});
};
// Create DOM elements for the tool if not already present
UI.prototype.renderTool = function(tool) {
	var id = "tool-" + tool.name;
	if ($("#" + id).length)
		return;
	$('<div class="flex-item tool-container">' +
		'<div class="tool">' +
			'<span class="tool-label"></span>' +
			'<button class="btn enable-tool disabled">' + fmt(STRINGS.enable, tool.label) + '</button>' +
			'<div class="arrow"></div>' +
		'</div>' +
	'</div>').attr("id", id).appendTo("#vert-stack");
};

// Main
var POLL_ACTIVE = 3000,
	POLL_PASSIVE = 30000;
var dom, mainmodel, old, ui, controller, timerId;
dom = $.Deferred();
controller = new Controller();
suspended = false; // whether suspend was the last user action

$(document).ready(dom.resolve.bind(dom));
// soft: redraw UI only if there was a change
function refresh(soft) {
	clearTimeout(timerId);
	mainmodel = new Model();
	$.when(mainmodel.load(), dom.promise()).then(function(model/*, dom*/) {
		if (!soft || !mainmodel.equals(old)) {
			old = mainmodel;
			ui = new UI(model, controller);
			ui.render();
			$(".flex-container").removeClass("disabled");
		}
		// Poll for refresh on a timer. If one of the tools is starting, poll faster
		var toolStart = model.tools.some(function(tool) { return tool.state === "starting"; }),
		    interval = toolStart ? POLL_ACTIVE : POLL_PASSIVE;
		var timer = $.Deferred();
		timerId = setTimeout(timer.resolve.bind(timer), interval);
		timer.then(refresh);
	});
}
hardRefresh = refresh.bind(null, false);
hardRefresh();