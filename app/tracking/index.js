'use strict';

/**
 * @author Josh Stuart <joshstuartx@gmail.com>.
 */

var _ = require('lodash');
var q = require('q');
var moment = require('moment');
var common = require('evergram-common');
var Analytics = require('analytics-node');
var config = require('../config').tracking;
var logger = common.utils.logger;
var trackingManager = common.tracking.manager;
var analyticsInstance;

/**
 * A manager that provides tracking of events.
 *
 * @constructor
 */
function TrackingManager() {

    if (!!config.writeKey) {
        analyticsInstance = new Analytics(config.writeKey, config.options);
    } else {
        logger.error('Missing write key for Segment');
    }
}

TrackingManager.prototype.trackPrintedOrder = function(user, order) {
    var event = 'Shipped photos';

    var total = order.photos.length;

    if (total > 0) {
        logger.info('Tracking ' + event + ' for ' + user.displayName + ' (ID: ' + user._id + ')');

        return trackEvent(user, order, event, {
            orderId: order._id.toString(),
            photoCount: total,
            shippedOn: moment().toDate()
        }, moment().toDate());
    } else {
        logger.info(user.displayName + ' has no images to track.');
    }
};

function trackEvent(user, order, event, properties, timestamp) {
    
    // append traits to properties (needed to expose traits to some platforms, e.g. keen.io and autopilot)
    properties.stamplayId = user._id;
    properties.messengerId = user.messengerId;
    properties.plan = 'express';
    properties.city = order.address.suburb;
    properties.state = order.address.state;
    properties.postcode = order.address.postcode;
    properties.country = order.address.country;

    var data = {
        userId: _.isString(user._id) ? user._id : user._id.toString(),
        event: event,
        properties: properties
    };

    if (!!timestamp) {
        data.timestamp = timestamp;
    }

    //stamp user data
    data.context = {
        traits: {
            stamplayId: user._id,
            messengerId: user.messengerId,
            city: order.address.suburb,
            state: order.address.state,
            postcode: order.address.postcode,
            country: order.address.country
        }
    };

    //return q.defer().promise
    try {
    return q.ninvoke(analyticsInstance, 'track', data).
        then(function() {
            logger.info('Tracked "' + event + '" for ' + user.displayName + ' (ID: ' + user._id + ')');
        });
    } catch(err) {
        logger.error(err);
    }
};

/**
 * Expose
 * @type {TrackingManagerService}
 */
module.exports = exports = new TrackingManager();
