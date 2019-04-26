/*eslint-env node*/
var log = require("./log");

/**
 * Chops off /{prefix} from incoming request URIs.
 * @param {string|array} prefix The prefix(es) to remove
 */
function URLRewriter(prefix) {
    if (!(this instanceof URLRewriter))
        return new URLRewriter(prefix); // call as constructor
    if (!prefix)
        throw new Error("Missing prefix");
    this.prefixes = Array.isArray(prefix) ? prefix : [prefix];
}
URLRewriter.prototype.EVENT_TYPES = ["request", "upgrade", "checkContinue", "connect"];
/**
 * Rewrite URLs for the given server.
 * @param {http.Server|https.Server} server
 */
URLRewriter.prototype.attach = function(server) {
    this.EVENT_TYPES.forEach(this.patchListeners.bind(this, this.prefixes, server));
    return this;
};
/**
 * @param {http.Server} server
 * @param {checkContinue|connect|request|upgrade} type An event type that delivers ServerRequest to listeners.
 */
URLRewriter.prototype.patchListeners = function(prefixes, server, type) {
    var listeners = server.listeners(type).slice();
    server.removeAllListeners(type);
    var _self = this;
    listeners.unshift(function(req/*, ..*/) {
        var rewrote = false;
        for (var i = 0, len = prefixes.length; i < len; i++) {
            var prefix = prefixes[i];
            if (req.url.indexOf(prefix) === 0) {
                log.debug("rewrite " + req.url + " to " + req.url.substring(prefix.length));
                req.url = req.url.substring(prefix.length);
                rewrote = true;
                break;
            }
        }
        if (rewrote) {
            _self.postRewrite(req);
        } else {
            log.debug(" did not rewrite: " + req.url);
        }
    });
    listeners.forEach(server.on.bind(server, type));
};
/**
 * Optional. Called after a URL has been rewritten. Can be overridden to perform any additional logic.
 * @param {ServerRequest} request
 */
URLRewriter.prototype.postRewrite = function(/*req*/) {};

module.exports = URLRewriter;
