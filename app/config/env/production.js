'use strict';

/**
 * Expose
 */

module.exports = {
    billing: {
        stripe: {
            secretAccessKey: process.env.STRIPE_KEY
        },
        plans: ["VALUE100", "PHOTOADDICT100", "UNLTD100SHIP"],  // list of subscription plans for billing
        shippingDescription: "Shipping",
        chargeDescription: "Photos [{{photoCount}}]"
    },
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
        waitTime: process.env.SQS_WAIT_TIME || 20,
        visibilityTime: process.env.SQS_VISIBILITY_TIME || 600
    },
    plans: {
        simpleLimit: '[a-zA-Z]+\\-LIMIT\\-([0-9]+)'
    },
    track: process.env.TRACK_PRINTING || true,
    imgix: {
        hosts: {
            facebook: process.env.IMGIX_HOST_FACEBOOK,
            instagram: process.env.IMGIX_HOST_INSTAGRAM
        },
        secureToken: process.env.IMGIX_SECURE_TOKEN
    }
};
