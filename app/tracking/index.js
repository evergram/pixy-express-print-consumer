'use strict';

/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var moment = require('moment');
var common = require('evergram-common');
var logger = common.utils.logger;
var trackingManager = common.tracking.manager;

/**
 * A tracking manager that handles all tracking events for the instagram consumer
 *
 * @constructor
 */
function TrackingManager() {

}

TrackingManager.prototype.trackPrintedImageSet = function(user, imageSet) {
    var event = 'Shipped photos';

    var total = 0;
    var owned = 0;
    var other = 0;

    _.forEach(imageSet.images, function(images) {
        _.forEach(images, function(image) {
            total++;
            if (image.isOwner) {
                owned++;
            } else {
                other++;
            }
        });
    });

    if (total > 0) {
        logger.info('Tracking ' + event + ' for ' + user.getUsername());

        return trackingManager.trackEvent(user, event, {
            imageSetId: imageSet._id.toString(),
            photoCount: total,
            ownPhotoCount: owned,
            friendsPhotoCount: other,
            period: imageSet.period,
            startDate: moment(imageSet.startDate).toDate(),
            endDate: moment(imageSet.endDate).toDate(),
            shippedOn: moment(imageSet.endDate).toDate()
        }, moment(imageSet.endDate).toDate());
    } else {
        logger.info(user.getUsername() + ' has no images to track for the period ' + imageSet.period);
    }
};

/**
 * Track Invoiced event. Represents when the Print Consumer adds Invoice Line Items to the user's current Stripe invoice.
 * @param user
 * @param paymentInfo: Basic details of the payment defined by PrintConsumer.addPayment()
 */ 
TrackingManager.prototype.trackInvoiced = function(user, paymentInfo) {

    var event = 'Invoiced';
    var errorSummary = '';

    if (!!paymentInfo.error) {

        if (!!paymentInfo.error.shipping) {
            // if an error occured during invoicing shipping, append it to the event.
            errorSummary += '[Error invoicing shipping charge:] \n';
            errorSummary += paymentInfo.error.shipping + ' \n';
        }
        if (!!paymentInfo.error.photos) {
            // if an error occured during invoicing photo count, append it to the event.
            errorSummary += '[Error invoicing photos charge:] \n';
            errorSummary += paymentInfo.error.photos;
            
        }
    }

    return trackingManager.trackEvent(user, event, {
            status: paymentInfo.status,
            photos: paymentInfo.photoCount,
            shippingCharge: paymentInfo.shippingCharge,
            photoCharge: paymentInfo.photoCharge,
            error: errorSummary,
            invoicingDate: moment().toDate()
        }, moment().toDate());
};

/**
 * Expose
 * @type {TrackingManagerService}
 */
module.exports = exports = new TrackingManager();
