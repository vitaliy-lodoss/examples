const schema = require('./schemas/bookings');
const vendors = require('./vendors');
const _ = require('lodash');
const log = require('../common/logger').getLogger('model/bookings');
const errors = require('../common/errors/errors');
const Promise = require('bluebird');
const db = require('../common/sequelize.js');
const btSchema = require('./schemas/booking_tags');
const settings = require('./settings');

let Booking = {};

// Returns list with id of all tags in booking object.
const getTags = (booking) => {
  const dietaryTags = (booking.dietary && booking.dietary.tags) ? booking.dietary.tags : [];
  return _.uniq(_.map(_.union([booking.eventType], dietaryTags),'id'));
};

// Returns list with tag objects of all tags in booking object
function getTagsFull(booking){
  const dietaryTags = (booking.dietary && booking.dietary.tags) ? booking.dietary.tags : [];
  return _.uniq(_.union([booking.eventType], dietaryTags));
}

// Returns all additional fields from booking tags.
function getTagsAdditionalData(tagIds, booking_id){
  return btSchema.findAll({where: {tag_id: {$in: tagIds}, booking_id: booking_id}, attributes: ['tag_id', 'booking_id', 'additionalData']})
    .then((tagsData) => _.map(tagsData, (data) => data.get({plain: true})))
}

// Saves tags objects with additional fields.
Booking.saveTags = (booking, tags, tagsFull) => {
  return booking.setTags(tags)
    .then(() => {
      let promises = [];
      _.each(tagsFull, (item) => {
        let additionalData = {};
        _.each(_.difference(_.keys(item), ['id', 'name', 'pid']), (key) => { additionalData[key] = item[key];});
        if (!_.isEmpty(additionalData)) {
          promises.push(btSchema.update({additionalData}, {where: {tag_id: item.id, booking_id: booking.id}}));
        }
      });
      return Promise.all(promises);
    })
    .then(() => booking )
    .catch((err) => Promise.reject(err));
};

Booking.getOneFilled = (id) => {
  return schema.findOne({where: {id},
        include: [
          {model: db.models.vendors, as: 'vendor'},
          {model: db.models.users, as: 'customer', attributes: ['email', 'id']}
        ]})
    .then((model) => {
      if (!model) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return model.getTags()
        .then((tags) => {
          const tagIds = _.map(tags, 'id');
          model.tags = _.map(tags, (tag) => {
            let result = tag.get({plain: true});
            delete result['booking_tags'];
            delete result['created'];
            delete result['updated'];
            return result;
          });
          return getTagsAdditionalData(tagIds, id)
        })
        .then((tagsData) => {
          _.map(tagsData, (data) => {
            let tag = _.find(model.tags, {id: data.tag_id});
            _.assign(tag, data.additionalData);
          });
          return model.getPayments();
        })
        .then((payments) => {
          model.payments = _.map(payments, (payment) => payment.get({plain: true}));
          model = model.get({plain: true});
          model.vendor = {
            id: model.vendor.id,
            name: model.vendor.name
          };
          model.customer = {
            email: model.customer.email,
            id: model.customer.id
          };
          let baseTotal = (model.covers * model.menuPrice);
          let extras = 0;
          _.each(model.dietary.tags, (tag) => {
            extras += ((tag.priceModifier || 0) * (tag.quantity || 0))
          });
          model.total = baseTotal + extras;
          return model;
        });
    })
    .catch((err) => Promise.reject(err));
};

Booking.create = (data) => {
  const tags = getTags(data);
  const tagsFull = getTagsFull(data);
  return vendors.getOne(data.vendor_id)
    .then((vendor) => {
      data.menuPrice = vendor.menuPrice || 0;
      return settings.getAllAsOne()
    })
    .then((record) => {
      data.commission_fee = record.commission_fee;
      data.service_fee = record.service_fee;
    })
    .then(() => schema.create(data))
    .then((booking) => Booking.saveTags(booking, tags, tagsFull))
    .then((model) => Booking.getOneFilled(model.id))
    .catch((err) => Promise.reject(err));
};

Booking.getOne = (id) => {
  return schema.findOne({where: {id}})
    .then((model) => {
      if (!model) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return Booking.getOneFilled(model.id);
    })
    .catch((err) => Promise.reject(err));
};

// Returns all bookings related to current user.
// LG Suggestion -- refactor .getAll and .adminGetAll
Booking.getAll = (limit, offset, user_id) => {
  return schema.findAll({
    where: {$or: [{customer_id: user_id}, {vendor_id: user_id}] },
    limit: limit,
    offset: offset,
    include: [{model: db.models.users, as: 'customer', attributes: ['email']}]
  })
    .then((models) => {
      if (!models) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      } else {
        return models;
      }
    })
    .catch((err) => Promise.reject(err));
};

// Returns all bookings.
Booking.adminGetAll = (limit, offset) => {
  return schema.findAll({
      limit, offset,
      include: [{ model: db.models.users, as: 'customer', attributes: ['email']}]
    })
    .then((models) => {
      if (!models) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      } else {
        return models;
      }
    })
    .catch((err) => Promise.reject(err));
};

// Returns all bookings filtered by status
Booking.adminFilteredGetAll = (limit, offset, filter, vendor_id) => {
  let where = {};
  filter ? where['state'] = filter : null;
  vendor_id ? where['vendor_id'] = vendor_id : null;
  return schema.findAll({
    where: where,
    limit: limit,
    offset: offset,
    include: [{ model: db.models.users, as: 'customer', attributes: ['email']}]
  })
      .then((models) => {
        if (!models) {
          return Promise.reject(errors.BOOKING_NOT_FOUND());
        } else {
          return models;
        }
      })
      .catch((err) => Promise.reject(err));
};

Booking.update = (query, data) => {
  const tags = getTags(data);
  const tagsFull = getTagsFull(data);
  return schema.findOne({where: query})
  .then((model) => {
    if (!model) {
      return Promise.reject(errors.BOOKING_NOT_FOUND());
    }
    return vendors.getOne(model.vendor_id)
      .then(() => {
        _.assign(model, data);
        return model.save();
      })
      .then((booking) => Booking.saveTags(booking, tags, tagsFull));
  })
  .then((updated) => {
    return Booking.getOneFilled(updated.id);
  })
  .catch((err) => Promise.reject(err));
};

Booking.remove = (query) => {
  return schema.destroy({where: query, force: true})
    .then((model) => {
      if (!model) {
        return Promise.reject(errors.BOOKING_NOT_FOUND());
      }
      return model;
    })
    .catch((err) => Promise.reject(err));

};

module.exports = Booking;
