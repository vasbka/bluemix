/*eslint-env node*/
/*
 * Wrapper that controls logging from dev tools.
 *
 * #debug() output is only shown when environment var DEBUG_BLUEMIX_DEV is true.
 */
var Log = Object.create(null);

Log.DEBUG = /^true$/i.test(process.env.DEBUG_BLUEMIX_DEV || "");

Log.error = console.error.bind(console);

Log.log = console.log.bind(console);

Log.debug = function() {
    if (Log.DEBUG) {
        Log.log.apply(Log, arguments);
    }
};

module.exports = Log;