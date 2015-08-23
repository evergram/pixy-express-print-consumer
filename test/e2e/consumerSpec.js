var _ = require('lodash');
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
var trackingManager = common.tracking.manager;
var filesUtil = common.utils.files;
var s3 = common.aws.s3;
var Message = require('slipstream-message');

//connect db
common.db.connect();

//local dependencies
var config = require('../../app/config');
var printTrackingManager = require('../../app/tracking');

//test object
var consumer = require('../../app/consumer');
var FIXTURE_PATH = __dirname + '/../fixtures/';

describe('Print Consumer', function() {
    var currentZipFilePath;
    var currentZipDirPath;

    //spies
    var SPIES = {
        emailManagerSpy: sinon.spy(emailManager, 'send'),
        printTrackingManagerSpy: sinon.spy(printTrackingManager, 'trackPrintedImageSet'),
        trackingManagerSpy: sinon.spy(trackingManager, 'trackEvent'),
        s3Spy: sinon.spy(s3, 'create'),
        filesUtilSpy: sinon.spy(filesUtil, 'deleteFile'),
        printManagerSpy: sinon.spy(printManager, 'save'),
        userManagerSpy: sinon.spy(userManager, 'update')
    };

    /**
     * This is an integration end to end test. At the moment if this test is run in parallel it will most likely fail
     * due to the nature of FIFO queues. It will do for now, but maybe we should mock the queues.
     */
    it('should get a message from a print queue, save images, zip them, and send to printer', function(done) {
        this.timeout(10000);

        //mocks
        //TODO ftp

        q.spread(
            [
                createUser('user.json'),
                createImageSet('printableImageSet.json')
            ],
            function(user, imageSet) {
                currentZipFilePath = consumer.getS3ZipFilePath(user, imageSet);
                currentZipDirPath = consumer.getUserDirectory(user);

                /**
                 * Consume
                 */
                return consumer.consume(new Message('dummy-id', {id: imageSet._id})).
                    then(function() {
                        return getImageSet(imageSet._id);
                    }).
                    then(function(newImageSet) {
                        //ensure the image set printed flag is true
                        should(newImageSet.isPrinted).be.true;
                        should(newImageSet.inQueue).be.false;
                        should(newImageSet.zipFile).not.be.empty;

                        //assert that zip was saved to s3
                        should(s3.create.calledOnce).be.true;

                        //assert email was sent
                        should(emailManager.send.calledOnce).be.true;

                        //assert tracking event was called
                        should(printTrackingManager.trackPrintedImageSet.calledOnce).be.true;
                        should(trackingManager.trackEvent.calledOnce).be.true;

                        //image set was saved (note it's called twice because once
                        should(printManager.save.calledTwice).be.true;

                        //user was saved
                        //TODO once we remove the limit stuff, remove this assertion
                        should(userManager.update.calledOnce).be.true;

                        //temp files deleted
                        should(filesUtil.deleteFile.calledOnce).be.true;

                        //TODO enable ftp and test

                        return getUser(user._id);
                    }).
                    then(function(newUser) {
                        //TODO once we remove the limit stuff, remove this assertion
                        //ensure the user is still active and signed up
                        should(newUser.signupComplete).be.true;
                        should(newUser.active).be.true;
                        done();
                    });
            });
    });

    /**
     * This is integration tests a limited plan user to ensure that the users` "signupComplete" is set to false.
     * TODO once we remove the limit stuff remove this whole spec.
     */
    it('should get a message from a print queue, save images, zip them, send to printer and set user signupComplete to false',
        function(done) {
            this.timeout(10000);

            //mocks
            //TODO ftp

            q.spread(
                [
                    createUser('user-limited.json'),
                    createImageSet('printableImageSet.json')
                ],
                function(user, imageSet) {
                    currentZipFilePath = consumer.getS3ZipFilePath(user, imageSet);
                    currentZipDirPath = consumer.getUserDirectory(user);

                    /**
                     * Consume
                     */
                    return consumer.consume(new Message('dummy-id', {id: imageSet._id})).
                        then(function() {
                            return getImageSet(imageSet._id);
                        }).
                        then(function(newImageSet) {
                            //ensure the image set printed flag is true
                            should(newImageSet.isPrinted).be.true;
                            should(newImageSet.inQueue).be.false;
                            should(newImageSet.zipFile).not.be.empty;

                            //assert that zip was saved to s3
                            should(s3.create.calledOnce).be.true;

                            //assert email was sent
                            should(emailManager.send.calledOnce).be.true;

                            //assert tracking event was called
                            should(printTrackingManager.trackPrintedImageSet.calledOnce).be.true;
                            should(trackingManager.trackEvent.calledOnce).be.true;

                            //image set was saved (note it's called twice because once
                            should(printManager.save.calledTwice).be.true;

                            //user was saved
                            //TODO once we remove the limit stuff, remove this assertion
                            should(userManager.update.calledOnce).be.true;

                            //temp files deleted
                            should(filesUtil.deleteFile.calledOnce).be.true;

                            //TODO enable ftp and test

                            return getUser(user._id);
                        }).
                        then(function(newUser) {
                            //TODO once we remove the limit stuff, remove this assertion
                            should(newUser.signupComplete).be.false;
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
     * Clean up
     */
    afterEach(function(done) {
        this.timeout(15000);

        resetSpies();

        deleteFromS3(currentZipDirPath).
            finally(function() {
                done();
            });
    });

    function resetSpies() {
        _.forEach(SPIES, function(spy) {
            spy.reset();
        });
    }
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
 * Get a user
 * @param id
 * @returns {*|promise|*|q.promise}
 */
function getUser(id) {
    return userManager.find({criteria: {_id: id}});
}

/**
 * Fixture helper.
 *
 * @param filename
 */
function getFixture(filename) {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH + filename));
}
