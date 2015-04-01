/**
 * Module dependencies.
 */

var q = require('q');
var _ = require('lodash');
var common = require('evergram-common');
var logger = common.utils.logger;
var instagram = common.instagram;
var userManager = common.user.manager;
var PrintableImageSet = common.models.PrintableImageSet;
var printManager = common.print.manager;
var consumer = require('./app/consumer');

//init db
common.db.connect();

var options = {criteria: {'_id': '5517af0b34d37b615d9eb78a'}};
//var options = {
//    criteria: {
//        isReadyForPrint: true
//    }
//};

printManager.findAll(options).then(function (imageSets) {
    _.forEach(imageSets, function (imageSet) {
        if (imageSet != null) {
            /**
             * Get the user for the image set even though we have an embedded one.
             */
            userManager.find({criteria: {'_id': imageSet.user._id}}).
            then(function (user) {
                if (!!user) {
                    logger.info('Found user ' + user.getUsername());
                    //save images and zip
                    consumer.saveFilesAndZip(user, imageSet).
                    then((function (file) {
                        if (!!file) {
                            logger.info('Saved ' + file + 'for ' + user.getUsername());
                            consumer.saveFileToS3(file, user.getUsername()).
                            then(function (s3File) {
                                //update the image set to printed
                                imageSet.isPrinted = true;
                                imageSet.zipFile = s3File;

                                printManager.save(imageSet).
                                then(function () {
                                    logger.info('Successfully saved files to S3 files for ' + user.getUsername());
                                    return consumer.sendEmailToPrinter(user, imageSet);
                                }).then(function () {
                                    logger.info('WE DONE ' + user.getUsername());
                                });
                            });
                        } else {
                            logger.info('No files to save for ' + user.getUsername());
                            //update the image set to printed
                            imageSet.isPrinted = true;

                            printManager.save(imageSet).
                            then(function () {
                                logger.info('WE DONE ' + user.getUsername());
                            });
                        }
                    }).bind(this));
                } else {
                    logger.error('Could not find user ' + imageSet.user);
                }
            });
        } else {
            logger.info('No image sets');
        }
    });
});