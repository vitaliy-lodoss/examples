const db = require('../../common/sequelize');
const sequelize = require('sequelize');
const Promise = require('bluebird');
const _ = require('lodash');
const VendorsSchema = require('./vendors');
const CustomersSchema = require('./users');
const PaymentsSchema = require('./payments');
const TagsSchema = require('./tags');

const BookingsSchema = db.define('bookings', {
  id: {
    type: sequelize.UUID,
    defaultValue: sequelize.UUIDV1,
    primaryKey: true
  },
  state: {
    type: sequelize.ENUM('booked', 'pending', 'approvedVendor', 'completed', 'declinedVendor', 'declinedAdmin'),
    defaultValue: 'pending'
  },
  covers: {
    type: sequelize.INTEGER,
    allowNull: false
  },
  menuPrice: {
    type: sequelize.FLOAT,
    allowNull: false
  },
  commission_fee: {
    type: sequelize.FLOAT,
    allowNull: false
  },
  service_fee: {
    type: sequelize.FLOAT,
    allowNull: false
  },
  timings: {
    type: sequelize.JSONB
  },
  location: {
    type: sequelize.JSONB
  },
  eventType: {
    type: sequelize.VIRTUAL,
    get: function() {
      const tags = (this.tags && this.tags.length) ? this.tags : [];
      let data = _.filter(tags, (tag) => (tag.pid == 5) ? true : false );
      return data.length > 0 ? data[0] : {};
      // return _.filter(tags, (tag) => (tag.pid == 5) ? true : false );
    }
  },
  dietary: {
    type: sequelize.VIRTUAL,
    get: function() {
      const tags = (this.tags && this.tags.length) ? this.tags : [];
      return {
        tags: _.filter(tags, (tag) => (tag.pid == 2) ? true : false ),
        notes: this.dietaryNotes
      };
    },
    set: function ({tags, notes}) {
      this.dietaryNotes = notes;
    }
  },
  payment: {
    type: sequelize.VIRTUAL,
    get: function () {
      const payment = (this.payments && this.payments.length) ? this.payments : [];
      return _.map(payment, 'id');
    }
  },
  dietaryNotes: {
    type: sequelize.STRING
  },
  logistics: {
    type: sequelize.JSONB
  },
  created: {
    type: sequelize.DATE,
    defaultValue: sequelize.NOW
  },
  updated: {
    type: sequelize.DATE,
    defaultValue: sequelize.NOW
  }
}, {
  freezeTableName: true,
  createdAt: 'created',
  updatedAt: 'updated'
});

BookingsSchema.belongsTo(VendorsSchema, {
  foreignKey: 'vendor_id',
  constraints: false,
  as: 'vendor'
});

BookingsSchema.belongsTo(CustomersSchema, {
  foreignKey: 'customer_id',
  constraints: false,
  as: 'customer'
});

BookingsSchema.hasMany(PaymentsSchema, {as: 'Payments', foreignKey: 'booking_id', constraints: false});

BookingsSchema.belongsToMany(TagsSchema, { as: 'Tags', through: 'booking_tags', foreignKey: 'booking_id' });
TagsSchema.belongsToMany(BookingsSchema, { as: 'Bookings', through: 'booking_tags', foreignKey: 'tag_id' });

module.exports = BookingsSchema;