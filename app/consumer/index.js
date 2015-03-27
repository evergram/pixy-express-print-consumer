/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var path = require("path");
var common = require('evergram-common');
var aws = common.aws;
var config = require('../config');
var imageManager = common.image.manager;
var printManager = common.print.manager;
var filesUtil = common.utils.files;
var logger = common.utils.logger;

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

/**
 *
 * @param user
 * @param printableImageSet
 * @returns {promise|*|Q.promise}
 */
Consumer.prototype.saveFiles = function (user, printableImageSet) {
    var deferred = q.defer();
    var imagesDeferred = [];
    var imageSets = printableImageSet.images;
    var localImages = [];
    var userDir = getUserDirectory(user);

    _.forEach(imageSets, function (images, service) {
        if (images.length > 0 && !!user[service]) {
            var filename = formatFileName(user, printableImageSet) + '-';

            _.forEach(images, function (image, i) {
                var imgDeferred = q.defer();
                imagesDeferred.push(imgDeferred.promise);

                //TODO change the legacy file name when we automate the printing
                //var imgFileName = filename + i;
                var imgFileName = legacyFormatFileName(user, image.src.raw);
                imageManager.saveFromUrl(image.src.raw, imgFileName, userDir).then(function (savedFilepath) {
                    /**
                     * Add the saved file to all local images
                     */
                    localImages.push({
                        filepath: savedFilepath,
                        name: path.basename(savedFilepath)
                    });

                    imgDeferred.resolve();
                });
            });
        }
    });

    q.all(imagesDeferred).then(function () {
        deferred.resolve(localImages);
    });

    return deferred.promise;
};

/**
 *
 * @param user
 * @param printableImageSet
 * @returns {promise|*|Q.promise}
 */
Consumer.prototype.saveFilesAndZip = function (user, printableImageSet) {
    var deferred = q.defer();
    var userDir = getUserDirectory(user);

    this.saveFiles(user, printableImageSet).then((function (localImages) {
        if (localImages.length > 0) {
            this.zipFiles(user, printableImageSet, localImages).then(function (savedZipFile) {
                filesUtil.deleteFromTempDirectory(userDir);

                deferred.resolve(savedZipFile);
            });
        } else {
            filesUtil.deleteFromTempDirectory(userDir);

            deferred.resolve();
        }
    }).bind(this));

    return deferred.promise;
};

/**
 *
 * @param user
 * @param printableImageSet
 * @param localImages
 * @returns {*}
 */
Consumer.prototype.zipFiles = function (user, printableImageSet, localImages) {
    var filename = formatFileName(user, printableImageSet);
    return filesUtil.zipFiles(localImages, filename);
};

/**
 * Gets a nicely formatted file name
 *
 * @param user
 * @param printableImageSet
 * @returns {string}
 */
function formatFileName(user, printableImageSet) {
    return user.getUsername() + '-' + moment(printableImageSet.date).format("YYYY-MM-DD");
}

/**
 * @param user
 * @param imageSrc
 * @returns {string}
 */
function legacyFormatFileName(user, imageSrc) {
    return user.getUsername() + '-' + path.basename(imageSrc, path.extname(imageSrc));
}

/**
 * A user directory where we can store the user specific files
 *
 * @param user
 * @returns {string}
 */
function getUserDirectory(user) {
    return user.getUsername() + '/';
}

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer;