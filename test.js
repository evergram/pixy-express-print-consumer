/**
 * Module dependencies.
 */

var q = require('q');
var _ = require('lodash');
var common = require('evergram-common');
var instagram = common.instagram;
var userManager = common.user.manager;
var PrintableImageSet = common.models.PrintableImageSet;
var printManager = common.print.manager;
var consumer = require('./app/consumer');

//init db
common.db.connect();

//var options = {criteria: {'instagram.username': 'mandycuz'}};
var options = {};

userManager.findAll(options).then(function (users) {
    var deferreds = [];
    console.log('Found ' + users.length + ' users');
    var numImages = 0;
    if (!!users) {
        _.forEach(users, function (user) {
            var deferred = q.defer();
            printManager.findCurrentByUser(user).then(function (imageSet) {
                console.log(user.instagram.username + ' has ' + imageSet.images.instagram.length + ' images');
                console.log('Saving them to disk');

                consumer.saveFiles(user, imageSet).then(function () {
                    console.log('Saved to disk');
                    numImages += imageSet.images.instagram.length;
                    deferred.resolve();
                });
            });
            deferreds.push(deferred.promise);
        });
    }
    q.all(deferreds).then(function () {
        console.log('Total of ' + numImages + ' images found');
    })
});