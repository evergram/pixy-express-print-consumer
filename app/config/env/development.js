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
        folder: 'user-images'
    },
    sqs: {
        //seconds
        waitTime: 1
    },

    //seconds
    retryWaitTime: 60,
    track: false
};
