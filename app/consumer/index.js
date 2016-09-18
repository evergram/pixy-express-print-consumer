'use strict';

/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var q = require('q');
var path = require('path');
var url = require('url')
var fs = require('fs');
var Jsftp = require('jsftp');
var imgixClient = require('imgix-core-js');
var common = require('evergram-common');
var config = require('../config');
var trackingManager = require('../tracking');
var request = require('request');
var graphicsMagick = require('gm');
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var emailManager = common.email.manager;
var imageManager = require('../image');
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
    var currentOrder;
    var currentUser;
    var currentZipFile;

    // ### TODO: ALLOW ALTERNATIVE PROCESS FOR NON-AU PRINTING. (Another service? e.g. SQS message also contains country)
    /**
     * Query SQS to get a message
     */
    return getOrder(message.data.id).
        then(function(order) {
            currentOrder = order;

            return getUser(currentOrder.user_id);
        }).
        then(function(user) {
            currentUser = user;

            return saveImagesAndZip(currentUser, currentOrder);
        }).
        then(function(zipFile) {
            currentZipFile = zipFile;

            return saveZipToS3(zipFile, currentUser, currentOrder);
        }).
        then(function(s3File) {
            //save the file url
            currentOrder.zipFile = decodeURIComponent(s3File.Location);

            // update status
            currentOrder.status = 'printed';

            //track
            trackingManager.trackPrintedOrder(currentUser, currentOrder);

            return sendToPrinter(currentUser, currentOrder, currentZipFile);
        }).then(function() {
            // Update order in Stamplay
            return updateOrder(currentOrder);
        }).
        finally(function() {
            return cleanUp(currentOrder, currentZipFile);
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
function cleanUp(order, zipFile) {
    var deferreds = [];

    if (!!zipFile) {
        logger.info('Deleting the temp zip file ' + zipFile);
        filesUtil.deleteFile(zipFile);
    }

    return q.all(deferreds);
}

Consumer.prototype.cleanUp = cleanUp;

/**
 * Gets the order from stamplay.
 *
 * @param id
 * @returns {*}
 */
function getOrder(id) {
    var deferred = q.defer();
    var options = {
        url: 'https://pixy.stamplayapp.com/api/cobject/v1/order/' + id,
        headers: {
            'Authorization' : 'Basic cGl4eTplZDliZGJhY2Y2NmQwODY0MDMyMzg0NGY3MTdmMjk2NzVhYWU3ZGY3OWZlY2JlYTgzNzczZjdkZDkxMDQyZmU4'
        }
    };

    request(options, function(error, response, body) {

        if (!error && response.statusCode == 200) {
            var order = JSON.parse(body);
            logger.info('Successfully found order: ' + order._id);
            deferred.resolve(order);
        } else {
            deferred.reject('Could not find an order for the id :' + id + ', err: ' + error);
        }
    });

    return deferred.promise;
}
Consumer.prototype.getOrder = getOrder;

/**
 * Update the order in stamplay.
 *
 * @param order
 * @returns {*}
 */
function updateOrder(order) {
    var deferred = q.defer();
    logger.info('### start update order');

    // remove stamplay fields so their endpoint doesn't kickup a stink
    delete order.appId;
    delete order.__v;
    delete order.cobjectId;
    delete order.actions;
    delete order.id;

    var options = {
        url: 'https://pixy.stamplayapp.com/api/cobject/v1/order/' + order._id,
        headers: {
            'Authorization' : 'Basic cGl4eTplZDliZGJhY2Y2NmQwODY0MDMyMzg0NGY3MTdmMjk2NzVhYWU3ZGY3OWZlY2JlYTgzNzczZjdkZDkxMDQyZmU4'
        },
        json: true,
        body: order
    };

    request.put(options, function(error, response, body) {

        if (!error && response.statusCode == 200) {
            logger.info('Successfully udpated order: ' + body._id);
            deferred.resolve(body);
        } else {
            logger.error('### error updating order ' + error);
            deferred.reject('Could not update order for the id :' + order._id);
        }
    });

    return deferred.promise;
}
Consumer.prototype.updateOrder = updateOrder;

/**
 * Gets the user from stamplay.
 *
 * @param id
 * @returns {*}
 */
function getUser(id) {
    var deferred = q.defer();
    var options = {
        url: 'https://pixy.stamplayapp.com/api/user/v1/users/' + id,
        headers: {
            'Authorization' : 'Basic cGl4eTplZDliZGJhY2Y2NmQwODY0MDMyMzg0NGY3MTdmMjk2NzVhYWU3ZGY3OWZlY2JlYTgzNzczZjdkZDkxMDQyZmU4'
        }
    };
    request(options, function(error, response, body) {

        if (!error && response.statusCode == 200) {
            var user = JSON.parse(body);
            logger.info('Successfully found user: ' + user._id);
            deferred.resolve(user);
        } else {
            deferred.reject('Could not find user for the id :' + id);
        }
    });
    return deferred.promise;
}
Consumer.prototype.getUser = getUser;

/**
 * Save the passed file to S3
 *
 * @param file
 * @param dir
 * @returns {file}
 */
function saveZipToS3(file, user, imageSet) {
    logger.info('Saving file ' + file + ' to S3');

    var filename = getS3ZipFilePath(user, imageSet) + '/' + path.basename(file);
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
 * @param order
 * @returns {promise|*|Q.promise}
 */
function saveImages(user, order) {
    var deferred = q.defer();
    var imagesDeferred = [];
    var photos = order.photos;
    var localImages = [];
    var userDir = getUserDirectory(user, order);

    _.forEach(photos, function(image) {

        var imgDeferred = q.defer();
        imagesDeferred.push(imgDeferred.promise);

        var imageUrl;
        var printSize = image.printer_info.type;

        //TODO change the legacy file name when we automate the printing
        //var imgFileName = filename + i;
        var imgFileName = legacyFormatFileName(user, image.src);
        logger.info('### image src = ' + image.src);
        logger.info('### image filename = ' + imgFileName);
        // save image from s3 to determine dimensions
        imageManager.saveFromS3Url(image.src, imgFileName, userDir, 'order-' + order._id).
            then(function(filepath) {
                logger.info('### Getting image size ' + filepath);
                return getImageSize(filepath); // determine image size.
            }).
            then(function(size) {
                logger.info('### Getting imgix url');
                // generate appropriate imgix url
                imageUrl = getImgixUrl('express', printSize, image.src, size.width, size.height);

                logger.info('### imgix url is ' + imageUrl);
                // save image from imgix
                return imageManager.saveFromUrl(imageUrl, imgFileName, 'order-' + order._id + '/' + printSize);
            }).
            then(function(filepath) {

                logger.info('### imgix image saved, pushing to array');
                /**
                 * Add the saved file to all local images
                 */
                localImages.push({
                    filepath: filepath,
                    name: path.basename(filepath)
                });
                logger.info('### resolve imgDeferred');

                imgDeferred.resolve();
            })
            .fail( function(err) {
                logger.error('Error saving image: ' + err);
                imgDeferred.reject();
            });
    });

    q.all(imagesDeferred).
        then(function() {
            logger.info('Found ' + localImages.length + ' images for ' + user.displayName);
            deferred.resolve(localImages);
        });

    return deferred.promise;
}

Consumer.prototype.saveImages = saveImages;

/**
 * Saves all images from an order locally and then zips them up.
 *
 * Resolves with the zipped filepath.
 *
 * @param user
 * @param order
 * @returns {promise|*|Q.promise}
 */
function saveImagesAndZip(user, order) {
    var userDir = getUserDirectory(user, order);

    return saveImages(user, order).
        then(function(localImages) {
            if (localImages.length > 0) {
                return zipFiles(user, order, localImages).
                    then(function(savedZipFile) {
                        logger.info('### ZIP successfully saved to s3 ' + savedZipFile);
                        filesUtil.deleteFromTempDirectory('order-' + order._id);
                        return savedZipFile;
                    }).
                    fail(function(err) {
                        throw err;
                    });
            } else {
                filesUtil.deleteFromTempDirectory(userDir);
                throw 'No images in this set';
            }
        });
}

Consumer.prototype.saveImagesAndZip = saveImagesAndZip;


/**
 * Use graphicsMagick to detect the dimensions of the image.
 *
 * Resolves with object containing width & height of image.
 *
 * @param filename
 * @returns {promise|*|Q.promise}
 */
function getImageSize(filename) {
    var deferred = q.defer();

    graphicsMagick(filename)
        .size(function (err, size) {
            if (err) {
                logger.error('Error detecting image size for ' + filename + '.');
                logger.error('Error is ' + err);
                return deferred.reject(err);
            }

            // otherwise, return appropriate size based on config.
            deferred.resolve(size);
        });

    return deferred.promise;
}

/**
 * Generates a readme.txt with address, links and images.
 *
 * @param user
 * @param order
 */
function getReadMeForPrintableImageSet(user, order) {
    var filename = user.displayName + '-readme';
    var dir = 'order-' + order._id;

    var text = '';
    var lineEnd = '\n';

    text += formatUser('readme', user);
    text += formatAddress(order);

    return filesUtil.createTextFile(text, filename, dir);
}

Consumer.prototype.getReadMeForPrintableImageSet = getReadMeForPrintableImageSet;

/**
 * Sends to printer
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
 * @param order
 */
function sendToPrinterFtp(user, order, zipFile) {
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

        var filepath = getZipFileName(user, order) + '.zip';

        q.ninvoke(ftp, 'put', fs.createReadStream(zipFile), filepath).
            then(function() {
                logger.info('FTP upload complete for ' + user.displayName + '(ID: ' + user._id + ')' + ' with the file ' + filepath);
                deferred.resolve();
            }).
            fail(function(err) {
                logger.error('FTP failed for ' + user.displayName + '(ID: ' + user._id + ')' + ' with the file ' + filepath, err);
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
 * @param order
 * @returns {*}
 */
function sendToPrinterEmail(user, order) {
    var deferred = q.defer();

    if (!!config.printer.email.enabled && config.printer.email.enabled !== 'false') {
        var toEmail = config.printer.email.to;
        var fromEmail = config.printer.email.from;
        var date = moment().format('DD-MM-YYYY');

        var subject = 'Express Images ready for print for ' + user.displayName + ' (ID: ' + user._id + ')' + ' - ' + date;
        var message = 'Express Images are ready to print for ' + user.displayName + ' (ID: ' + user._id + ') - ' + date + '<br><br>';

        message += formatUser('email',user, '<br>');
        message += formatAddress(order, '<br>') + '<br><br>';
        message += '<strong>Order zip:</strong>:<br>';
        message += '<a href="' + order.zipFile + '">' + order.zipFile + '</a>';

        logger.info('Sending email to ' + toEmail + ' from ' + fromEmail + ' for ' + user.displayName + ' (ID: ' + user._id + ')');

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
 * @param order
 * @param localImages
 * @returns {*}
 */
function zipFiles(user, order, localImages) {
    logger.info('Zipping ' + localImages.length + ' images for ' + user.displayName + ' (ID: ' + user._id + ')');

    var filename = getZipFileName(user, order);
    var files = localImages || [];

    //add read me to zip
    var readMe = getReadMeForPrintableImageSet(user, order);
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
    if (!!config.tracking.track && config.tracking.track !== 'false') {
        trackingManager.trackPrintedImageSet(user, imageSet);
    }
}

/**
 * Formats the user for the readme and email
 *
 * @param type: either email or readme. Defines the format returned
 * @param user
 * @param lineEnd
 * @returns {string}
 */
function formatUser(type, user, lineEnd) {
    var text = '';
    if (!lineEnd) {
        lineEnd = '\n';
    }

    if (type === 'email') {
        //text += '@' + _.trim(user.instagram.username) + lineEnd;
        text += _.trim(user.displayName) + ' (ID: ' + user._id + ')' + lineEnd;
    } else {
        // must be readme
        text += _.trim(user.displayName) + lineEnd;
    }

    return text;
}

/**
 * Formats the address for the readme and email
 *
 * @param user
 * @param lineEnd
 * @returns {string}
 */
function formatAddress(order, lineEnd) {
    var text = '';
    if (!lineEnd) {
        lineEnd = '\n';
    }

    text += _.trim(order.address.line1) + lineEnd;

    if (!_.isEmpty(order.address.line2)) {
        text += _.trim(order.address.line2) + lineEnd;
    }

    text += _.trim(order.address.suburb) + lineEnd;
    text += _.trim(order.address.state) + ', ' + _.trim(order.address.postcode) + lineEnd;
    text += _.trim(order.address.country);

    return text;
}

function getS3ZipFilePath(user, order) {
    //return getUserDirectory(user,order);
    return 'order-' + order._id;
}
Consumer.prototype.getS3ZipFilePath = getS3ZipFilePath;

/**
 * Gets a nicely formatted file name
 *
 * @param user
 * @param imageSet
 * @returns {string}
 */
function getZipFileName(user, order) {
    return user.name.givenName + '-' + user.name.familyName + '-' + user._id +
        '-' +
        moment().format('YYYY-MM-DD');
}
Consumer.prototype.getZipFileName = getZipFileName;

/**
 * @param user
 * @param imageSrc
 * @returns {string}
 */
function legacyFormatFileName(user, imageSrc) {
    logger.info('### image source is = ' + imageSrc);
    return user.name.givenName + '-' + user.name.familyName + '-' + path.basename(imageSrc, path.extname(imageSrc));
}

/**
 * A user directory where we can store the user specific files
 *
 * @param user
 * @param order
 * @returns {string}
 */
function getUserDirectory(user, order) {
    return user.messengerId + '/order-' + order._id;
}
Consumer.prototype.getUserDirectory = getUserDirectory;


/**
 * Builds Imgix url for image cropping
 *
 * @param {string} service - Express | Facebook | Instagram. Used to dictate which imgix host source to use.
 * @param {string} product_type - 6x4 or 4x4. Represents the product to fit to.
 * @param {string} imageUrl - url of the image
 * @param {string} width - width (in pixels) of the image
 * @param {string} height - height (in pixels) of the image
 * @returns {string} url
 */
function getImgixUrl(service, product_type, imageUrl, width, height) {
    var imgPath;
    var options = {};
    var hostDomain = config.imgix.hosts[service];

    if (!hostDomain) {
        //throw some error and return raw imageUrl as we won't be able to re-size
        logger.error('getImgixUrl: Unable to resize due to unknown service (' +service+ ')');
        return imageUrl;
    }

    imgPath = url.parse(imageUrl).pathname.replace('pixy-express/', '');

    // initialise Imgix client
    var imgix = new imgixClient({
      host: hostDomain,
      secureURLToken: config.imgix.secureToken
    });

    // determine best crop based on image dimensions
    //  - if 5x4 and up... crop faces.
    //  - if below 5x4... treat as square so resize to fit with white letterbox.
    //  - ### TODO: Might need 5x3 scaling (1.6ish?) to letterbox like square???
    if (width > height) {
        logger.info('### LANDSCAPE: Ratio - ' + width/height);
        // LANDSCAPE
        if (product_type === '6x4') {
            // crop for faces
            options = {
                w: 1800,
                h: 1200,
                fit: "crop",
                crop: "faces"
            }
        } else {
            // treat as square (fit=fill & bg=FFFFFF)
            options = {
                w: 1200,
                h: 1200,
                fit: "crop",
                crop: "faces"
            }
        }
    } else if (height > width) {
        // PORTRAIT
        logger.info('### PORTRAIT: Ratio - ' + height/width);
        if (product_type === '6x4') {
            // crop for faces
            options = {
                w: 1200,
                h: 1800,
                fit: "crop",
                crop: "faces"
            }
        } else {
            // treat as square (fit=fill & bg=FFFFFF)
            options = {
                w: 1200,
                h: 1200,
                fit: "crop",
                crop: "faces"
            }
        }
    } else {
        // SQUARE
        //treat as square (fit=fill & bg=FFFFFF)
        options = {
            w: 1200,
            h: 1200,
            fit: "crop",
            crop: "faces"
        }
    }

    // get from imgix
    return imgix.buildURL(imgPath, options);
};

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer();
