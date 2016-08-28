'use strict';

/**
 * Expose
 */

module.exports = {
    printer: {
        email: {
            enabled: true,
            from: 'hello@evergram.co',
            to: 'josh@evergram.co'
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
        folder: ''
    },
    sqs: {
        //seconds
        waitTime: 20,
        visibilityTime: 300
    },
    tracking: {
        track: false,
        writeKey: 's1D3vxElH5eCPE5GvCgOYH4ISifPv8pk',
        readKey: null,
        options: {
            flushAt: 1
        }
    },
    imgix: {
        hosts: {
            express: 'pixy-express.imgix.net'
        },
        secureToken: 'PY4VKJ6yX7TQEhuySaeZmb9Wagdgyjxj'
    }
};
