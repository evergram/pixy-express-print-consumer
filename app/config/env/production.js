/**
 * Expose
 */

module.exports = {
    s3: {
        folder: process.env.S3_FOLDER || 'user-images'
    },
    sqs: {
        waitTime: process.env.SQS_WAIT_TIME || 20 //seconds
    },
    retryWaitTime: process.env.RETRY_WAIT_TIME || 60 //seconds
};
