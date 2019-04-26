/*eslint no-process-exit:0, no-empty:0*/
/*eslint-env node*/
/*eslint no-process-exit:0 */
var Server = require("./tty"),
    URLRewriter = require("../../utils/url-rewriter"),
    nodeUrl = require("url");
var ttyport,
    proxyRoute,
    origins;

// Get arguments
(function() {
    var args = process.argv.slice(2);
    var prefix = args[0];
    ttyport = parseInt(args[1], 10);
    proxyRoute = "/" + prefix;

    if (!ttyport || !prefix) {
        console.error("Usage: " + process.argv.slice(0, 2).join(" ") + " [TTY_PREFIX] [TTY_PORT]");
        process.exit(1);
    }

    var vcap_app = {}, app_uris;
    try {
        vcap_app = JSON.parse(process.env.VCAP_APPLICATION);
    } catch (e) {}
    app_uris = vcap_app.uris;
    if (!Array.isArray(app_uris)) {
        console.error("VCAP_APPLICATION.uris is not set. Refusing to launch.");
        process.exit(1);
    }

    origins = [];
    app_uris.forEach(function(hostname) {
        var lcHostname = hostname.toLowerCase();
        origins.push(nodeUrl.format({ protocol: "http",  hostname: hostname,   port: 80 }));
        origins.push(nodeUrl.format({ protocol: "http",  hostname: lcHostname, port: 80 }));
        origins.push(nodeUrl.format({ protocol: "https", hostname: hostname,   port: 443 }));
        origins.push(nodeUrl.format({ protocol: "https", hostname: lcHostname, port: 443 }));
    });
}());


// Create & start the servers
var ttyapp = Server({
    port: ttyport,
    canonical: proxyRoute + "/", // canonical URL has trailing slash
    origins: origins.join(" ")
});
ttyapp.listen(ttyport);

// For TTY.js, since it does not support being run as middleware at /{prefix}/shell, we strip off the leading
// segments manually by modifying the request URL.
URLRewriter(proxyRoute).attach(ttyapp.server);
