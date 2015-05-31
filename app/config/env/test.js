/**
 * Expose
 */
var crypto = require('crypto');

module.exports = {
    printer: {
        email: {
            enabled: true,
            from: 'hello@evergram.co',
            to: 'hello@evergram.co'
        },
        ftp: {
            enabled: false,
            directory: 'evergramco-test',
            host: 'ftp.test.com.au',
            port: 21,
            username: 'test',
            password: 'test'
        }
    },
    s3: {
        //random dir
        folder: 'user-images/' + crypto.randomBytes(Math.ceil(5 / 2)).toString('hex').slice(0, 5)
    },
    sqs: {
        //seconds
        waitTime: 3
    },

    //seconds
    retryWaitTime: 60,
    track: true
};
