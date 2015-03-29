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

//var options = {criteria: {'instagram.username': 'luisa_vasta'}};
var options = {};


userManager.findAll(options).then(function (users) {
    var deferreds = [];
    console.log('Starting');
    if (!!users) {
        _.forEach(users, function (user) {
            var deferred = q.defer();
            printManager.findAllByUser(user).then(function (imageSet) {
                return consumer.saveFilesAndZip(user, imageSet[0]);
            }).then(function (zipFileName) {
                if (!!zipFileName) {
                    console.log(zipFileName);
                }
                deferred.resolve();
            });
            deferreds.push(deferred.promise);
        });
    }
    q.all(deferreds).then(function () {
        console.log('We are done');
    })
});