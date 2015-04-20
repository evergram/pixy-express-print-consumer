/**
 * Module dependencies
 */

process.env.TZ = 'UTC';

require('newrelic');
var app = require('./app');

/**
 * Expose
 */

module.exports = app;
