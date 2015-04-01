/**
 * Expose
 */

module.exports = {
    printer: {
        sendEmail: true,
        emailTo: 'josh@evergram.co',
        emailFrom: 'hello@evergram.co'
    },
    s3: {
        folder: 'user-images'
    },
    sqs: {
        waitTime: 0 //seconds
    },
    retryWaitTime: 60 //seconds
};
