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

    if (imageSet.images.length > 0) {
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
 * Expose
 * @type {TrackingManagerService}
 */
module.exports = exports = new TrackingManager();
