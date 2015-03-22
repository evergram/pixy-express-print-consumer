/**
 * Module dependencies.
 */

var development = require('./env/development');
var test = require('./env/test');
var production = require('./env/production');

/**
 * Expose
 */

function Config() {
    return {
        development: development,
        test: test,
        production: production
    }[process.env.NODE_ENV || 'development'];
}

module.exports = exports = new Config;
