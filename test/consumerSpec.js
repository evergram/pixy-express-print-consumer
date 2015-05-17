var q = require('q');
var fs = require('fs');
var sinon = require('sinon');
var should = require('should');
var common = require('evergram-common');
var User = common.models.User;
var PrintableImageSet = common.models.PrintableImageSet;
var userManager = common.user.manager;
var printManager = common.print.manager;
var s3 = common.aws.s3;
var sqs = common.aws.sqs;

//connect db
common.db.connect();

//test object
var consumer = require('../app/consumer');

var FIXTURE_PATH = __dirname + '/fixtures/';
console.log(FIXTURE_PATH);

describe('Consumer', function() {
    var currentMessage;

    it('should get a message from the print queue', function(done) {
        this.timeout(5000);

        q.spread(
            [
                createUser('user.json'),
                createImageSet('printableImageSet.json')
            ],
            function(user, imageSet) {
                //put a message on the queue
                return sqs.createMessage(sqs.QUEUES.PRINT, '{"id": "' + imageSet._id + '"}').
                    then(function(e) {
                        /**
                         * DO TEST
                         */
                        return consumer.getMessage();
                    }).
                    then(function(message) {
                        currentMessage = message;

                        should.exist(message);
                        should.exist(message.Body);
                        should.exist(message.Body.id);
                        (message.Body.id === imageSet._id).should.be.true;

                        done();
                    });
            });
    });

    /**
     * Clean up the db and queues after each test
     */
    afterEach(function(done) {
        this.timeout(10000);

        var deferreds = [
            q.ninvoke(User, 'remove', {}),
            q.ninvoke(PrintableImageSet, 'remove', {}),
        ];

        if (!!currentMessage) {
            deferreds.push(sqs.deleteMessage(sqs.QUEUES.PRINT, currentMessage));
        }

        q.all(deferreds).
            finally(function() {
                done();
            });
    });
});

function createUser(filename) {
    var data = getFixture(filename);
    return userManager.create(new User(data));
}

function createImageSet(filename) {
    var data = getFixture(filename);
    return printManager.save(new PrintableImageSet(data));
}

function getFixture(filename) {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH + filename));
}
