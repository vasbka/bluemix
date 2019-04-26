/*eslint-env node*/
/*eslint no-unused-params:0, no-unused-vars:0 */
var express = require("express");
var path = require("path");
var bodyParser = require("body-parser");
var createToolsRouter = require("./routes/tools");
var oneHour = 3600000;

function sendError(err, req, res) {
    var message = (err && err.message) || "Internal error";
    if (req.accepts("json")) {
        var json = {};
        json.message = message;
        json.status = err.status || 500;
        if (err.stack)
            json.stack = err.stack;
        res.json(json);
        return;
    }
    // fallback to HTML
    var status = err && err.status;
    var h = [
        "<!DOCTYPE html>",
        "<html>", 
        "<h1>" + message + "</h1>",
        (status) ? "<h2>" + status + "</h2>" : "",
        (err.stack) ? "<pre>" + err.stack + "</stack>" : "",
        "</html>"
    ];
    res.send(h.join("\n"));
}

function createDevApp(options) {
    var app = express();
    app.use(bodyParser.json());
    app.use("/tools", createToolsRouter(options));
    app.use(express.static(path.join(__dirname, "public"), { maxAge: oneHour }));

    // catch 404 and forward to error handler
    app.use(function(req, res, next) {
        var err = new Error("Not Found");
        err.status = 404;
        next(err);
    });

    // error handlers

    // development error handler - will print stacktrace
    if (app.get("env") === "development") {
        app.use(function(err, req, res, next) {
            res.status(err.status || 500);
            sendError(err, req, res);
        });
    }

    // production error handler - no stacktraces leaked to user
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        if (err) {
            delete err.stack;
        }
        console.error(err);
        sendError(err, req, res);
    });

    return app;
}

module.exports = createDevApp;
