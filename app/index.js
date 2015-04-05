/**
 * Module dependencies.
 */

var _ = require('lodash');
var common = require('evergram-common');
var logger = common.utils.logger;
var config = require('./config');
var consumer = require('./consumer');

//init db
common.db.connect();

function run() {
    logger.info('Checking print queue');
    try {
        consumer.consume().then(function () {
            logger.info('Completed checking print queue');
            setTimeout(run, config.retryWaitTime * 1000);
            logger.info('Waiting ' + config.retryWaitTime + ' seconds before next check');
        }).fail(function (err) {
            if (!_.isEmpty(err)) {
                logger.info(err);
            }
            logger.info('Waiting ' + config.retryWaitTime + ' seconds before next check');
            setTimeout(run, config.retryWaitTime * 1000);
        }).done();
    } catch (err) {
        logger.error(err);
    }
}

//kick off the process
run();