/**
 * Module dependencies.
 */

var _ = require('lodash');
var config = require('evergram-common').config;
var devConfig = require('./env/development');
var testConfig = require('./env/test');
var prodConfig = require('./env/production');

/**
 * Expose
 */

function Config() {
    var localConfig = {
        development: devConfig,
        test: testConfig,
        production: prodConfig
    }[process.env.NODE_ENV || 'development'];

    return _.merge(localConfig, config);
}

module.exports = exports = new Config();
