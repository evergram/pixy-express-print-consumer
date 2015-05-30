/**
 * Expose
 */
var crypto = require('crypto');

module.exports = {
    printer: {
        sendEmail: true,
        emailTo: process.env.PRINT_TO_EMAIL || 'hello@evergram.co',
        emailFrom: process.env.PRINT_FROM_EMAIL || 'hello@evergram.co'
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
