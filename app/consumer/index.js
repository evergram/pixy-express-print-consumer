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
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var emailManager = common.email.manager;
var imageManager = common.image.manager;
var printManager = common.print.manager;
var userManager = common.user.manager;
var filesUtil = common.utils.files;
var logger = common.utils.logger;
var stripe = require("stripe")( config.billing.stripe.secretAccessKey );

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

            //stamp the user on the image set
            currentImageSet.user = currentUser;

            return saveImagesAndZip(currentUser, currentImageSet);
        }).
        then(function(zipFile) {
            currentZipFile = zipFile;

            return saveZipToS3(zipFile, currentUser, currentImageSet);
        }).
        then(function(s3File) {
            //save the file url
            currentImageSet.zipFile = decodeURIComponent(s3File.Location);

            //finalize the set
            currentImageSet.isPrinted = true;

            //track
            trackPrintedImageSet(currentUser, currentImageSet);

            return sendToPrinter(currentUser, currentImageSet, currentZipFile);
        }).then(function() {
            // Add shipping or PAYG payments to invoice
            return addPayment(currentUser, currentImageSet);
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
    return userManager.
        find({
            criteria: {
                _id: id,
                active: true,
                signupComplete: true
            }
        }).
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
function saveZipToS3(file, user, imageSet) {
    logger.info('Saving file ' + file + ' to S3');

    var filename = config.s3.folder + '/' + getS3ZipFilePath(user, imageSet) + '/' + path.basename(file);
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

    _.forEach(imageSets, function(images, service) {

        if (images.length > 0 && !!user[service]) {
            //var filename = getZipFileName(user, imageSet) + '-';

            _.forEach(images, function(image) {
                var imgDeferred = q.defer();
                imagesDeferred.push(imgDeferred.promise);

                var printSize = image.metadata.printSize || common.config.print.sizes.SQUARE;  // if no print size defined, default to square.
                var imageUrl;

                if (printSize === common.config.print.sizes.SQUARE) {
                    imageUrl = image.src.raw;
                } else {
                    // generate appropriate imgix url
                    imageUrl = getImgixUrl(service, image.src.raw, image.metadata.images.standard_resolution.width, image.metadata.images.standard_resolution.height);

                    if (imageUrl.indexOf('w=1200') > -1 && imageUrl.indexOf('h=1200') > -1) {
                        // TODO: Hacky solution to make sure images that were re-sized to square end up in 4x4 folder. Should fix in consumer.
                        printSize = common.config.print.sizes.SQUARE;
                    }
                }

                //TODO change the legacy file name when we automate the printing
                //var imgFileName = filename + i;
                var imgFileName = legacyFormatFileName(user, imageUrl);
                imageManager.saveFromUrl(imageUrl, imgFileName, userDir + '/' + printSize).
                    then(function(savedFilepath) {

                        /**
                         * Add the saved file to all local images
                         */
                        localImages.push({
                            filepath: savedFilepath,
                            name: path.basename(savedFilepath)
                        });

                        imgDeferred.resolve();
                    })
                    .fail( function(err) {
                        logger.err('Error saving image: ' + err);
                        imgDeferred.reject();
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
    text += formatUser('readme', setUser);
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

        message += formatUser('email',imageSet.user, '<br>');
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
        text += _.trim(user.firstName) + ' ' + _.trim(user.lastName) + ' (ID: ' + user._id + ')' + lineEnd;
    } else {
        // must be readme
        text += _.trim(user.firstName) + ' ' + _.trim(user.lastName) + lineEnd;
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
    return getUserDirectory(user) + '/' +
        imageSet.period +
        '-' +
        moment(imageSet.startDate).format('YYYY-MM-DD') +
        '-to-' +
        moment(imageSet.endDate).format('YYYY-MM-DD');
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
 * Builds Imgix url for image cropping
 *
 * @param {string} service - Facebook | Instagram. Used to dictate which imgix host source to use.
 * @param {string} imageUrl - url of the image hosted on https://scontent.cdninstagram.com
 * @param {string} width - width (in pixels) of the image
 * @param {string} height - height (in pixels) of the image
 * @returns {string} url
 */
function getImgixUrl(service, imageUrl, width, height) {
    var imgPath;
    var options = {};
    var hostDomain = config.imgix.hosts[service];

    if (!hostDomain) {
        //throw some error and return raw imageUrl as we won't be able to re-size
        logger.error('getImgixUrl: Unable to resize due to unknown service (' +service+ ')');
        return imageUrl;
    }

    imgPath = url.parse(imageUrl).pathname;

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
        if (width/height >= 1.25) {
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
                fit: "fill",
                bg: "FFFFFF"
            }
        }
    } else if (height > width) {
        // PORTRAIT
        if (height/width >= 1.25) {
            logger.info('### PORTRAIT: Ratio - ' + height/width);
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
                fit: "fill",
                bg: "FFFFFF"
            }
        }
    } else {
        // SQUARE
        //treat as square (fit=fill & bg=FFFFFF)
        options = {
            w: 1200,
            h: 1200,
            fit: "fill",
            bg: "FFFFFF"
        }
    }

    // get from imgix
    return imgix.buildURL(imgPath, options);
}


function addPayment(user, imageset) {

    var userStripeId = user.billing.stripeId;

    logger.info('Creating Stripe Invoice for ' + userStripeId);

    // variables for calculating stripe charges
    // cover off if either service isn't connected for a user.
    var photoCount = (!!imageset.images.instagram ? imageset.images.instagram.length : 0)
                    + (!!imageset.images.facebook ? imageset.images.facebook.length : 0);

    var photoShipping = 0;
    var photoCharge = 0;

    // give PAYG customers 5 free photos
    if (user.billing.option == "PAYG" && photoCount < 5) {
        photoCount = photoCount - 5;
    }

    //check if plan is PAYG and if the user has less 5 photos. If so, we dont charge anything.
    if (user.billing.option == "PAYG" && photoCount <= 5) {
        // First 5 photos free for PAYG.
        photoShipping = 3;
        photoCount = 0;
        photoCharge = photoCount;

    } else if (user.billing.option == "PAYG" && photoCount > 5 && photoCount <= 10) {
        // If PAYG and >5 but <=10. Charge .80 per photos + shipping
        photoShipping = 3;
        photoCharge = photoCount * .8;

    } else if (user.billing.option == "PAYG" && photoCount > 10 && photoCount <= 50) {
        // If PAYG and >10 but <=50. Charge .50 per photos + shipping
        photoShipping = 3;
        photoCharge = photoCount * .5;

    } else if (user.billing.option == "PAYG" && photoCount > 50) {
        // If PAYG and >50. Charge .30 per photos + shipping
        photoShipping = 6;
        photoCharge = photoCount * .3;

    } else if ((config.billing.plans.indexOf(user.billing.option)>-1) && photoCount >= 0 && photoCount <= 50) {
        // if plan is a limited subscription plan and the user has <50, don't charge shipping.
        photoCount = 0;
        photoShipping = 0;
        photoCharge = 0;

    } else if ((config.billing.plans.indexOf(user.billing.option)>-1) && photoCount > 50 && photoCount < 100) {
        // if plan is a limited subscription plan and the user has between 50 & 100 photos, charge $2 extra shipping.
        photoCount = 0;
        photoShipping = 2;
        photoCharge = 0;

    } else if ((config.billing.plans.indexOf(user.billing.option)>-1) && photoCount >= 100) {
        // if plan is a limited subscription plan and the user has >=100, charge .30 per photo for each photo over 100 & charge shipping.
        photoCount = photoCount - 100;
        photoShipping = 4;
        photoCharge = photoCount * .3;
    } else {

      photoCount = 0;
      photoShipping = 0;
      photoCharge = 0;

    }

    //convert stripe charges to cents
    photoCharge = photoCharge * 100;
    photoShipping = photoShipping * 100;


    logger.info('Invoice details for ' + userStripeId + '\n' +
                    'Photos: ' + photoCount + '\n' +
                    'Shipping (cents): ' + photoShipping + '\n' +
                    'Photo charge (cents): ' + photoCharge);

    var shippingDeferred = q.defer();
    var photosDeferred = q.defer();
    
    // charge Shipping
    stripe.invoiceItems.create({
      customer: userStripeId,
      amount: photoShipping,
      currency: "aud",
      description: _.cloneDeep(config.billing.shippingDescription),
    }, function(err, invoiceItem) {
      // asynchronously called
      if (!!err) {
        // notify us and log error somwehere
        logger.error('Error invoicing Shipping for user ' + userStripeId + ': ' +err);
        shippingDeferred.reject(err);
      }
      else {
        // log successful charge somewhere
        logger.info('Shipping invoice item added for user ' + userStripeId);
        shippingDeferred.resolve(invoiceItem);
      }
    });


    // charge photos
    stripe.invoiceItems.create({
      customer: userStripeId,
      amount: photoCharge,
      currency: "aud",
      description: _.cloneDeep(config.billing.chargeDescription).replace('{{photoCount}}',photoCount),
    }, function(err, invoiceItem) {
      // asynchronously called
      if (!!err) {
        // notify us and log error somwehere
        logger.error('Error invoicing Photos for user ' + userStripeId + ': ' +err);
        photosDeferred.reject(err);
      }
      else {
        // log successful charge somewhere
        logger.info('Photos invoice item added for user ' + userStripeId);
        photosDeferred.resolve(invoiceItem);
      }

    });

    return q.allSettled([shippingDeferred.promise,photosDeferred.promise]).spread( function(shipping, photos) {

        var paymentInfo = {
            status: '',
            photoCount: photoCount,
            shippingCharge: photoShipping,
            photoCharge: photoCharge
        };

        if (shipping.state === 'fulfilled' && photos.state === 'fulfilled') {
            // invoicing was successful
            paymentInfo.status = 'success';
            trackingManager.trackInvoiced(user,paymentInfo);
            logger.info('Success completed invoicing Stripe for ' + userStripeId);
        } else {
            // error has occurred
            paymentInfo.status = 'failure';
            paymentInfo.error = {
                shipping: shipping.reason,
                photos: photos.reason
            };
            trackingManager.trackInvoiced(user,paymentInfo);
            logger.error('Error invoicing Stripe for ' + userStripeId);
        }
    });
}

/**
 * Expose
 * @type {ConsumerService}
 */
module.exports = exports = new Consumer();
