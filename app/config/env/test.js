'use strict';

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
        waitTime: 20,
        visibilityTime: 120
    },
    plans: {
        simpleLimit: '[a-zA-Z]+\\-LIMIT\\-([0-9]+)'
    },
    track: true
};
