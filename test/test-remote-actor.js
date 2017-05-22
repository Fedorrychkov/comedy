/*
 * Copyright (c) 2016 Untu, Inc.
 * This code is licensed under Eclipse Public License - v 1.0.
 * The full license text can be found in LICENSE.txt file and
 * on the Eclipse official site (https://www.eclipse.org/legal/epl-v10.html).
 */

'use strict';

var actors = require('../index');
var expect = require('chai').expect;
var P = require('bluebird');

var system;
var rootActor;
var remoteSystem;

describe('RemoteActor', function() {
  beforeEach(function() {
    system = actors({
      test: true,
      additionalRequires: 'ts-node/register'
    });

    remoteSystem = actors({
      test: true,
      additionalRequires: 'ts-node/register'
    });

    return system.rootActor().then(rootActor0 => {
      rootActor = rootActor0;

      return remoteSystem.listen();
    });
  });

  afterEach(function() {
    return P.join(system.destroy(), remoteSystem.destroy());
  });

  describe('sendAndReceive', function() {
    it('should perform message exchange with remote actor', P.coroutine(function*() {
      var behaviour = {
        sayHello: (to) => {
          return `Hello, ${to}!`;
        }
      };

      var remoteChild = yield rootActor.createChild(behaviour, { mode: 'remote', host: '127.0.0.1' });
      var response = yield remoteChild.sendAndReceive('sayHello', 'Bob');

      expect(response).to.be.equal('Hello, Bob!');

      // Destroy remote actor.
      yield remoteChild.destroy();

      // From this point, any additional communication should not be possible.
      var expectedErr = yield remoteChild.sendAndReceive('sayHello', 'Jack').catch(err => err);

      expect(expectedErr).to.be.instanceof(Error);
    }));

    it('should correctly fail if wrong port is specified', P.coroutine(function*() {
      var expectedErr = yield rootActor
        .createChild({}, { mode: 'remote', host: '127.0.0.1', port: 6262 })
        .catch(err => err);

      expect(expectedErr).to.be.instanceof(Error);
    }));
  });
});