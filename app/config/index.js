/**
 * Module dependencies.
 */

var _ = require('lodash');
var config = require('evergram-common').config;
var development = require('./env/development');
var test = require('./env/test');
var production = require('./env/production');

/**
 * Expose
 */

function Config() {
    var localConfig = {
        development: development,
        test: test,
        production: production
    }[process.env.NODE_ENV || 'development'];

    return _.merge(localConfig, config);
}

module.exports = exports = new Config;
