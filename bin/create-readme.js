/**
 * Module dependencies
 */
process.env.TZ = 'UTC';

var _ = require('lodash');
var common = require('evergram-common');
var printManager = common.print.manager;
var userManager = common.user.manager;
var printConsumer = require('../app/consumer');
var logger = common.utils.logger;

//init db
common.db.connect();

var options = {criteria: {'user.instagram.username': 'jacq1313'}};
//var options = {};

//backfill
logger.info('Finding print');
printManager.find(options).then(function(imageSet) {
    userManager.find({criteria: {_id: imageSet.user._id}}).
        then(function(user) {
            printConsumer.getReadMeForPrintableImageSet(user, imageSet);
        });
});