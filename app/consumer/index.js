/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var path = require("path");
var common = require('evergram-common');
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var sqs = common.aws.sqs;
var imageManager = common.image.manager;
var printManager = common.print.manager;
var userManager = common.user.manager;
var filesUtil = common.utils.files;
var logger = common.utils.logger;
var config = require('../config');

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
    sqs.getMessage(sqs.QUEUES.PRINT, {WaitTimeSeconds: config.sqs.waitTime}).then(function (results) {
        if (!!results[0].Body && !!results[0].Body.id) {
            var id = message.Body.id;

            printManager.find({criteria: {'_id': id}}).then((function (imageSet) {
                if (imageSet != null) {
                    /**
                     * Get the user for the image set even though we have an embedded one.
                     */
                    userManager.find({'_id': imageSet.user._id}).
                    then(function (user) {
                        if (!!user) {
                            //save images and zip
                            this.saveFilesAndZip(user, imageSet).
                            then((function (file) {
                                logger.info('Successfully zipped files for ' + user.getUsername());

                                this.saveFileToS3(file, user.getUsername()).
                                then(function () {
                                    return deleteMessageFromQueue(results[0]);
                                }).
                                then(function () {
                                    //update the image set to printed
                                    imageSet.isPrinted = true;

                                    printManager.save(imageSet).
                                    then(resolve);
                                });
                            }).bind(this));
                        } else {
                            logger.error('Could not find user ' + imageSet.user);
                            deleteMessageFromQueue(results[0]).then(resolve);
                        }
                    });
                } else {
                    deleteMessageFromQueue(results[0]).then(resolve);
                }
            }).bind(this));
        } else {
            logger.info('No messages on queue');
            resolve();
        }
    }, function (err) {
        logger.info('No messages on queue');
        /**
         * No messages or error, so just resolve and we'll check again
         */
        resolve();
    });

    return deferred.promise;
};

Consumer.prototype.saveFileToS3 = function (file, dir) {
    logger.info('Saving file ' + file + ' to S3');

    var filename = config.s3.folder + '/' + dir + '/' + path.basename(file);
    return s3.create(file, {
        bucket: s3Bucket,
        key: filename,
        acl: 'public-read'
    });
};

/**
 * Saves all images from an image set in a local temp directory.
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|Q.promise}
 */
Consumer.prototype.saveFiles = function (user, imageSet) {
    var deferred = q.defer();
    var imagesDeferred = [];
    var imageSets = imageSet.images;
    var localImages = [];
    var userDir = getUserDirectory(user);

    logger.info('Saving images for ' + user.getUsername());

    _.forEach(imageSets, function (images, service) {
        if (images.length > 0 && !!user[service]) {
            var filename = formatFileName(user, imageSet) + '-';

            _.forEach(images, function (image, i) {
                var imgDeferred = q.defer();
                imagesDeferred.push(imgDeferred.promise);

                //TODO change the legacy file name when we automate the printing
                //var imgFileName = filename + i;
                var imgFileName = legacyFormatFileName(user, image.src.raw);
                imageManager.saveFromUrl(image.src.raw, imgFileName, userDir).
                then(function (savedFilepath) {
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
        logger.info('Found ' + localImages.length + ' images for ' + user.getUsername());
        deferred.resolve(localImages);
    });

    return deferred.promise;
};

/**
 * Saves all images from an image set locally and then zips them up.
 *
 * Resolves with the zipped filepath.
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|Q.promise}
 */
Consumer.prototype.saveFilesAndZip = function (user, imageSet) {
    var deferred = q.defer();
    var userDir = getUserDirectory(user);

    this.saveFiles(user, imageSet).then((function (localImages) {
        if (localImages.length > 0) {
            this.zipFiles(user, imageSet, localImages).
            then(function (savedZipFile) {
                filesUtil.deleteFromTempDirectory(userDir);
                deferred.resolve(savedZipFile);
            }, function (err) {
                logger.error(err);
            });
        } else {
            filesUtil.deleteFromTempDirectory(userDir);
            deferred.resolve();
        }
    }).bind(this));

    return deferred.promise;
};

/**
 * Generates a readme.txt with address, links and images.
 *
 * @param user
 * @param imageSet
 */
Consumer.prototype.getReadMeForPrintableImageSet = function (user, imageSet) {
    var filename = user.getUsername() + '-readme';
    var dir = user.getUsername();

    var setUser = imageSet.user;
    var textImages = '';
    var textLinks = '';
    var textAddress = '';
    var text = '';
    var lineEnd = "\n";

    _.forEach(imageSet.images, function (images, service) {
        _.forEach(images, function (image) {
            //TODO This is too specific to instagram. We should look to normalize this.
            textImages += image.src.raw + lineEnd;
            textLinks += image.metadata.link + lineEnd;
        });
    });

    _.forEach(setUser.address, function (value, key) {
        if (!!value) {
            textAddress += _.trim(value) + lineEnd;
        }
    });

    text += "User:" + lineEnd;
    text += setUser.firstName + " " + setUser.lastName + lineEnd;
    text += setUser.email + lineEnd;
    text += setUser.instagram.username + lineEnd + lineEnd;
    text += "Address:" + lineEnd;
    text += textAddress + lineEnd + lineEnd;
    text += "Links:" + lineEnd;
    text += textLinks + lineEnd + lineEnd;
    text += "Images:" + lineEnd;
    text += textImages + lineEnd + lineEnd;

    return filesUtil.createTextFile(text, filename, dir);
}

/**
 * Zips up the past files.
 *
 * Resolves with the zip filepath.
 *
 * @param user
 * @param imageSet
 * @param localImages
 * @returns {*}
 */
Consumer.prototype.zipFiles = function (user, imageSet, localImages) {
    logger.info('Zipping ' + localImages.length + ' images for ' + user.getUsername());

    var filename = formatFileName(user, imageSet);
    var files = localImages || [];

    //add read me to zip
    var readMe = this.getReadMeForPrintableImageSet(user, imageSet);
    files.push({
        filepath: readMe,
        name: path.basename(readMe)
    });

    return filesUtil.zipFiles(files, filename);
};

/**
 * Gets a nicely formatted file name
 *
 * @param user
 * @param imageSet
 * @returns {string}
 */
function formatFileName(user, imageSet) {
    return user.getUsername() + '-' + moment(imageSet.date).format("YYYY-MM-DD");
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
 * Convenience function to delete a message from the SQS.
 *
 * @param result
 * @returns {*}
 */
function deleteMessageFromQueue(result) {
    return sqs.deleteMessage(sqs.QUEUES.PRINT, result);
}

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer;