/**
 * Expose
 */

module.exports = {
    printer: {
        sendEmail: false,
        emailTo: process.env.PRINT_TO_EMAIL || 'hello@evergram.co',
        emailFrom: process.env.PRINT_FROM_EMAIL || 'hello@evergram.co'
    },
    s3: {
        folder: 'user-images'
    },
    sqs: {
        //seconds
        waitTime: 3
    },

    //seconds
    retryWaitTime: 60,
    track: false
};
