/*eslint-env */
/*global console document io tty*/
(function() {
	var WIN_LEFT = 10, WIN_TOP = 45,
	    initialTitle = "Shell";
	document.title = initialTitle;

//	// Does not work
//	// TODO try force 'reconnect': false
//	// https://github.com/Automattic/socket.io/issues/991#issuecomment-61945011
//	if (typeof io !== "undefined") {
//		console.log("forcing transports: websocket (was " + io.transports.join(',') + ")");
//		io.transports = ["websocket"];
//	}

	// Helpers
	function cancel(e) {
		if (e.preventDefault) e.preventDefault();
		e.returnValue = false;
		if (e.stopPropagation) e.stopPropagation();
		e.cancelBubble = true;
		return false;
	}

	function on(el, type, handler, capture) {
		el.addEventListener(type, handler, capture || false);
	}
	
	function inherits(child, parent) {
		function f() {
			this.constructor = child;
		}
		f.prototype = parent.prototype;
		child.prototype = new f();
	}

	// Keep NewTab button positioned after all tabs in window.
	function reorderNewTab(tab) {
		var btn = tab.window.button;
		btn.parentNode.insertBefore(btn, null);
	}

	/*
	 * Override TTY classes
	 */
	var Terminal = tty.Terminal, Tab = tty.Tab, Window = tty.Window;

	/**
	 * Tab: override click behavior, use extra elements, & classes (not hardcoded style)
	 */
	function BTab(win, socket) {
		var self = this, cols = win.cols, rows = win.rows;
		Terminal.call(this, { cols: cols, rows: rows });

		var button = document.createElement('div');
		button.className = "tab";
		button.innerHTML = ""; // remove ugly bullet
		this._createLabel(button);
		win.bar.appendChild(button);
		on(button, "mouseup", function(ev) {
			// Close button, or middle click, closes tab
			if (ev.button === 1 || ev.target.classList.contains("closetab")) {
				self.destroy();
			} else {
				self.focus();
			}
			return cancel(ev);
		});
		this.id = "";
		this.socket = socket || tty.socket;
		this.window = win;
		this.button = button;
		this.element = null;
		this.process = "";
		reorderNewTab(this);
		this.open();
		this.hookKeys();
		win.tabs.push(this);
		this.socket.emit("create", cols, rows, function(err, data) {
			if (err) return self._destroy();
			self.pty = data.pty;
			self.id = data.id;
			tty.terms[self.id] = self;
			self.setProcessName(data.process);
			tty.emit("open tab", self);
			self.emit("open");
		});
	}
	inherits(BTab, Tab);
	BTab.prototype._createLabel = function(button) {
		var inner = document.createElement("div"),
		    close = document.createElement("div");
		inner.className = "inner";
		close.className = "closetab";
		close.title = "Close Tab";
		button.appendChild(inner);
		button.appendChild(close);
		this.inner = inner;
	};
	// Update marker classes related to focus
	BTab.prototype._updateFocus = function() {
		var btn = this.button;
		this.window.tabs.forEach(function(otherTab) {
			otherTab.button.classList.remove("focus");
		});
		btn.classList.add("focus");
		btn.classList.remove("background-write");
	};
	BTab.prototype.focus = function() {
		if (Terminal.focus === this) return;
		var win = this.window, focused = win.focused;
		if (focused !== this) {
			if (focused) {
				if (focused.element.parentNode) {
					focused.element.parentNode.removeChild(focused.element);
				}
			}
			win.element.appendChild(this.element);
			win.focused = this;
			win.title.innerHTML = this.process;
			document.title = this.title || initialTitle;
			this._updateFocus();
		}
		this.handleTitle(this.title);
		this._focus();
		win.focus();
		tty.emit("focus tab", this);
		this.emit("focus");
	};
	BTab.prototype.setProcessName = function() {
		Tab.prototype.setProcessName.apply(this, arguments);
		// stash process name in the inner label
		this.inner.setAttribute("data-process", this.process);
	};
	BTab.prototype.write = function(data) {
		if (this.window.focused !== this) this.button.classList.add("background-write");
		return this._write(data);
	};

	/**
	 * Window: override to tweak window UI and create BTabs
	 */
	function BWindow() {
		Window.apply(this, arguments);
		// Rename mysterious "~"
		var btn = this.button;
		btn.title = "New Tab";
		btn.textContent = "";
		btn.classList.add("newtab");

		// Cascade
		var el = this.element, i = BWindow.prototype.count++,
		    docEl = document.documentElement, viewW = docEl.clientWidth, viewH = docEl.clientHeight;
		var left = WIN_LEFT + (i * 15) % (viewW - el.clientWidth  - 50),
		    top  = WIN_TOP  + (i * 15) % (viewH - el.clientHeight - 50);
		el.style.left = left + "px";
		el.style.top  = top + "px";
	}
	inherits(BWindow, Window);
	BWindow.prototype.count = 0;
	BWindow.prototype.createTab = function() {
		return new BTab(this, this.socket);
	};

	/**
	 * tty: patch 2 places that create Window to instead create BWindow
	 */
	tty.on("open", function() {
		tty.socket.removeAllListeners("sync");
		tty.socket.on("sync", function(terms) {
			console.log("Attempting to sync...");
			console.log(terms);
			tty.reset();
			var emit = tty.socket.emit;
			tty.socket.emit = function() {};
			Object.keys(terms).forEach(function(key) {
				var data = terms[key], win = new BWindow(), tab = win.tabs[0];
				delete tty.terms[tab.id];
				tab.pty = data.pty;
				tab.id = data.id;
				tty.terms[data.id] = tab;
				win.resize(data.cols, data.rows);
				tab.setProcessName(data.process);
				tty.emit("open tab", tab);
				tab.emit("open");
			});
			tty.socket.emit = emit;
		});
	});
	// Cannot detach existing listener from #open, so just replace #open
	var byId = document.getElementById.bind(document);
	var open = byId("open"), parent = open.parentNode;
	var open2 = document.createElement("button");
	open2.className = "open";
	open2.innerHTML = "<div class='plus'></div> New Window";
	parent.replaceChild(open2, open);
	on(open2, "click", function() {
		new BWindow();
	});
	open2.classList.add("show");

	tty.on("close tab", reorderNewTab);

	// tty: open shell at start
	tty.on("connect", function() {
		new BWindow();
	});
}());