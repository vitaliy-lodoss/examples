const schema = require('./schemas/users');
const _ = require('lodash');
const log = require('../common/logger').getLogger('model/users');
const errors = require('../common/errors/errors');
const Promise = require('bluebird');
const crypto = require('crypto');
const shortid = require('shortid');
const paymentLib = require('../common/payment');

let User = {};

User.insert = (data) => {
  return schema.create({
    email: data.email,
    password: data.password || shortid.generate(), //Admin can create customer without password
    type: data.type,
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone || "",
    state: data.state,
    paymentProvider: data.paymentProvider, // LG - TODO, Validate
    mailchimpId: data.mailchimpId || "", // LG - TODO, Validate
  })
  .then((user) => {
    return paymentLib.createCustomer({email: user.email})
      .then((customer) => {
        user.customerId = customer.id;
        return user.save();
      })
      .then((updated) => updated.get({plain: true}));
  })
  .catch((err) => {
    if (err.name == 'SequelizeUniqueConstraintError'){
      return Promise.reject(errors.EMAIL_ALREADY_IN_USE());
    } else {
      return Promise.reject(err);
    }
  });
};

User.checkPassword = (email, password) => {
  log.debug('email, password', email, password);
  return schema.findOne({where: { email: email}})
    .then((user) => {
      if (user) {
        return crypto.createHmac("sha1", user.salt).update(password).digest('hex') === user.password;
      } else {
        return false;
      }
    });
};

User.getByEmail = (email) => {
  return schema.findOne({where: {email: email}})
    .then((user) => {
      if (user) {
        return user.get({plain: true})
      } else {
        return null
      }
    });
};

User.get = (user_id) => {
  return schema.findOne({where: {id: user_id}})
    .then((user) => {
      if (user) {
        return user.get({plain: true})
      } else {
        return null
      }
    });
};

User.getAll = (users_types, limit, offset) => {
  const types_list = _.isArray(users_types) ? users_types : ['customer'];
  return schema.findAll({
    where: {
      type: {
        $in: types_list
      }
    },
    limit: limit,
    offset: offset,
    attributes: {
      // exclude: ['password', 'salt', 'hashedPassword', 'paymentProvider', 'mailchimpId']
      exclude: ['password', 'salt', 'hashedPassword']
    }
  })
    .then((users) => {
      if (!users) {
        return Promise.reject(errors.USER_NOT_FOUND());
      } else {
        return users;
      }
    })
    .catch((err) => Promise.reject(err));
};

User.getProfile = (user_id) => {
  return schema.findOne({where: {id: user_id},
    attributes: {exclude: ['password', 'salt', 'hashedPassword']}})
    .then((user) => {
      if (user) {
        return user.get({plain: true});
      } else {
        return null;
      }
    });
};

User.changePassword = (user_id, old_password, new_password) => {
  return User.get(user_id)
    .then((user) => {
      if (user && crypto.createHmac("sha1", user.salt).update(old_password).digest('hex') === user.password) {
        return schema.update({
          password: new_password
        }, {
          where: {
          id: user_id
        }});
      } else {
        return Promise.reject(errors.PASSWORD_NOT_MATCH())
      }
    })
    .then(() => new_password);
};

User.changePasswordByToken = (user_id, token, new_password) => {
  return User.get(user_id)
    .then((user) => {
      if (user && token === user.reset_token) {
        return schema.update({
          password: new_password,
          reset_token: null
        }, {
          where: {
          id: user_id
        }});
      } else {
        return Promise.reject(errors.OPERATION_NOT_PERMITTED())
      }
    })
    .then(() => new_password);
};

User.update = (user_id, data) => {
  if (_.isEmpty(data)) return Promise.reject(errors.MISSING_REQUIRED_FIELDS());
  return schema.findOne({where: {id: user_id}, attributes: {exclude: ['password', 'salt', 'hashedPassword']}})
    .then((record) => {
      if (!record) {
        return Promise.reject(errors.USER_NOT_FOUND());
      }
      let updated = {};
      data.email ? updated['email'] = data.email : null;
      data.firstName ? updated['firstName'] = data.firstName : null;
      data.lastName ? updated['lastName'] = data.lastName : null;
      data.phone != '' ? updated['phone'] = data.phone : null;
      (data.mailchimpId && data.mailchimpId != '') ? updated['mailchimpId'] = data.mailchimpId : null;
      data.paymentProvider ? updated['paymentProvider'] = data.paymentProvider : null;
      data.lastLogin ? updated['lastLogin'] = data.lastLogin : null;
      data.salt ? updated['salt'] = data.salt : null;
      data.reset_token ? updated['reset_token'] = data.reset_token : null;
      data.type && _.some(['customer', 'vendor'], _.matches(data.type)) ? updated['type'] = data.type : null;
      // TODO improve handling on null defaults
      return record.updateAttributes(updated)
    })
    .catch((err) => {
      if (err.name == 'SequelizeUniqueConstraintError'){
        return Promise.reject(errors.EMAIL_ALREADY_IN_USE());
      } else {
        return Promise.reject(err);
      }
    });
};

User.remove = (user_id) => {
  return schema.destroy({where: {id: user_id}, force: true })
    .then((result) => {
      if (!result) {
        return Promise.reject(errors.USER_NOT_FOUND());
      }
      return result;
    });
};

module.exports = User;
