/*eslint-env node*/
/*eslint no-process-exit:0 no-unused-params:0*/
/**
 * Server that hosts the dev console.
 *
 * Supported environment variables:
 *   BLUEMIX_DEV_CONSOLE_TOOLS: JSON array of handler names to monitor in the dev console.
 *   BLUEMIX_DEV_CONSOLE_HIDE: JSON array of buttons to hide on the dev console page. (optional)
 *   BLUEMIX_DEV_CONSOLE_START_TIMEOUT: Time in ms console will wait when starting/restarting runtime.
 */
var createDevApp = require("../app"),
    express = require("express");

var port,
    tools,
    hiddenButtons,
    appPort,
    startTimeout,
    proxyRoute;

function parseArray(str) {
    try {
        var a = JSON.parse(str);
        if (Array.isArray(a))
            return a;
    } catch (e) {}
    return null;
}

// Parse arguments & environment vars.
(function() {
    var args = process.argv.slice(2);
    var prefix = args[0];
    port = parseInt(args[1], 10);

    // Note assumptions here: that the proxyAgent runs on process.env.PORT and the app runtime on PORT+1.)
    appPort = parseInt(process.env.PORT, 10) + 1;
    tools = parseArray(process.env.BLUEMIX_DEV_CONSOLE_TOOLS) || [];
    hiddenButtons = parseArray(process.env.BLUEMIX_DEV_CONSOLE_HIDE) || [];
    startTimeout = parseInt(process.env.BLUEMIX_DEV_CONSOLE_START_TIMEOUT, 10);
    proxyRoute = "/" + prefix;

    if (!port || !prefix) {
        throw new Error("Usage: " + process.argv.slice(0, 2).join(" ") + " PREFIX DEV_CONSOLE_PORT");
    }
    if (isNaN(appPort)) {
        throw new Error("Missing PORT environment variable.");
    }
}());

var app = express();
app.set("env", process.env.NODE_ENV || "production");
app.use(proxyRoute, createDevApp({
    appPort: appPort,
    tools: tools,
    hiddenButtons: hiddenButtons,
    startTimeout: startTimeout
}));
app.listen(port);
