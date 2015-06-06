/**
 * Expose
 */

module.exports = {
    printer: {
        email: {
            enabled: process.env.PRINTER_EMAIL_ENABLED,
            from: process.env.PRINTER_EMAIL_FROM || 'hello@evergram.co',
            to: process.env.PRINTER_EMAIL_TO || 'hello@evergram.co'
        },
        ftp: {
            enabled: process.env.PRINTER_FTP_ENABLED,
            host: process.env.PRINTER_FTP_HOST,
            port: 21,
            username: process.env.PRINTER_FTP_USERNAME,
            password: process.env.PRINTER_FTP_PASSWORD
        }
    },
    s3: {
        folder: process.env.S3_FOLDER || 'user-images'
    },
    sqs: {
        //seconds
        waitTime: process.env.SQS_WAIT_TIME || 20
    },

    //seconds
    retryWaitTime: process.env.RETRY_WAIT_TIME || 60,
    track: process.env.TRACK_PRINTING || true
};
