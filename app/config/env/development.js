'use strict';

/**
 * Expose
 */

module.exports = {
    billing: {
        stripe: {
            secretAccessKey: 'sk_test_KN8z6UJtLbBWITp7FZUGiWKI'
        },
        plans: ["VALUE100", "PHOTOADDICT100", "UNLTD100SHIP"],  // list of subscription plans for billing
        shippingDescription: "Shipping",
        chargeDescription: "Photos [{{photoCount}}]"
    },
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
        waitTime: 20,
        visibilityTime: 300
    },
    plans: {
        simpleLimit: '[a-zA-Z]+\\-LIMIT\\-([0-9]+)'
    },
    track: false,
    imgix: {
        hosts: {
            facebook: 'fb-pixy.imgix.net',
            instagram: 'pixy.imgix.net'
        },
        secureToken: 'PY4VKJ6yX7TQEhuySaeZmb9Wagdgyjxj'
    }
};
