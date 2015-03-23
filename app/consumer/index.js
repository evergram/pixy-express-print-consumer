/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var common = require('evergram-common');
var aws = common.aws;
var config = require('../config');
var imageManager = common.image.manager;
var printManager = common.print.manager;
var utils = common.utils;

/**
 * A consumer that handles all of the consumers
 *
 * @constructor
 */
function Consumer() {

}

Consumer.prototype.consume = function () {
    var deferred = q.defer();
    var resolve = function () {
        deferred.resolve();
    };

    /**
     * Query SQS to get a message
     */
    aws.sqs.getMessage(aws.sqs.QUEUES.INSTAGRAM, {WaitTimeSeconds: config.sqs.waitTime}).then(function (results) {
        if (!!results[0].Body && !!results[0].Body.id) {
            var id = message.Body.id;

            printManager.find({'_id': id}).then(function (printableImageSet) {
                if (printableImageSet != null) {

                } else {
                    resolve();
                }
            });
        } else {
            console.log('No messages on queue');
            resolve();
        }
    }, function (err) {
        console.log('No messages on queue');
        /**
         * No messages or error, so just resolve and we'll check again
         */
        resolve();
    });

    return deferred.promise;
};

Consumer.prototype.saveFiles = function (user, printableImageSet) {
    var deferred = q.defer();
    var imageSets = printableImageSet.images;
    _.forEach(imageSets, function (images, service) {
        var imagesDeferred = [];
        var filename = user.instagram.username + '-' + moment(printableImageSet.date).format("YYYY-MM-DD") + '-';

        _.forEach(images, function (image, i) {
            imagesDeferred.push(imageManager.saveFromUrl(image.src.raw, filename + i));
        });

        q.all(imagesDeferred).then(function () {
            console.log('all done');
            deferred.resolve();
        });
    });

    return deferred.promise;
};

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer;