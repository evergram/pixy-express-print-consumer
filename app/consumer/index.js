/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var path = require("path");
var common = require('evergram-common');
var config = require('../config');
var trackingManager = require('../tracking');
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var sqs = common.aws.sqs;
var emailManager = common.email.manager;
var imageManager = common.image.manager;
var printManager = common.print.manager;
var userManager = common.user.manager;
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
    var failed = function (err) {
        deferred.reject(err);
    };

    /**
     * Query SQS to get a message
     */
    sqs.getMessage(sqs.QUEUES.PRINT, {WaitTimeSeconds: config.sqs.waitTime}).
    then((function (results) {
        if (!!results[0].Body && !!results[0].Body.id) {
            var message = results[0];
            var id = message.Body.id;

            var deleteMessageAndResolve = function () {
                deleteMessageFromQueue(message).then(resolve);
            };
            var deleteMessageAndFail = function (err) {
                deleteMessageFromQueue(message).then(function () {
                    failed(err);
                });
            };

            var deleteZipFile = function (file) {
                filesUtil.deleteFile(file);
                logger.info('Deleted the temp zip file ' + file);
            };

            printManager.find({criteria: {'_id': id}}).
            then((function (imageSet) {
                if (imageSet != null) {
                    logger.info('Successfully found image set: ' + imageSet._id);

                    /**
                     * Get the user for the image set even though we have an embedded one.
                     */
                    userManager.find({criteria: {'_id': imageSet.user._id}}).
                    then((function (user) {
                        if (!!user) {
                            logger.info('Successfully found the image set user: ' + user.getUsername());

                            //save images and zip
                            this.saveFilesAndZip(user, imageSet).
                            then((function (file) {
                                if (!!file) {
                                    logger.info('Successfully zipped files for ' + user.getUsername());

                                    this.saveFileToS3(file, user.getUsername()).
                                    then((function (s3File) {
                                        logger.info('Successfully saved files to S3 files for ' + user.getUsername());

                                        //update the image set to printed
                                        imageSet.isPrinted = true;
                                        imageSet.inQueue = false;
                                        imageSet.zipFile = s3File.Location;

                                        //track
                                        trackPrintedImageSet(user, imageSet);

                                        //send an email to printer
                                        return this.sendEmailToPrinter(user, imageSet);
                                    }).bind(this)).
                                    then(function () {
                                        //delete zip
                                        deleteZipFile(file);

                                        printManager.save(imageSet).
                                        then(deleteMessageAndResolve);
                                    }).
                                    fail(deleteMessageAndFail).
                                    done();
                                } else {
                                    logger.info('No files to save for ' + user.getUsername());

                                    //track
                                    trackPrintedImageSet(user, imageSet);

                                    //delete zip
                                    deleteZipFile(file);

                                    //update the image set to printed
                                    imageSet.isPrinted = true;
                                    printManager.save(imageSet).
                                    then(deleteMessageAndResolve);
                                }
                            }).bind(this)).
                            fail(deleteMessageAndFail).
                            done();
                        } else {
                            logger.error('Could not find user ' + imageSet.user);
                            deleteMessageAndResolve();
                        }
                    }).bind(this)).
                    fail(failed).
                    done();
                } else {
                    deleteMessageAndResolve();
                }
            }).bind(this)).
            fail(failed).
            done();
        } else {
            logger.info('No messages on queue');
            resolve();
        }
    }).bind(this)).
    fail(failed).
    done();

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
    var text = '';
    var lineEnd = '\n';

    _.forEach(imageSet.images, function (images, service) {
        _.forEach(images, function (image) {
            //TODO This is too specific to instagram. We should look to normalize this.
            textImages += image.src.raw + lineEnd;
            textLinks += image.metadata.link + lineEnd;
        });
    });

    text += 'User:' + lineEnd;
    text += formatUser(setUser) + lineEnd + lineEnd;
    text += 'Address:' + lineEnd;
    text += formatAddress(setUser) + lineEnd + lineEnd;

    return filesUtil.createTextFile(text, filename, dir);
};

/**
 * Sends an email to the configured printer.
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|q.promise|*}
 */
Consumer.prototype.sendEmailToPrinter = function (user, imageSet) {
    var deferred = q.defer();

    if (!!config.printer.sendEmail && config.printer.sendEmail !== 'false') {
        var toEmail = config.printer.emailTo;
        var fromEmail = config.printer.emailFrom;
        var startDate = moment(imageSet.startDate).format('DD-MM-YYYY');
        var endDate = moment(imageSet.endDate).format('DD-MM-YYYY');

        var subject = 'Images ready for print for ' + user.getUsername() + ' - ' + startDate;
        var message = 'Images are ready to print for ' + user.getUsername() + ' for the period from ' + startDate + ' to ' + endDate + '<br><br>';

        message += '<strong>User:</strong><br>';
        message += formatUser(imageSet.user, '<br>') + '<br><br>';
        message += '<strong>Address:</strong><br>'
        message += formatAddress(imageSet.user, '<br>') + '<br><br>';
        message += '<strong>Image set</strong>:<br>';
        message += '<a href="' + imageSet.zipFile + '">' + imageSet.zipFile + '</a>';

        logger.info('Sending email to ' + toEmail + ' from ' + fromEmail + ' for ' + user.getUsername());

        emailManager.send(toEmail, fromEmail, subject, message).then(function (result) {
            deferred.resolve(result);
        }, function (err) {
            deferred.reject(err);
        });
    } else {
        deferred.resolve();
    }

    return deferred;
};

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
 * Tracks the event
 *
 * @param user
 * @param imageSet
 */
function trackPrintedImageSet(user, imageSet) {
    if (!!config.track && config.track !== 'false') {
        trackingManager.trackPrintedImageSet(user, imageSet);
    }
}

/**
 * Formats the user for the readme and email
 *
 * @param user
 * @param lineEnd
 * @returns {string}
 */
function formatUser(user, lineEnd) {
    var text = '';
    if (!lineEnd) {
        lineEnd = '\n';
    }

    text += _.trim(user.firstName) + ' ' + _.trim(user.lastName) + lineEnd;
    text += _.trim(user.email) + lineEnd;
    text += '@' + _.trim(user.instagram.username);

    return text;
}

/**
 * Formats the address for the readme and email
 *
 * @param user
 * @param lineEnd
 * @returns {string}
 */
function formatAddress(user, lineEnd) {
    var text = '';
    if (!lineEnd) {
        lineEnd = '\n';
    }

    text += _.trim(user.address.line1) + lineEnd;
    if (!_.isEmpty(user.address.line2)) {
        text += _.trim(user.address.line2) + lineEnd;
    }
    text += _.trim(user.address.suburb) + lineEnd;
    text += _.trim(user.address.state) + ', ' + _.trim(user.address.postcode) + lineEnd;
    text += _.trim(user.address.country);

    return text;
}

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