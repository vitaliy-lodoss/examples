const db = require('../../common/sequelize');
const sequelize = require('sequelize');
const crypto = require('crypto');
const Promise = require('bluebird');

const UsersSchema = db.define('users', {
  id: {
    type: sequelize.UUID,
    defaultValue: sequelize.UUIDV1,
    primaryKey: true
  },
  email: {
    type: sequelize.STRING,
    field: 'email',
    unique: true,
    validate: {
      isEmail: true
    }
  },
  hashedPassword: sequelize.STRING,
  salt: sequelize.STRING,
  password: {
    type: sequelize.VIRTUAL,
    set: function (password) {
      if (password) {
        this.salt = Math.random() + '';
        this.setDataValue('salt', this.salt);
        this.setDataValue('hashedPassword', crypto.createHmac("sha1", this.salt).update(password).digest('hex'));
      }
    },
    validate: {
      isLongEnough: function (password) {
        if (password.length < 8) {
          throw new Error("Please choose a longer password")
        }
      }
    },
    get: function(){
      return this.hashedPassword;
    }
  },
  mailchimpId: {
    type: sequelize.STRING(50),
    defaultValue: null,
    allowNull: true
  },
  'type': {
    type: sequelize.ENUM('vendor', 'customer', 'admin'),
    defaultValue: 'customer'
  },
  created: {
    type: sequelize.DATE,
    defaultValue: sequelize.NOW
  },
  updated: {
    type: sequelize.DATE,
    defaultValue: sequelize.NOW
  },
  firstName: {
    type: sequelize.STRING,
    allowNull: false
  },
  lastName: {
    type: sequelize.STRING(50),
    allowNull: false
  },
  phone: {
    type: sequelize.STRING(30),
    allowNull: true
  },
  state: {
    type: sequelize.VIRTUAL,
    get: function() {
      return {
        tandc: this.tandc,
        lastLogin: this.lastLogin,
        created: this.created,
        updated: this.updated
      }
    },
    set: function(obj) {
      if (obj && obj.tandc) {
        this.tandc = tandc;
      }
    }
  },
  paymentProvider: {
    type: sequelize.VIRTUAL,
    get: function() {
      return {
        name: 'Stripe',
        id: this.customerId
      }
    }
  },
  tandc: {
    type: sequelize.BOOLEAN,
    defaultValue: false
  },
  lastLogin: {
    type: sequelize.DATE,
    defaultValue: sequelize.NOW
  },
  customerId: {
    type: sequelize.STRING
  },
  reset_token: {
    type: sequelize.STRING
  },
  links: {
    type: sequelize.VIRTUAL,
    get: function() {
      return {
        self: `/users/${this.id}`
      }
    }
  }
}, {
  freezeTableName: true,
  createdAt: 'created',
  updatedAt: 'updated'
});

module.exports = UsersSchema;
