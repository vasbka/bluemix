/*eslint-env node*/
var child_process = require("child_process"),
    Q = require("q"),
    FS = require("fs"),
    nodePath = require("path"),
    nodeUtil = require("util"),
    logger = require("../../../utils/log");

var handlersDir = nodePath.join(__dirname, "../../");
var scriptsDir = nodePath.join(__dirname, "../../../scripts");
var utilsDir = nodePath.join(__dirname, "../../../utils");

var logDebug = logger.debug.bind(logger),
    logInfo = logger.log.bind(logger);

var START_WAIT_INITIAL = 300;
var START_POLL = 2000;
var START = "start", STOP = "stop", STARTING = "starting";
var RUNTIME = "runtime";

function logError(err) {
    if (err && err.stack) {
        console.error(err.stack);
    } else {
        console.error.apply(console, arguments);
    }
}

/**
 * Manages the state of tools and the runtime.
 */
function ToolController(options) {
    if (!(this instanceof ToolController)) {
        return new ToolController();
    }
    this.appPort = options.appPort;
    this.tools = options.tools;
    this.startTimeout = isNaN(Number(options.startTimeout)) ? 2000 : Number(options.startTimeout);

    if (!this.appPort || isNaN(this.appPort))
        throw new Error("appPort must be provided");
    if (!Array.isArray(this.tools))
        throw new Error("tools must be provided");
    if (this.startTimeout < 0)
        throw new Error("Invalid startTimeout");
}
/**
 * @resolves {Tool[]} All tools plus the runtime
 */
ToolController.prototype.all = function() {
    var runtime = this.getRuntime();
    var _self = this;
    return Q.all([runtime].concat(this.tools.map(function(tool) {
        return _self.get(tool.name);
    })));
};
/**
 * @resolves {Tool} or null if the tool was not found.
 */
ToolController.prototype.get = function(toolName) {
    var tool;
    this.tools.some(function(t) {
        if (t.name === toolName) {
            return !!(tool = t);
        }
    });
    if (!tool) {
        return Q(null);
    }
    var statePromise = (toolName === RUNTIME) ? this.getRuntimeState() : this.getState(toolName);
    return statePromise.then(function(state) {
        return {
            name: toolName,
            label: tool.label,
            state: state || "unknown",
        };
    }).catch(function(error) {
        logError(error);
        return null;
    });
};
/**
 * @resolves {Tool} the runtime.
 */
ToolController.prototype.getRuntime = function() {
    return Q.spread([this.getRuntimeState(), this.getMarkerState()], function(state, marker) {
        return {
            name: RUNTIME,
            label: RUNTIME,
            state: state || "unknown",
            "live-edit": marker
        };
    }).catch(function(error) {
        logError(error);
        return null;
    });
};

/**
 * Gets the state of a tool (or if toolOrRuntime === "runtime" is passed, the runtime).
 * @private
 * @resolves {string} START|STOP|STARTING
 * @rejects if an error occurred trying to determine the state.
 */
ToolController.prototype.getState = function(tool) {
    if (tool === RUNTIME)
        throw new Error("Call #getRuntimeState()");
    var checker = nodePath.join(utilsDir, "./tool-state"),
        pidfile = this._pidfileName(tool),
        runfile = runfileName(tool);
    // ${utilsDir}/tool-state [pidfile] [runfile]
    var command = nodeUtil.format("%s %s", checker, pidfile, runfile); 
    return promisedExec(command).then(function(stdio) {
        // Resolve: exit code 0
        return [null].concat(stdio);
    }, function(error) {
        // Rejected: exit code not 0
        return [error];
    }).then(function(args) { // [error?, stdout, stderr]
        var error = args instanceof Error ? args : args[0],
            stdout = args[1], stderr = args[2];
        stdout && logInfo(stdout);
        stderr && logError(stderr);
        if (error && error.code === 1) {
            return STOP;     // exited with 1 - tool is stopped
        } else if (error && error.code === 2) {
            return STARTING; // exited with 2 - tool is starting
        } else if (!error) {
            return START;    // exited with 0 - tool is running
        } else {
            throw error; // unknown error determining the state
        }
    });
};
ToolController.prototype.getRuntimeState = function() {
    var checker = nodePath.join(scriptsDir, "check_runtime_available");
    var command = nodeUtil.format("%s %s", checker, this.appPort);
    return promisedExec(command).then(function(/*stdio*/) {
        return START;
    }, function(error) {
        logDebug(error.message);
        if (/pass me a port/.test(error.message))
            throw error; // Should never happen
        return STOP;
    });
};
/**
 * Starts a request to enable or disable the shell or tty.
 * @resolves {undefined} Resolves if the request was dispatched.
 * @rejects if an error occurred
 */
ToolController.prototype.changeToolState = function(toolName, newState) {
    if (newState !== STOP && newState !== START) {
        var error = new Error("Unknown state: " + newState);
        error.status = 400;
        throw error;
    }
    logInfo("Changing %s to '%s'", toolName, newState);
    var command = nodePath.join(handlersDir, nodeUtil.format("%s-%s/run", newState, toolName));
    // Command format:
    // ../../handlers/start-{tool}/run
    // ../../handlers/stop-{tool}/run
    var _self = this;
    return promisedSpawnDetached(command, []).then(function() {
        return _self._assertToolState(toolName, newState);
    });
};
/**
 * (Re)starts or stops the app runtime.
 * @param {boolean} breakOnStart When app is being debugged, pass 'true' to make app break immediately upon starting.
 * @resolves {Tool}
 * @rejects {Error}
 */
ToolController.prototype.changeRuntimeState = function(newState, breakOnStart) {
    // Throws on a non-0 exit code
    function handleNonZeroExit(exitCode) {
        if (exitCode !== 0) {
            var err = new Error(nodeUtil.format("Failed to %s the app runtime.", newState));
            err.status = 500;
            throw err;
        }
    }

    var _self = this;
    var command, error;
    var startTime = Date.now();
    if (newState === STOP) {
        // Usage: ${handlersDir}/stop-app/run
        // Stop handler exits immediately, so wait for it to finish.
        command = nodePath.join(handlersDir, "stop-app/run");
        return promisedSpawnDetached(command).then(handleNonZeroExit).then(function() {
            return _self._assertToolState(RUNTIME, STOP).then(function(runtime) {
                logDebug("Runtime stopped after %s seconds", toSecs(Date.now() - startTime));
                return runtime;
            });
        });
    } else if (newState === START) {
        // First determine the current state
        return this.getRuntimeState().then(function(state) {
            if (state === STOP) {
                // Usage: ${handlersDir}/start-app/run PORT [break|no-break]
                command = nodePath.join(handlersDir, "./start-app/run");
            } else if (state === START || state === STARTING) {
                // Usage: ${handlersDir}/restart-app/run PORT [break|no-break]
                command = nodePath.join(handlersDir, "./restart-app/run");
            } else {
                error = new Error("Unrecognized state: " + state);
                error.status = 500;
                throw error;
            }
            var breakArg = breakOnStart ? "break" : "no-break";
            var start = Q.defer(), resolve = start.resolve.bind(start), reject = start.reject.bind(start);
            promisedSpawnDetached(command, [_self.appPort, breakArg]).then(handleNonZeroExit).then(null, reject);

            // Optimistically check if the runtime has started after `START_WAIT_INITIAL` ms. If not started,
            // begin polling every `START_POLL` ms until timeout period `_self.startTimeout` has elapsed.
            // Note we do not assume that the handler exits; since upon a successful start, handler remains
            // running for the lifespan of the runtime process.
            var timeoutMessage = nodeUtil.format("App did not start. Waited %s seconds", toSecs(_self.startTimeout));
            var startOrTimeout = start.promise.timeout(_self.startTimeout, timeoutMessage);
            Q.delay(START_WAIT_INITIAL).then(function check() {
                _self._assertToolState(RUNTIME, START).then(function(runtime) {
                    logDebug("Runtime came up after %s seconds.", toSecs(Date.now() - startTime));
                    resolve(runtime);
                }, function() {
                    // Not started, keep polling unless the timeout has fired already
                    if (startOrTimeout.isPending()) {
                        logDebug("Runtime not up yet, scheduling another check...");
                        Q.delay(START_POLL).then(check);
                    } else {
                       logDebug("Start timed out after %s seconds.", toSecs(Date.now() - startTime));
                    }
                });
            });
            return startOrTimeout;
        });
    } else {
        error = new Error("Unknown state: " + newState);
        error.status = 400;
        return Q.reject(error);
    }
};

/**
 * @private
 * @resolves {Tool} if the state matches what is expected
 * @rejects If state is not as expected
 */
ToolController.prototype._assertToolState = function(toolName, newState) {
    var promise;
    if (toolName === RUNTIME)
        promise = this.getRuntime();
    else
        promise = this.get(toolName);
    return promise.then(function(tool) {
        if (!tool || tool.state !== newState) {
            var err = new Error(nodeUtil.format("Failed to change state of %s to \"%s\"", toolName, newState));
            err.status = 500;
            throw err;
        }
        return tool;
    });
};

ToolController.prototype._pidfileName = function(toolName) {
    // Otherwise the pattern is app_management/handlers/start-{name}/{name}.pid
    return nodePath.join(handlersDir, nodeUtil.format("./start-%s/%s.pid", toolName, toolName));
};

/**
 * Checks the state of the special .live-edit marker file.
 * @resolves true if marker file exists, false if it does not exist.
 * @rejects If some error occurred
 */
ToolController.prototype.getMarkerState = function() {
    var path = nodePath.join(process.env.HOME, ".live-edit");
    return Q.nfcall(FS.stat, path).then(function(/*stats*/) {
        return true;
    }, function(error) {
        if (error.code === "ENOENT") {
            return false; // resolve
        }
        logError(error);
        throw error; // reject with error
    });
};

function runfileName(toolName) {
    return nodePath.join(handlersDir, nodeUtil.format("./start-%s/run", toolName));
}

/**
 * Spawns the command then detaches from the child. The child inherits the parent's stdout and stderr streams.
 * @resolves {int} when the child has exited with no error
 * @rejects {Error} when an error event is generated
 */
function promisedSpawnDetached(command, args) {
    logDebug("spawn: " + command + " " + (Array.isArray(args) ? args : [args]).join(" "));
    var child = child_process.spawn(command, args, {
        detached: true,
        stdio: ["ignore", 1, 2] // no stdin
    });
    child.unref();

    var d = Q.defer();
    // First one to fire (error or exit) fulfills the promise. Any later firings are no-ops.
    child.on("error", d.reject.bind(d));
    child.on("exit", d.resolve.bind(d));
    return d.promise;
}

/**
 * Returns a promise for exec()'ing the given command
 * @param {string} command The command, with space-separated arguments.
 * @resolves {string} stdout captured from process
 * @rejects {Error}
 */
var qpromisedExec = Q.nbind(child_process.exec, child_process);
function promisedExec(cmd) {
    logDebug("exec: " + cmd);
    return qpromisedExec.apply(null, arguments);
}

/**
 * @param {int} ms Time in ms
 * @returns {string} Time in seconds, rounded to 2 decimal places
 */
function toSecs(ms) {
    return (ms / 1000.0).toFixed(2);
}

module.exports = ToolController;