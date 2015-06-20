'use strict';

/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var path = require('path');
var fs = require('fs');
var Jsftp = require('jsftp');
var common = require('evergram-common');
var config = require('../config');
var trackingManager = require('../tracking');
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var emailManager = common.email.manager;
var imageManager = common.image.manager;
var printManager = common.print.manager;
var userManager = common.user.manager;
var filesUtil = common.utils.files;
var logger = common.utils.logger;

/**
 * A consumer that handles all of the consumers
 *
 * //TODO we should probably split this up into more services so they can be unit tested.
 *
 * @constructor
 */
function Consumer() {
}

Consumer.prototype.consume = function(message) {
    var currentImageSet;
    var currentUser;
    var currentZipFile;

    /**
     * Query SQS to get a message
     */
    return getImageSet(message.data.id).
        then(function(imageSet) {
            currentImageSet = imageSet;

            return getUser(currentImageSet.user._id);
        }).
        then(function(user) {
            currentUser = user;

            return saveImagesAndZip(currentUser, currentImageSet);
        }).
        then(function(zipFile) {
            currentZipFile = zipFile;

            return saveZipToS3(zipFile, currentUser.getUsername());
        }).
        then(function(s3File) {
            //save the file url
            currentImageSet.zipFile = decodeURIComponent(s3File.Location);

            //stamp the user
            currentImageSet.user = currentUser;

            //finalize the set
            currentImageSet.isPrinted = true;

            //track
            trackPrintedImageSet(currentUser, currentImageSet);

            return sendToPrinter(currentUser, currentImageSet, currentZipFile);
        }).
        finally(function() {
            return cleanUp(currentImageSet, currentZipFile);
        });
};

/**
 * Clean up the queue, image set and zip file at any stage of the consume process.
 *
 * @param message
 * @param imageSet
 * @param zipFile
 * @returns {*}
 */
function cleanUp(imageSet, zipFile) {
    var deferreds = [];

    if (!!imageSet) {
        imageSet.inQueue = false;
        deferreds.push(printManager.save(imageSet));
    }

    if (!!zipFile) {
        logger.info('Deleting the temp zip file ' + zipFile);
        filesUtil.deleteFile(zipFile);
    }

    return q.all(deferreds);
}

Consumer.prototype.cleanUp = cleanUp;

/**
 * Gets the printable image set from the database.
 *
 * @param id
 * @returns {*}
 */
function getImageSet(id) {
    return printManager.find({criteria: {_id: id}}).
        then(function(imageSet) {
            if (imageSet !== null) {
                logger.info('Successfully found image set: ' + imageSet._id);
                return imageSet;
            } else {
                throw 'Could not find an image set for the id :' + id;
            }
        });
}

/**
 * Gets the user from the database.
 *
 * @param id
 * @returns {*}
 */
function getUser(id) {
    return userManager.find({criteria: {_id: id}}).
        then(function(user) {
            if (user !== null) {
                logger.info('Successfully found the image set user: ' + user.getUsername());
                return user;
            } else {
                throw 'Could not find a user for the id :' + id;
            }
        });
}

/**
 * Save the passed file to S3
 *
 * @param file
 * @param dir
 * @returns {file}
 */
function saveZipToS3(file, dir) {
    logger.info('Saving file ' + file + ' to S3');

    var filename = config.s3.folder + '/' + dir + '/' + path.basename(file);
    return s3.create(file, {
        bucket: s3Bucket,
        key: filename,
        acl: 'public-read'
    });
}

Consumer.prototype.saveZipToS3 = saveZipToS3;

/**
 * Saves all images from an image set in a local temp directory.
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|Q.promise}
 */
function saveImages(user, imageSet) {
    var deferred = q.defer();
    var imagesDeferred = [];
    var imageSets = imageSet.images;
    var localImages = [];
    var userDir = getUserDirectory(user);

    logger.info('Saving images for ' + user.getUsername());

    _.forEach(imageSets, function(images, service) {
        if (images.length > 0 && !!user[service]) {
            //var filename = getZipFileName(user, imageSet) + '-';

            _.forEach(images, function(image) {
                var imgDeferred = q.defer();
                imagesDeferred.push(imgDeferred.promise);

                //TODO change the legacy file name when we automate the printing
                //var imgFileName = filename + i;
                var imgFileName = legacyFormatFileName(user, image.src.raw);
                imageManager.saveFromUrl(image.src.raw, imgFileName, userDir).
                    then(function(savedFilepath) {
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

    q.all(imagesDeferred).
        then(function() {
            logger.info('Found ' + localImages.length + ' images for ' + user.getUsername());
            deferred.resolve(localImages);
        });

    return deferred.promise;
}

Consumer.prototype.saveImages = saveImages;

/**
 * Saves all images from an image set locally and then zips them up.
 *
 * Resolves with the zipped filepath.
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|Q.promise}
 */
function saveImagesAndZip(user, imageSet) {
    var userDir = getUserDirectory(user);

    return saveImages(user, imageSet).
        then(function(localImages) {
            if (localImages.length > 0) {
                return zipFiles(user, imageSet, localImages).
                    then(function(savedZipFile) {
                        filesUtil.deleteFromTempDirectory(userDir);
                        return savedZipFile;
                    }).
                    fail(function(err) {
                        throw err;
                    });
            } else {
                imageSet.isPrinted = true;
                filesUtil.deleteFromTempDirectory(userDir);
                throw 'No images in this set';
            }
        });
}

Consumer.prototype.saveImagesAndZip = saveImagesAndZip;

/**
 * Generates a readme.txt with address, links and images.
 *
 * @param user
 * @param imageSet
 */
function getReadMeForPrintableImageSet(user, imageSet) {
    var filename = user.getUsername() + '-readme';
    var dir = user.getUsername();

    var setUser = imageSet.user;
    var text = '';
    var lineEnd = '\n';

    text += moment(imageSet.endDate).format('DD-MM-YYYY') + lineEnd;
    text += formatUser(setUser);
    text += formatAddress(setUser);

    return filesUtil.createTextFile(text, filename, dir);
}

Consumer.prototype.getReadMeForPrintableImageSet = getReadMeForPrintableImageSet;

/**
 * Sens to printer
 *
 * @param user
 * @param imageSet
 * @returns {promise|*|q.promise|*}
 */
function sendToPrinter(user, imageSet, zipFile) {
    return q.all([
        sendToPrinterEmail(user, imageSet),
        sendToPrinterFtp(user, imageSet, zipFile)
    ]);
}

Consumer.prototype.sendToPrinter = sendToPrinter;

/**
 * Sends images to printer via ftp
 *
 * @param user
 * @param imageSet
 */
function sendToPrinterFtp(user, imageSet, zipFile) {
    var deferred = q.defer();

    if (!!config.printer.ftp.enabled && config.printer.ftp.enabled !== 'false') {
        logger.info('Preparing to upload to ftp: ' + config.printer.ftp.host);

        var ftp = new Jsftp({
            host: config.printer.ftp.host,
            user: config.printer.ftp.username,
            pass: config.printer.ftp.password,
            debugMode: true
        });

        //debugging
        ftp.on('jsftp_debug', function(eventType, data) {
            if (data) {
                logger.info('FTP: ' + eventType, data);
            } else {
                logger.info('FTP: ' + eventType);
            }
        });

        var filepath = getZipFileName(user, imageSet) + '.zip';

        q.ninvoke(ftp, 'put', fs.createReadStream(zipFile), filepath).
            then(function() {
                logger.info('FTP upload complete for ' + user.getUsername() + ' with the file ' + filepath);
                deferred.resolve();
            }).
            fail(function(err) {
                logger.error('FTP failed for ' + user.getUsername() + ' with the file ' + filepath, err);
                deferred.reject(err);
            });
    } else {
        logger.info('FTP is disabled');
        deferred.resolve();
    }

    return deferred.promise;
}

Consumer.prototype.sendToPrinterFtp = sendToPrinterFtp;

/**
 * Sends an email to the configured printer.
 *
 * @param user
 * @param imageSet
 * @returns {*}
 */
function sendToPrinterEmail(user, imageSet) {
    var deferred = q.defer();

    if (!!config.printer.email.enabled && config.printer.email.enabled !== 'false') {
        var toEmail = config.printer.email.to;
        var fromEmail = config.printer.email.from;
        var startDate = moment(imageSet.startDate).format('DD-MM-YYYY');
        var endDate = moment(imageSet.endDate).format('DD-MM-YYYY');

        var subject = 'Images ready for print for ' + user.getUsername() + ' - ' + startDate;
        var message = 'Images are ready to print for ' + user.getUsername() + ' for the period from ' + startDate +
            ' to ' + endDate + '<br><br>';

        message += formatUser(imageSet.user, '<br>');
        message += formatAddress(imageSet.user, '<br>') + '<br><br>';
        message += '<strong>Image set</strong>:<br>';
        message += '<a href="' + imageSet.zipFile + '">' + imageSet.zipFile + '</a>';

        logger.info('Sending email to ' + toEmail + ' from ' + fromEmail + ' for ' + user.getUsername());

        emailManager.send(toEmail, fromEmail, subject, message).
            then(function(result) {
                deferred.resolve(result);
            }).
            fail(function(err) {
                deferred.reject(err);
            });
    } else {
        deferred.resolve();
    }

    return deferred.promise;
}

Consumer.prototype.sendToPrinterEmail = sendToPrinterEmail;

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
function zipFiles(user, imageSet, localImages) {
    logger.info('Zipping ' + localImages.length + ' images for ' + user.getUsername());

    var filename = getZipFileName(user, imageSet);
    var files = localImages || [];

    //add read me to zip
    var readMe = getReadMeForPrintableImageSet(user, imageSet);
    files.push({
        filepath: readMe,
        name: path.basename(readMe)
    });

    return filesUtil.zipFiles(files, filename);
}

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

    text += '@' + _.trim(user.instagram.username) + lineEnd;
    text += _.trim(user.firstName) + ' ' + _.trim(user.lastName) + lineEnd;

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

function getS3ZipFilePath(user, imageSet) {
    return getUserDirectory(user) + '/' + getZipFileName(user, imageSet);
}

Consumer.prototype.getS3ZipFilePath = getS3ZipFilePath;

/**
 * Gets a nicely formatted file name
 *
 * @param user
 * @param imageSet
 * @returns {string}
 */
function getZipFileName(user, imageSet) {
    return user.getUsername() +
        '-' +
        moment(imageSet.startDate).format('YYYY-MM-DD') +
        '-to-' +
        moment(imageSet.endDate).format('YYYY-MM-DD');
}

Consumer.prototype.getZipFileName = getZipFileName;

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
    return user.getUsername();
}

Consumer.prototype.getUserDirectory = getUserDirectory;

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer();
