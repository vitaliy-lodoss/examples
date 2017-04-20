const _ = require('lodash');
const log = require('../common/logger').getLogger('controllers/users');
const model = require('../models/users');
const mandrill = require('../common/powerdrill');
const Promise = require('bluebird');
const crypto = require('crypto');
const errors = require('../common/errors/errors');
const es = require('../common/elasticsearch').wrap;
const settings = require('../config').settings;

function searchResultConversion (records, total){
  let converted = {
    totalRecords: total,
    paging: {}
  };
  let promises = [];
  _.each(records, (item) => {
    if (item['_source'] && item['_source']['id']) {
      promises.push(model.getProfile(item['_source']['id']).catch((err) => { log.error(err) }));
    }
  });
  return Promise.all(promises)
    .then((results) => {
      converted['results'] = results;
      return converted
  })
}

let Users = {};

Users.insert = function(data){
  let user;
   return mandrill.sendMessage('welcome', {receiver: data.email, username: data.firstName + ' ' + data.lastName})
    .then(() => model.insert(data))
    .then((created) => {
      user = created;
      let es_record = {
        id: user.id,
        email: user.email,
        type: user.type,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone || '',
        created: user.created,
      };
      return es.create('users', es_record);
    })
    .then(() => {
      return user;
    })
};

Users.get = (user_id) => {
  return model.getProfile(user_id)
    .then((profile) => {
      if (profile) {
        return profile;
      } else {
        return Promise.reject(errors.USER_NOT_FOUND())
      }
    });
};

Users.remove = function(user_id, user){
  if (user.id == user_id || user.role == 'admin') {
    return model.remove(user_id)
      .then(() => {
        es.getById('users', user_id);
      })
      .then((result) => {
        if (result) es.remove('users', result['_id']);
      })
      .then(() => {
        return { message: "User has been successfully removed." };
      })
  } else {
    return Promise.reject(errors.OPERATION_NOT_PERMITTED())
  }
};

Users.update = function(user_id, data, user){
  let updated;
  if (user.id == user_id || user.role == 'admin') {
    return model.update(user_id, data)
      .then((record) => {
        updated = record;
        return es.getById('users', user_id);
      })
      .then((record) => {
        let es_record = {};
        data.email ? es_record['email'] = data.email : null;
        data.firstName ? es_record['firstName'] = data.firstName : null;
        data.lastName ? es_record['lastName'] = data.lastName : null;
        data.phone ? es_record['phone'] = data.phone : null;
        data.type && _.some(['customer', 'vendor'], _.matches(data.type)) ? es_record['type'] = data.type : null;
        return es.update('users', es_record, record['_id'])
      })
      .then(() => {
        return updated;
      })
  } else {
    return Promise.reject(errors.OPERATION_NOT_PERMITTED())
  }
};

Users.getAll = function(user, limit, offset){
  log.debug(user);
  if (user.role == 'admin') {
    return model.getAll(['customer', 'vendor', 'admin'], limit, offset);
  } else {
    return this.getProfile(user).then((profile) => [profile])
  }
};

Users.search = function(query, limit, offset){
  query = query ? query : '';
  limit = limit ? limit : 10;
  offset = offset ? offset : 0;
  return es.getByQuery('users', query, limit, offset)
  .then((results) => {
    let [records, total] = results;
    return searchResultConversion (records, total);
  })
};

Users.getProfile = function(user){
  return model.getProfile(user.id)
  .then(function(profile){
    if (profile) {
      
      // The fields below are copied onto 'profile.state'
      // see models/schemas/users.js
      // because of that they can be safely removed from the object.
      // e.g. profile.state.tandc
      delete profile.created;
      delete profile.lastLogin;
      delete profile.tandc;
      delete profile.updated;

      return profile;
    } else {
      return Promise.reject(errors.USER_NOT_FOUND())
    }
  });
};

Users.setPassword = function(user_id, data, user){
  if (user.id == user_id || user.role == 'admin') {
    return model.changePassword(user_id, data.currentPassword, data.newPassword)
      .then(function(){
        return { message: "Password has been successfully updated." };
      });
  } else {
    return Promise.reject(errors.OPERATION_NOT_PERMITTED());
  }
};

Users.setPasswordByToken = function(user_id, data){
  return model.changePasswordByToken(user_id, data.token, data.newPassword)
    .then(function(){
      return { message: "Password has been successfully updated." };
    });
};

Users.forgotPassword = (user_id) => {
  return model.get(user_id)
    .then((user) => create_token(user));
};

Users.forgotPasswordUserFriendly = (email) => {
  return model.getByEmail(email)
    .then((user) => create_token(user));
};

function create_token(user){
  if (user) {
    const token = crypto.createHmac("sha1", user.salt).update(user.id).digest('hex');
    const link =  `${settings.frontend_location}/users/${user.id}/password/forgot/${token}`;
    return mandrill.sendMessage('forgot', {receiver: user.email, link: link, username: `${user.firstName} ${user.lastName}`})
      .then((result) => {
        if(process.env.NODE_ENV == 'test') {
          return {token};
        }
        return Promise.resolve( { message: 'Password reset requested.' } );
      })
  } else {
    return Promise.reject(errors.USER_NOT_FOUND());
  }
}

Users.resetPassword = (user_id, token) => {
  return model.get(user_id)
    .then((user) => {
      if (user) {
        const calculated_token = crypto.createHmac("sha1", user.salt).update(user.id).digest('hex');
        if (calculated_token == token) {
          const salt = Math.random() + '';
          const new_token = crypto.createHmac("sha1", salt).update(user.id + new Date()).digest('hex');
          return model.update(user.id, {reset_token: new_token, salt: salt});
        } else {
          return Promise.reject(errors.OPERATION_NOT_PERMITTED());
        }
      } else {
        return Promise.reject(errors.USER_NOT_FOUND());
      }
    })
    .then((updated_user) => updated_user.get({plain: true}));
};

module.exports = Users;
