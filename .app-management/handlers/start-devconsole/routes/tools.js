/*eslint-env node*/
/*eslint no-mixed-requires:0, no-unused-params:0, no-unused-vars:0 */
var express = require("express"),
    AppInfo = require("../controller/app"),
    ToolController = require("../controller/tools");

var RUNTIME = "runtime";

// Passes error up the middleware stack
function forwardError(next, error) {
    error.status = 500;
    next(error);
}

function createToolsRouter(options) {
    var toolController = new ToolController(options);
    var hiddenButtons = options.hiddenButtons;
    var router = express.Router();
    router.param("toolName", function(req, res, next, id) {
        var toolName = req.param("toolName");
        if (!toolName) {
            return res.sendStatus(400).end();
        }
        req.toolName = toolName;
        next();
    });

    // **************************************************************************
    // GET
    // **************************************************************************
    router.get("*", function(req, res, next) {
        // Prevent IE from using stale cached response http://stackoverflow.com/a/5084395/3394770
        res.set({
            "Expires": "-1",
            "Cache-Control": "must-revalidate, private",
        });
        next();
    });

    router.get("/", function(req, res, next) {
        toolController.all().then(function(tools) {
            res.send({
                vcap_application: AppInfo.getInfo(),
                tool: tools,
                hiddenButtons: hiddenButtons
            });
        }).catch(forwardError.bind(null, next));
    });

    router.get("/:toolName", function(req, res, next) {
        var promise = (req.toolName === RUNTIME) ? toolController.getRuntime() : toolController.get(req.toolName);
        promise.then(function(tool) {
            if (!tool) {
                return res.sendStatus(404);
            }
            res.send(tool);
        }).catch(forwardError.bind(null, next));
    });

    // **************************************************************************
    // PUT
    // **************************************************************************
    // All PUTs must include a request body with 'state' field
    router.put("*", function(req, res, next) {
        var body = req.body, newState = body && body.state;
        if (!body || !newState) {
            return res.sendStatus(400).end();
        }
        req.newState = newState;
        next();
    });

    // Start/stop the app runtime
    // TODO: deprecate this API, clients should use /IBMAGENT instead
    router.put("/runtime", function(req, res, next) {
        var newState = req.newState, body = req.body, breakOnStart = body.break;
        if (typeof breakOnStart === "undefined") {
            breakOnStart = false; // false if omitted
        }
        if (typeof breakOnStart !== "boolean") {
            return res.sendStatus(400).end();
        }
        toolController.changeRuntimeState(newState, breakOnStart).then(function(updated) {
            res.json(updated);
        }).catch(forwardError.bind(null, next));
    });

    // Enable/disable the shell or inspector
    router.put("/:toolName", function(req, res, next) {
        var toolName = req.toolName, newState = req.newState;
        toolController.changeToolState(toolName, newState).then(function(updated) {
            res.send(updated);
        }).catch(forwardError.bind(null, next));
    });

    return router;
}

module.exports = createToolsRouter;
