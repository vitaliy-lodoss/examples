process.env.NODE_ENV = 'test';
const hooks = require('../e2e_hooks');
const should = require('should');
const log = require('log4js').getLogger('auth_e2e_test'); // DEBUG_REMOVE
const settings = require('../../config/config')['test'];
const request = require('request');
const errors = require('../../common/errors/errors');


function url(uri) {
  return `http://localhost:${settings.app.port}${settings.api_url}${uri}`;
};
let headers = {
  'Content-Type': 'application/json',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 6_1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10B141 Safari/8536.25'
};

let vendor_id = null;
let user_id = null;
let lastLogin = null;
const fake_vendor_id = '2d722700-8496-11e6-98ab-adc60f3c3d51';
const date = Date.now();
const new_user = {
  email: `some${date}@email.com`,
  firstName: 'first',
  lastName: 'last',
  password: 'asd123asd'
};

describe('auth API', function() {
  this.timeout(20000);

  before(hooks.before);
  after(hooks.after);

  describe('try to sign up user:', () => {

    it('try to signup user but get an error', (done) => {
      const data = {
        firstName: 'first',
        lastName: 'last',
        password: 'asd123asd'
      };
      request({
        url: url('/users/signup/'),
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      }, (err, res, body) => {
        res.statusCode.should.be.equal(errors.VALIDATION_ERRORS().status);
        body = JSON.parse(body);
        body.code.should.be.equal(errors.VALIDATION_ERRORS().code);
        done();
      });
    });

    it('try to signup user but get an error', (done) => {
      const data = {
        email: `some${date}@email.com`,
        firstName: 'first',
        lastName: 'last',
        password: ' asd123a  '
      };
      request({
        url: url('/users/signup/'),
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      }, (err, res, body) => {
        res.statusCode.should.be.equal(errors.VALIDATION_ERRORS().status);
        body = JSON.parse(body);
        body.code.should.be.equal(errors.VALIDATION_ERRORS().code);
        done();
      });
    });

    it('should signup user and return it', (done) => {

      request({
        url: url('/users/signup/'),
        method: 'POST',
        headers: headers,
        body: JSON.stringify(new_user)
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.accessToken.should.be.not.equal(null);
        headers.Authorization = `${body.token_type} ${body.accessToken}`;
        done();
      });
    });

    it('should return current user', (done) => {
      request({
        url: url('/users/me/'),
        method: 'GET',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.id.should.be.not.equal(null);
        user_id = body.id;
        lastLogin = body.state.lastLogin;
        done();
      });
    });

    // @TO-DO: need to think about it. token should expire self
    it('should logout user', (done) => {
      request({
        url: url('/users/logout/'),
        method: 'GET',
        headers: headers
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        delete headers.Authorization
        done();
      });
    });

    it('try to return current user, but get an error', (done) => {
      request({
        url: url('/users/me/'),
        method: 'GET',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(401);
        done();
      });
    });

    it('should try to signin user, but password not correct', (done) => {
      const data = {
        email: new_user.email,
        password: '123123123'
      };
      request({
        url: url('/users/login/'),
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      }, (err, res, body) => {
        res.statusCode.should.be.equal(errors.NOT_VALID_USERNAME_OR_PASSWORD().status);
        body = JSON.parse(body);
        body.code.should.be.equal(errors.NOT_VALID_USERNAME_OR_PASSWORD().code);
        done();
      });
    });

    it('should signin user via basic authorization header and get error', (done) => {
      headers['Authorization'] = 'afasfasfaggierq4q98ghjgiapg9=faspfokaspk';
      request({
        url: url('/users/login/'),
        method: 'POST',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(403);
        body = JSON.parse(body);
        body.code.should.be.equal(errors.NOT_VALID_USERNAME_OR_PASSWORD().code);
        done();
      });
    });

    it('should signin user via basic authorization header', (done) => {
      const data = new_user.email + ':' + new_user.password; 
      let auth = new Buffer(data).toString('base64')
      headers['Authorization'] = 'Basic ' + auth;
      request({
        url: url('/users/login/'),
        method: 'POST',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.accessToken.should.be.not.equal(null);
        headers.Authorization = `${body.token_type} ${body.accessToken}`;
        done();
      });
    });

    it('should return current user', (done) => {
      request({
        url: url('/users/me/'),
        method: 'GET',
        headers: headers,
      }, (err, res, body) => {
        console.log('body', body);
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.id.should.be.not.equal(null);
        user_id = body.id;
        body.state.lastLogin.should.be.above(lastLogin);
        done();
      });
    });

    it('should logout user', (done) => {
      request({
        url: url('/users/logout/'),
        method: 'GET',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        delete headers.Authorization
        done();
      });
    });

    it('should signin user', (done) => {
      const data = {
        email: new_user.email,
        password: new_user.password
      };
      request({
        url: url('/users/login/'),
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.accessToken.should.be.not.equal(null);
        headers.Authorization = `${body.token_type} ${body.accessToken}`;
        done();
      });
    });


    it('should return current user', (done) => {
      request({
        url: url('/users/me/'),
        method: 'GET',
        headers: headers,
      }, (err, res, body) => {
        res.statusCode.should.be.equal(200);
        body = JSON.parse(body);
        body.id.should.be.not.equal(null);
        user_id = body.id;
        body.state.lastLogin.should.be.above(lastLogin);
        done();
      });
    });

  });

});
