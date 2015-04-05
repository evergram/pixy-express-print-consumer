/**
 * Expose
 */

module.exports = {
    printer: {
        sendEmail: process.env.PRINTER_SEND_EMAIL,
        emailTo: process.env.PRINTER_TO_EMAIL || 'hello@evergram.co',
        emailFrom: process.env.PRINTER_FROM_EMAIL || 'hello@evergram.co'
    },
    s3: {
        folder: process.env.S3_FOLDER || 'user-images'
    },
    sqs: {
        waitTime: process.env.SQS_WAIT_TIME || 20 //seconds
    },
    retryWaitTime: process.env.RETRY_WAIT_TIME || 60 //seconds
};
