/**
 * Expose
 */

module.exports = {
    printer: {
        sendEmail: true,
        emailTo: process.env.PRINT_TO_EMAIL || 'hello@evergram.co',
        emailFrom: process.env.PRINT_FROM_EMAIL || 'hello@evergram.co'
    },
    s3: {
        folder: 'user-images'
    },
    sqs: {
        waitTime: 20 //seconds
    },
    retryWaitTime: 60, //seconds
    track: false
};
