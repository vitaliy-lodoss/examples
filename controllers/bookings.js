const _ = require('lodash');
const log = require('../common/logger').getLogger('controllers/bookings');
const model = require('../models/bookings');
const users = require('../models/users');
const paymentModel = require('../models/payments');
const Promise = require('bluebird');
const errors = require('../common/errors/errors');
const paymentLib = require('../common/payment');
const mandrill = require('../common/powerdrill');
const vendors = require('../models/vendors');
const moment = require('moment');
const es = require('../common/elasticsearch').wrap;

const getUntil = (date = '') => {
  const duration = moment.duration(moment(date).diff(moment().toDate()));
  return parseInt(duration / (1000 * 3600 * 24));
}

const Bookings = {};

/**
 * Creates and returns a Booking
 * Creates new Booking record in ElasticSearch
 * Updates Customer and Vendor indexes with Booking information
 * Sends notification to Customer and Vendor
 *
 * @param user - The authenticated user
 * @param data - The Booking object (e.g. req.body)
 * @returns {Promise.<Booking>}
 */
Bookings.insert = function(user, data){
  var booking, vendor, customer;
  data.customer_id = user.id;
  return model.create(data)
    .then((filledBooking) => {
        booking = filledBooking;
        let es_booking = {
            id: booking.id,
            timings: {date: booking.timings.date},
            created: booking.created,
            state: booking.state,
            vendor: {name: booking.vendor.name, id: booking.vendor.id},
            customer: {email: booking.customer.email, id: booking.customer.id},
            menuPrice: booking.menuPrice,
            total: booking.total
        };
        return Promise.props({
           vendor: vendors.getOne(booking.vendor_id),
           customer: users.getProfile(booking.customer_id),
           es_customer: es.getById('users', booking.customer_id),
           es_booking: es.create('bookings', es_booking)
        })
    })
    .then((result) => {
      vendor = result.vendor;
      customer = result.customer;
      let es_customer_data = result.es_customer['_source'];
      es_customer_data['lastBookingDate'] = booking.created;
      es_customer_data['bookings'] ? es_customer_data['bookings'].push(booking.id) : es_customer_data['bookings'] = [booking.id];
      return Promise.props({
        es: es.update('users', es_customer_data, result.es_customer['_id']),
        profile: users.getProfile(vendor.user_id)
      })
    })
    .then((result) => {
      vendor.profile = result.profile;
      log.debug('vendor.profile', vendor.profile);
      return es.getById('users', vendor.profile.id)
    })
    .then((record) => {
      log.debug('record', record);
      let es_vendor_data = record['_source'];
      es_vendor_data['lastBookingDate'] = booking.created;
      es_vendor_data['bookings'] ? es_vendor_data['bookings'].push(booking.id) : es_vendor_data['bookings'] = [booking.id];
      return Promise.all([
        es.update('users', es_vendor_data, record['_id']),
        mandrill.sendMessage('vendor_booking_received', {
          receiver: vendor.profile.email,
          username: vendor.profile.firstName + ' ' + vendor.profile.lastName,
          booking_id: booking.id,
          datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
          vendor: vendor.name,
          state: booking.state,
          'until': getUntil(booking.timings.date)
        }),
        mandrill.sendMessage('booking_received', {
          receiver: customer.email,
          username: customer.firstName + ' ' + customer.lastName,
          booking_id: booking.id,
          datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
          vendor: vendor.name,
          state: booking.state,
          'until': getUntil(booking.timings.date)
        })
      ])
    })
    .then(() => {
        return booking;
    })
};

// Returns booking by id
Bookings.getOne = function(booking_id, user){
  let props = {
    booking: model.getOne(booking_id)
  };
  if (user.role == 'vendor') props['vendor'] = vendors.getVendorByUserId(user.id);
  return Promise.props(props)
    .then((results) => {
      if ((user.role == 'customer' && results.booking.customer_id != user.id) || (user.role == 'vendor' && results.vendor.id != results.booking.vendor_id)) {
          return Promise.reject(errors.YOU_DONOT_OWNER_OF_BOOKING());
      } else {
        return results.booking;
      }
    });
};

/**
 * Delete booking object.
 * Delete booking index from elastic search
 * Update customer and vendor indexes with booking information
 *
 * @param {string} booking_id
 * @param {string} user_id
 * @returns {Promise.<string>}
 */
Bookings.remove = function(booking_id, user_id){
  let data;
  const query = {id: booking_id};
  return Promise.props({
    booking: model.getOneFilled(booking_id),
    es_customer: es.getById('users', user_id)
  })
  .then((result) => {
    data = result;
    return model.remove(query)
  })
  .then(() => {
    let customer_bookings = _.filter(data.es_customer['_source']['bookings'], (item) => {return item !=booking_id});
    return Promise.props({
      vendorProfile: vendors.getUserProfile(data.booking.vendor_id),
      update: es.update('users', {'bookings': customer_bookings}, data.es_customer['_id']),
      es_booking: es.getById('bookings', booking_id)
    })
  })
  .then((result) => {
    data = result.es_booking;
    return es.getById('users', result.vendorProfile.id);
  })
  .then((es_vendor) => {
    let vendor_bookings = _.filter(es_vendor['_source']['bookings'], (item) => {return item !=booking_id});
    return Promise.all([
      es.update('users', {'bookings': vendor_bookings}, es_vendor['_id']),
      es.remove('bookings', data._id)
    ])
  })
  .then(() => {
    return { message: "Booking has been successfully removed." };
  })
};

/**
 * Update booking object and return it.
 * Update booking index in elastic search
 * Update customer and vendor indexes with booking information
 *
 * @param booking_id
 * @param data
 * @param user_id
 * @returns {Promise.<Booking>}
 */
Bookings.update = function(booking_id, data, user_id){
  let booking;
  const query = {id: booking_id};
  return model.update(query, data)
  .then((updated) => {
    booking = updated;
    return es.getById('bookings', booking_id);
  })
  .then((index) => {
    let es_record = {
      id: booking_id,
      timings: { date: booking.timings.date },
      created: booking.created,
      state: booking.state,
      vendor: { name: booking.vendor.name, id: booking.vendor.id },
      customer:{ email: booking.customer.email, id: booking.customer.id },
      menuPrice: booking.menuPrice,
      total: booking.total
    };
    return es.update('bookings', es_record, index['_id'])
  })
  .then(() => {
    return booking;
  })
};

// Search booking(s) in elastic search and returns result.
Bookings.search = function(query, limit, offset, user){
  return (() => {
    // Filter Bookings by User.Id
    if (user.role == 'customer') {
      query = query == '' ? `customer.id:"${user.id}"` : query + ` AND customer.id:"${user.id}"`; // ?q=customer.id:GUID
      return Promise.resolve(true);
    } else if (user.role == 'vendor') {
      return vendors.getVendorByUserId(user.id)
      .then((vendor) => {
        query = query == '' ? `vendor.id:"${vendor.id}"` : query + ` AND vendor.id:"${vendor.id}"`; //?q=vendor.id:GUID 
        return Promise.resolve(true);
      })
    }
  })()
  .then(() => {
    return es.getByQuery('bookings', query, limit, offset);
  })
  .then((results) => {
    let [records, total] = results;
    let converted = {
      totalRecords: total,
      paging: {}
    };
    let promises = [];
    _.each(records, (item) => {
      if (item['_source'] && item['_source']['id']) {
        promises.push(model.getOneFilled(item['_source']['id']).catch((err) => { log.error(err) }));
      }
    });
    return Promise.all(promises)
      .then((results) => {
        converted['results'] = results;
        return converted
      })
  })
};

Bookings.getPayments = function(booking_id, user){
  return Bookings.getOne(booking_id, user)
    .then((booking) => paymentModel.getByBooking(booking_id));
};

Bookings.insertPayment = function(booking_id, data, user) {
  data.booking_id = booking_id;
  return model.getOneFilled(booking_id)
    .then((booking) => {
      const transactionData = {
        amount: parseFloat(booking.total * (1 + (booking.service_fee/100))),
        currency: 'gbp',
        source: data.card_token
      };
      return paymentLib.createTransaction(transactionData);
    })
    .then((transaction) => {
      data['total'] = transaction.amount;
      data.provider = {
        name: 'Stripe',
        id: transaction.id
      };
      return paymentModel.create(data);
    })
};

Bookings.getOnePayment = function(booking_id, payment_id) {
  return paymentModel.getOne(payment_id)
    .then((model) => {
      if(model.booking_id != booking_id) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return model;
    });
};

Bookings.acceptPayment = function(booking_id, payment_id) {
  return model.getOne(booking_id)
    .then((booking) => {
      if (!booking) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return paymentModel.getOne(payment_id);
    })
    .then((payment) => {
      if (!payment) {
        return Promise.reject(errors.PAYMENT_NOT_FOUND());
      }
      return paymentLib.captureTransaction(payment.provider.id);
    })
    .then(() => Bookings.update(booking_id, {state: 'approvedVendor'}))
    .then((booking) => paymentModel.update(payment_id, {state: 'approved'}))
    .then(() => model.getOneFilled(booking_id));
};

Bookings.declinePayment = function(booking_id, payment_id) {
  return model.getOne(booking_id)
    .then((booking) => {
      if (!booking) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return Bookings.update(booking_id, {state: 'declinedVendor'}, booking.customer_id);
    })
    .then(() => model.getOneFilled(booking_id));
};

Bookings.createToken = (data) => paymentLib.createToken(data);

// Creates and sends all types of notifications around booking objects
Bookings.sendStatusNotification = (booking_id, user_id) => {
  let booking, vendor, customer;
  return model.getOne(booking_id)
      .then((booking) => {
        return Promise.resolve(booking);
      })
      .then((record) => {
        booking = record;
        return Promise.props({
           vendor: vendors.getOne(booking.vendor_id),
           customer: users.getProfile(booking.customer_id)
        })
      })
      .then((results) => {
        vendor = results.vendor;
        customer = results.customer;
        return users.getProfile(vendor.user_id)
      })
      .then((record) => {
        vendor.user_data = record;
        let states = {
        booked: () => {
          return mandrill.sendMessage('booking_confirmed', {
              receiver: customer.email,
              username: customer.firstName + ' ' + customer.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            })
        },
        approvedVendor: () => {
          return Promise.all([
            mandrill.sendMessage('booking_accepted', {
              receiver: customer.email,
              username: customer.firstName + ' ' + customer.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            }),
            mandrill.sendMessage('vendor_booking_confirmed', {
              receiver: vendor.user_data.email,
              username: vendor.user_data.firstName + ' ' + vendor.user_data.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            })
          ])
        },
        pending: () => {
          return Promise.all([
            mandrill.sendMessage('booking_received', {
              receiver: customer.email,
              username: customer.firstName + ' ' + customer.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            }),
            mandrill.sendMessage('vendor_booking_received', {
              receiver: vendor.user_data.email,
              username: vendor.user_data.firstName + ' ' + vendor.user_data.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            })
          ])
        },
        completed: () => {},
        declinedVendor: () => {
            return mandrill.sendMessage('booking_rejected', {
              receiver: customer.email,
              username: customer.firstName + ' ' + customer.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            })
        },
        declinedAdmin: () => {
          return Promise.all([
            mandrill.sendMessage('booking_rejected_by_admin', {
              receiver: customer.email,
              username: customer.firstName + ' ' + customer.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            }),
            mandrill.sendMessage('vendor_booking_rejected_by_admin', {
              receiver: vendor.user_data.email,
              username: vendor.user_data.firstName + ' ' + vendor.user_data.lastName,
              booking_id: booking.id,
              datetime: moment(booking.timings.date).format("dddd, MMMM Do YYYY, h:mm:ss a"),
              vendor: vendor.name,
              state: booking.state,
              'until': getUntil(booking.timings.date)
            })
          ]);
        }
        };
        return states[booking.state]();
      })
      // @TO-DO: need to check it and fix
      .then((result) => {
        log.debug(booking.state, 'new result of sendStatusNotification', result);
        return { message: "Booking status email been sent." };
      })
};


Bookings.sendPaymentStatusNotification = (booking_id, payment_id, user_id) => {
  var _booking, _payment, vendor, customer;
  return model.getOne(booking_id)
    .then((booking) => {
      if (!booking) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      } else {
        _booking = booking;
        return paymentModel.getOne(payment_id);
      }
    })
    .then((payment) => {
      if (!payment) {
        return Promise.reject(errors.PAYMENT_NOT_FOUND());
      } else {
        _payment = payment;
        return Promise.props({
          vendor: vendors.getOne(_booking.vendor_id),
          customer: users.getProfile(_booking.customer_id)
        })
      }
    })
    .then((results) => {
      vendor = results.vendor;
      customer = results.customer;
      return users.getProfile(vendor.user_id)
    })
    .then((record) => {
        vendor.user_data = record;
        let states = {
          approvedVendor: () => {
            return Promise.all([
              mandrill.sendMessage('payment_taken', {
                receiver: customer.email,
                username: customer.firstName + ' ' + customer.lastName,
                id: _payment.id,
                total: _payment.total,
                state: _payment.state,
                provider: _payment.provider
              }),
              mandrill.sendMessage('payment_taken', {
                receiver: vendor.user_data.email,
                username: vendor.user_data.firstName + ' ' + vendor.user_data.lastName,
                id: _payment.id,
                total: _payment.total,
                state: _payment.state,
                provider: _payment.provider
              })
            ])
          },
          declined: () => {
            return Promise.all([
              mandrill.sendMessage('payment_failed', {
                receiver: customer.email,
                username: customer.firstName + ' ' + customer.lastName,
                id: _payment.id,
                total: _payment.total,
                state: _payment.state,
                provider: _payment.provider
              }),
              mandrill.sendMessage('payment_failed', {
                receiver: vendor.user_data.email,
                username: vendor.user_data.firstName + ' ' + vendor.user_data.lastName,
                id: _payment.id,
                total: _payment.total,
                state: _payment.state,
                provider: _payment.provider
              })
            ])
          }
        };
        return { message: "Payment status email been sent." };
      })
};

module.exports = Bookings;
