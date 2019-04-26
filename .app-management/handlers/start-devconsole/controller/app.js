/*eslint-env node*/
var vcapApp;
try {
    vcapApp = JSON.parse(process.env.VCAP_APPLICATION);
} catch (e) {}

/**
 * Provides info about the Bluemix app
 */
function getInfo() {
    if (!vcapApp) {
        return null;
    }
    return {
        application_name: vcapApp.application_name,
        application_uris: vcapApp.application_uris,
    };
}

module.exports.getInfo = getInfo;