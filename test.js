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

var options = {criteria: {'_id': '55173af619d7c75c23989c9c'}};
//var options = {};

printManager.find(options).then((function (imageSet) {
    if (imageSet != null) {
        /**
         * Get the user for the image set even though we have an embedded one.
         */
        userManager.find({'_id': imageSet.user._id}).
        then(function (user) {
            if (!!user) {

                //save images and zip
                consumer.saveFilesAndZip(user, imageSet).
                then((function (file) {

                    logger.info('Saved ' + file);
                    consumer.saveFileToS3(file, user.getUsername()).
                    then(function (s3File) {
                        //update the image set to printed
                        imageSet.isPrinted = true;
                        imageSet.zipFile = s3File;

                        printManager.save(imageSet).
                        then(function () {
                            logger.error('WE DONE ' + user.getUsername());
                        });
                    });
                }).bind(this));
            } else {
                logger.error('Could not find user ' + imageSet.user);
                resolve();
            }
        });
    } else {
        resolve();
    }
}).bind(this));