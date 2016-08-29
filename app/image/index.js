/**
 * @author Josh Stuart <joshstuartx@gmail.com>
 */

var q = require('q');
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var common = require('evergram-common');
var config = require('../config');
var https = require('https');
var tmp = require('tmp');
var AWS = require('aws-sdk');
var s3 = common.aws.s3;
var s3Bucket = common.config.aws.s3.bucket;
var commonConfig = common.config;
var logger = common.utils.logger;

/**
 *
 * @param user
 * @constructor
 */
function ImageManager() {
    this.tempDir = commonConfig.tempDirectory;
}

/**
 * Save the file to a local temp directory
 * @param url
 * @param filename
 * @returns {promise|*|q.promise}
 */
ImageManager.prototype.saveFromUrl = function(url, filename, dir) {
    var deferred = q.defer();
logger.info('### image imgix url to save = ' + url);
    try {
        https.get(url, (function(res) {
            if (!!res) {
                if (!filename) {
                    filename = tmp.tmpNameSync() + getExtensionFromMime(res.headers['content-type']);
                } else {
                    var fileDir = this.tempDir + dir;
                    if (!isDirectory(fileDir)) {
                        mkdirp.sync(fileDir);
                    }

                    filename = this.tempDir + dir + '/' + filename + '.jpg';
                }

                var imagedata = '';
                res.setEncoding('binary');

                res.on('data', function(chunk) {
                    imagedata += chunk;
                });

                res.on('end', function() {
                    fs.writeFile(filename, imagedata, {encoding: 'binary'}, function(err) {
                        if (!err) {
                            deferred.resolve(filename);
                        } else {
                            deferred.reject(err);
                        }
                    });
                });
            } else {
                deferred.reject();
            }
        }).bind(this));
    } catch (err) {
        deferred.reject(err);
    }

    return deferred.promise;
};


/**
 * Save the file to a local temp directory
 * @param url
 * @param filename
 * @returns {promise|*|q.promise}
 */
ImageManager.prototype.saveFromS3Url = function(url, filename, dir, destDir) {
    var deferred = q.defer();

    try {
        AWS.config.update({
            accessKeyId: commonConfig.aws.accessKeyId,
            secretAccessKey: commonConfig.aws.secretAccessKey,
            region: commonConfig.aws.region
        });
logger.info('### AWS configed');

        var s3 = new AWS.S3();

        var params = {Bucket: s3Bucket, Key: dir + '/' + path.basename(url, path.extname(url)) + '.jpg'};

        url = s3.getSignedUrl('getObject', params);

        https.get(url, (function(res) {
            if (!!res) {
                if (!filename) {
                    filename = tmp.tmpNameSync() + getExtensionFromMime(res.headers['content-type']);
                } else {
                    var fileDir = this.tempDir + destDir;
                    if (!isDirectory(fileDir)) {
                        mkdirp.sync(fileDir);
                    }

                    filename = this.tempDir + destDir + '/' + filename + getExtensionFromMime(res.headers['content-type']);
                }

                var imagedata = '';
                res.setEncoding('binary');

                res.on('data', function(chunk) {
                    imagedata += chunk;
                });

                res.on('end', function() {
                    fs.writeFile(filename, imagedata, {encoding: 'binary'}, function(err) {
                        if (!err) {
                            deferred.resolve(filename);
                        } else {
                            deferred.reject(err);
                        }
                    });
                });
            } else {
                deferred.reject();
            }
        }).bind(this));
    } catch (err) {
        deferred.reject(err);
    }

    return deferred.promise;
};


/**
 * Save the file to a local temp directory
 * @param url
 * @param filename
 * @returns {promise|*|q.promise}
 */
ImageManager.prototype.saveFromS3 = function(url, filename, dir) {
    var deferred = q.defer();

logger.info('### start s3: url= ' + url);
logger.info('### start s3: filename= ' + filename);
logger.info('### start s3: dir= ' + dir);
    try {
        AWS.config.update({
            accessKeyId: commonConfig.aws.accessKeyId,
            secretAccessKey: commonConfig.aws.secretAccessKey,
            region: commonConfig.aws.region
        });
logger.info('### AWS configed');

        var s3 = new AWS.S3();
logger.info('### s3 created');

        filename = this.tempDir + dir + '/' + filename + '.jpg';

        logger.info('key = ' + path.basename(url, path.extname(url)));

        var params = {Bucket: s3Bucket, Key: dir + '/' + path.basename(url, path.extname(url)) + '.jpg'};

        var file = fs.createWriteStream(filename);
logger.info('### start get: ' + JSON.stringify(params));
        s3.getObject(params).createReadStream().pipe(file).
            on('data', function(chunk) { 
logger.info('### write data');
                file.write(chunk); }).
            on('end', function() {
                file.end();
                deferred.resolve(filename);
            }).
            on('error', function(err) {
                deferred.reject(err);
            }).send();

    } catch (err) {
        deferred.reject(err);
    }

    return deferred.promise;
};

function getExtensionFromMime(mime) {
    var ext;
logger.info('### mime type is ' + mime);
    switch (mime) {
        case 'image/jpeg':
            ext = '.jpg';
            break;
        case 'image/jpg':
            ext = '.jpg';
            break;
        case 'image/png':
            ext = '.png';
            break;
    }

    return ext;
}

function isDirectory(dir) {
    try {
        var stats = fs.lstatSync(dir);
        return stats.isDirectory();
    }
    catch (e) {
        return false;
    }
}

/**
 * Expose
 * @type {InstagramManager}
 */
module.exports = exports = new ImageManager();
