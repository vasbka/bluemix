/*eslint-env node*/
var Log = require("../../utils/log"),
    nodePath = require("path"),
    nodeUtil = require("util"),
    ttyjs = require("tty.js");
var DEBUG = Log.DEBUG,
    TTYServer = ttyjs.Server;

module.exports = function(options) {
    var port = options.port,
        origins = options.origins;
    if (!port || !origins)
        throw new Error("Missing port or origins");

    // Extend tty.Server to override middleware setup
    function MyServer() {
        this.canonical = options.canonical;
        return TTYServer.apply(this, arguments);
    }
    nodeUtil.inherits(MyServer, TTYServer);
    MyServer.prototype.initMiddleware = function() {
        // Inject first middleware, handling root URL without a trailing slash. term.js
        // uses relative paths that 404 when served without the trailing slash, so we
        // must redirect the client to the correct base URL.
        var _self = this;
        this.use(function(req, res, next) {
            if (req.url === "/" && req.originalUrl === "") {
                res.redirect(301, _self.canonical);
                return;
            }
            next();
        });
        return TTYServer.prototype.initMiddleware.apply(this, arguments);
    };

    var app = new MyServer({
         shell: "bash",
         port: port,
         log: DEBUG,
         io: {
             log: DEBUG,
             origins: origins,
         },
         debug: DEBUG,
         "static": nodePath.join(__dirname, "public"),
    });
    return app;
};
