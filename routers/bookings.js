const express = require('express');
const router = express.Router();
const log = require('../common/logger').getLogger('router/bookings');
const controllers = require('../controllers');
const validator = require('../common/validator');
const errors = require('../common/errors/errors');
const _ = require('lodash');
const paging = require('../common/utils').paging;

router.route('/:id/payments/:paymentId')
  .get(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
  return controllers.bookings.getOnePayment(req.params.id, req.params.paymentId)
    .then((result) => res.data = result)
    .nodeify(next);
  });

router.route('/:id/payments/:paymentId/accept')
  .post(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
  return controllers.bookings.acceptPayment(req.params.id, req.params.paymentId)
    .then((result) => res.data = result)
    .nodeify(next);
  });

router.route('/:id/payments/:paymentId/decline')
  .post(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
  return controllers.bookings.declinePayment(req.params.id, req.params.paymentId)
    .then((result) => res.data = result)
    .nodeify(next);
  });

router.route('/:id/payments/')
  .get(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
  return controllers.bookings.getPayments(req.params.id, req.user)
    .then((result) => res.data = result)
    .nodeify(next);
  })
  .post(validator.isBookingOwnerOrAdmin, validator.checkPaymentData, (req, res, next) => {
  return controllers.bookings.insertPayment(req.params.id, req.body, req.user)
    .then((result) => res.data = result)
    .nodeify(next);
  });

router.route('/:id')
  .get(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
    return controllers.bookings.getOne(req.params.id, req.user)
    .then((result) => res.data = result)
    .nodeify(next);
  })
  .patch(validator.isBookingOwnerOrAdmin, validator.checkUpdateBookingData, (req, res, next) => {
    return controllers.bookings.update(req.params.id, req.body, req.user.id)
    .then((result) => res.data = result)
    .nodeify(next);
  })
  .delete(validator.isBookingOwnerOrAdmin, (req, res, next) => {
    return controllers.bookings.remove(req.params.id, req.user.id)
    .then((result) => res.data = result)
    .nodeify(next);
  });

router.route('/:id/status/send-email')
  .post(validator.isBookingOwnerOrVendorOrAdmin, (req, res, next) => {
    return controllers.bookings.sendStatusNotification(req.params.id, req.user.id)
      .then((result) => res.data = result)
      .nodeify(next);
  });

router.route('/:id/payments/:paymentId/status/send-email')
  .post((req, res, next) => {
    return controllers.bookings.sendPaymentStatusNotification(req.params.id, req.params.paymentId, req.user.id)
      .then((result) => res.data = result)
      .nodeify(next);
  });

router.route('/')
  .get((req, res, next) => {
    var query = req.query.q ? req.query.q : '';
    var limit = req.query.limit ? req.query.limit : 10;
    var offset = req.query.offset ? req.query.offset : 0;
    return controllers.bookings.search(query, limit, offset, req.user)
    .then((result) => {
      if (result.paging) paging(req, result);
      res.data = result
    })
    .nodeify(next);
  })
  .post(validator.checkBookingData, (req, res, next) => {
    return controllers.bookings.insert(req.user, req.body)
    .then((result) => res.data = result)
    .nodeify(next);
  });

/**
 * POST /payment/create_token
 * Used for test
 * @return {Object} Return token
 */
router.route('/payment/create_token')
  .post((req, res, next) => {
  return controllers.bookings.createToken(req.body)
    .then((result) => res.data = result)
    .nodeify(next);
  });

module.exports = router;