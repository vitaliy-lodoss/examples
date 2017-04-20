const express = require('express');
const router = express.Router();
const log = require('../common/logger').getLogger('router/users');
const controllers = require('../controllers');
const passport = require("../common/passport");
const errors = require('../common/errors/errors');
const validator = require('../common/validator');
const ensureAuthenticated = require('../common/passport').ensureAuthenticated;
const _ = require("lodash");
const paging = require('../common/utils').paging;

//User password change
router.post('/:id/password/', ensureAuthenticated, validator.checkPasswords, (req, res, next) => {
  return controllers.users.setPassword(req.params.id, req.body, req.user)
    .then((result) => res.data = result)
    .nodeify(next)
});

router.route('/:id')
  .get(ensureAuthenticated, (req, res, next) => {
    const handlers = {
      me: () => {
          return controllers.users.getProfile(req.user).then((result) => res.data = result).nodeify(next);
      },
      search: () => {
          return controllers.users.search(req.query.q, req.query.limit, req.query.offset, req.user)
            .then((result) => {
              if (result.paging) paging(req, result);
              res.data = result;
            }).nodeify(next);
      },
      logout: () => {
          req.logout();
          res.data = {logout: true};
          return next();
      }
    }
    if (_.includes(_.keys(handlers), req.params.id)){
      return handlers[req.params.id]();
    } else {
      return controllers.users.get(req.params.id)
        .then((result) => res.data = result).nodeify(next); 
    }
  })
  .patch(ensureAuthenticated, validator.isUserOwner, validator.checkUserUpdateParams, (req, res, next) => {
    return controllers.users.update(req.params.id, req.body, req.user)
      .then((result) => res.data = result)
      .nodeify(next);
  })
  .delete(ensureAuthenticated, (req, res, next) => {
    return controllers.users.remove(req.params.id, req.user)
      .then((result) => res.data = result)
      .nodeify(next);
  });

router.route('/')
  .get(ensureAuthenticated, (req, res, next) => {
    const limit = req.query.limit || 10;
    const offset = req.query.offset || 0;
    return controllers.users.getAll(req.user, limit, offset)
      .then((result) => res.data = result)
      .nodeify(next);
  });


module.exports = router;