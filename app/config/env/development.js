/**
 * Expose
 */

module.exports = {
    printer: {
        sendEmail: false,
        emailTo: 'josh@evergram.co',
        emailFrom: 'hello@evergram.co'
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
