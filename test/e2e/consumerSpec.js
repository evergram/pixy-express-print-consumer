var q = require('q');
var fs = require('fs');
var sinon = require('sinon');
var should = require('should');
var common = require('evergram-common');
var User = common.models.User;
var PrintableImageSet = common.models.PrintableImageSet;
var userManager = common.user.manager;
var printManager = common.print.manager;
var emailManager = common.email.manager;
var filesUtil = common.utils.files;
var s3 = common.aws.s3;
var sqs = common.aws.sqs;

//connect db
common.db.connect();

//local dependencies
var config = require('../../app/config');
var trackingManager = require('../../app/tracking');

//test object
var consumer = require('../../app/consumer');
var FIXTURE_PATH = __dirname + '/../fixtures/';

describe('Print Consumer', function() {
    var currentMessage;
    var currentZipFilePath;
    var currentZipDirPath;

    /**
     * This is an integration end to end test. At the moment if this test is run in parallel it will most likely fail
     * due to the nature of FIFO queues. It will do for now, but maybe we should mock the queues.
     */
    it('should get a message from a print queue then save images, zip them, and send to printer', function(done) {
        this.timeout(15000);

        //spies
        sinon.spy(emailManager, 'send');
        sinon.spy(trackingManager, 'trackPrintedImageSet');
        sinon.spy(s3, 'create');
        sinon.spy(filesUtil, 'deleteFile');
        sinon.spy(sqs, 'deleteMessage');
        sinon.spy(printManager, 'save');

        q.spread(
            [
                createUser('user.json'),
                createImageSet('printableImageSet.json')
            ],
            function(user, imageSet) {
                currentZipFilePath = consumer.getS3ZipFilePath(user, imageSet);
                currentZipDirPath = consumer.getUserDirectory(user);

                /**
                 * Put a message on the queue
                 */
                return sqs.createMessage(sqs.QUEUES.PRINT, '{"id": "' + imageSet._id + '"}').
                    then(function() {
                        /**
                         * TEST consumer
                         */
                        return consumer.consume();
                    }).
                    then(function() {
                        return getImageSet(imageSet._id);
                    }).
                    then(function(newImageSet) {
                        //ensure the image set printed flag is true
                        should(newImageSet.isPrinted).be.true;

                        //assert that zip was saved to s3
                        should(s3.create.calledOnce).be.true;

                        //assert email was sent
                        should(emailManager.send.calledOnce).be.true;

                        //assert tracking event was called
                        should(trackingManager.trackPrintedImageSet.calledOnce).be.true;

                        //image set was saved (note it's called twice because once
                        should(printManager.save.calledTwice).be.true;

                        //temp files deleted
                        should(filesUtil.deleteFile.calledOnce).be.true;

                        //sqs message deleted
                        should(sqs.deleteMessage.calledOnce).be.true;

                        done();
                    });
            });
    });

    /**
     * Clean up the db
     */
    beforeEach(function(done) {
        this.timeout(1000);

        var deferreds = [
            q.ninvoke(User, 'remove', {}),
            q.ninvoke(PrintableImageSet, 'remove', {})
        ];

        q.all(deferreds).
            finally(function() {
                done();
            });
    });

    /**
     * Clean up queues and s3
     */
    afterEach(function(done) {
        this.timeout(10000);

        var deferreds = [];

        if (!!currentMessage) {
            deferreds.push(sqs.deleteMessage(sqs.QUEUES.PRINT, currentMessage));
        }

        if (!!currentZipDirPath) {
            //remove from s3
            deferreds.push(deleteFromS3(currentZipDirPath));
        }

        q.all(deferreds).
            finally(function() {
                done();
            });
    });
});

/**
 * Gets the zip file form s3
 *
 * @param filename
 * @returns {*}
 */
function getFileFromS3(filename) {
    return s3.get({
        bucket: config.aws.s3.bucket,
        key: config.s3.folder + '/' + filename
    });
}

/**
 * Delete the file from s3
 *
 * @param dir
 */
function deleteFromS3(dir) {
    return s3.deleteDir({
        bucket: config.aws.s3.bucket,
        key: config.s3.folder + '/' + dir
    });
}

/**
 * Creates the user from the fixture.
 *
 * @param filename
 * @returns {*}
 */
function createUser(filename) {
    var data = getFixture(filename);
    return userManager.create(new User(data));
}

/**
 * Creates the image set from the fixture.
 *
 * @param filename
 * @returns {*}
 */
function createImageSet(filename) {
    var data = getFixture(filename);
    return printManager.save(new PrintableImageSet(data));
}

/**
 * Get an image set
 * @param id
 * @returns {*|promise|*|q.promise}
 */
function getImageSet(id) {
    return printManager.find({criteria: {_id: id}});
}

/**
 * Fixture helper.
 *
 * @param filename
 */
function getFixture(filename) {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH + filename));
}
