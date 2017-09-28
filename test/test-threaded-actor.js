/*
 * Copyright (c) 2016-2017 Untu, Inc.
 * This code is licensed under Eclipse Public License - v 1.0.
 * The full license text can be found in LICENSE.txt file and
 * on the Eclipse official site (https://www.eclipse.org/legal/epl-v10.html).
 */

'use strict';

/* eslint require-jsdoc: "off" */

var actors = require('../index');
var expect = require('chai').expect;
var http = require('http');
var net = require('net');
var request = require('supertest');
var P = require('bluebird');
var _ = require('underscore');

var system;
var rootActor;

describe('ForkedActor', function() {
  beforeEach(function() {
    system = actors({
      test: true,
      additionalRequires: 'ts-node/register'
    });

    return system.rootActor().then(rootActor0 => {
      rootActor = rootActor0;
    });
  });

  afterEach(function() {
    return system.destroy();
  });

  describe('sendAndReceive()', function() {
    it('should throw error if handler threw error', function(done) {
      rootActor
        .createChild({
          myMessage: () => {
            throw new Error('Sorry!');
          }
        }, { mode: 'threaded' })
        .then(testActor => testActor.sendAndReceive('myMessage', 'Hi!'))
        .then(() => {
          done('Expected error!');
        })
        .catch(err => {
          expect(err.message).to.be.equal('Sorry!');
        })
        .then(done)
        .catch(done);
    });

    it('should run in a same process and perform message exchange', P.coroutine(function*() {
      var behaviour = {
        getPid: () => {
          return process.pid;
        }
      };

      var child = yield rootActor.createChild(behaviour, { mode: 'threaded' });
      var pid = yield child.sendAndReceive('getPid');

      expect(pid).to.be.a.number;
      expect(pid).to.be.equal(process.pid);
    }));

    it('should be able to send a message to parent actor', P.coroutine(function*() {
      var replyMsg = yield new P((resolve, reject) => {
        var parentBehaviour = {
          reply: function(msg) {
            resolve(msg);
          }
        };
        var childBehaviour = {
          initialize: function(selfActor) {
            this.parent = selfActor.getParent();
          },

          sayHello: function() {
            return this.parent.sendAndReceive('reply', 'Hi!');
          }
        };

        rootActor.createChild(parentBehaviour)
          .then(parent => parent.createChild(childBehaviour, { mode: 'threaded' }))
          .then(child => child.sendAndReceive('sayHello'))
          .catch(reject);
      });

      expect(replyMsg).to.be.equal('Hi!');
    }));

    it('should be able to forward messages to parent', P.coroutine(function*() {
      var replyMsg = yield new P((resolve, reject) => {
        var parentBehaviour = {
          reply: function(msg) {
            resolve(msg);
          }
        };
        var childBehaviour = {
          initialize: function(selfActor) {
            selfActor.forwardToParent('reply');

            return selfActor
              .createChild({
                initialize: function(selfActor) {
                  this.parent = selfActor.getParent();
                },

                sayHello: function() {
                  return this.parent.sendAndReceive('reply', 'Hi!');
                }
              })
              .then(child => this.child = child);
          },

          sayHello: function() {
            return this.child.sendAndReceive('sayHello');
          }
        };

        rootActor.createChild(parentBehaviour)
          .then(parent => parent.createChild(childBehaviour, { mode: 'threaded' }))
          .then(child => child.sendAndReceive('sayHello'))
          .catch(reject);
      });

      expect(replyMsg).to.be.equal('Hi!');
    }));

    it('should support custom object marshallers in object form', P.coroutine(function*() {
      class TestMessageClass {
        constructor(pid) {
          this.pid = pid;
        }

        getPid() {
          return this.pid;
        }
      }

      yield system.destroy();

      system = actors({
        test: true,
        marshallers: [
          {
            type: TestMessageClass,
            marshall: function(msg) {
              return { pid: msg.pid };
            },
            unmarshall: function(msg) {
              return {
                getPid: () => msg.pid
              };
            }
          }
        ]
      });

      var rootActor = yield system.rootActor();
      var child = yield rootActor.createChild(
        {
          sayHello: (msg) => 'Hello ' + msg.getPid()
        },
        { mode: 'threaded' });

      var result = yield child.sendAndReceive('sayHello', new TestMessageClass(process.pid));

      expect(result).to.be.equal('Hello ' + process.pid);
    }));

    it('should support custom object marshallers in class form', P.coroutine(function*() {
      class TestMessageClass {
        static typeName() {
          return 'TestMessageClass';
        }

        constructor(pid) {
          this.pid = pid;
        }

        getPid() {
          return this.pid;
        }
      }
      class TestMessageClassMarshaller {
        getType() {
          return 'TestMessageClass';
        }

        marshall(msg) {
          return { pid: msg.pid };
        }

        unmarshall(msg) {
          return {
            getPid: () => msg.pid
          };
        }
      }

      yield system.destroy();

      system = actors({
        test: true,
        marshallers: [TestMessageClassMarshaller]
      });

      var rootActor = yield system.rootActor();
      var child = yield rootActor.createChild(
        {
          sayHello: (msg) => 'Hello ' + msg.getPid()
        },
        { mode: 'threaded' });

      var result = yield child.sendAndReceive('sayHello', new TestMessageClass(process.pid));

      expect(result).to.be.equal('Hello ' + process.pid);
    }));

    it('should support custom module-based object marshallers in class form', P.coroutine(function*() {
      class TestMessageClass {
        static typeName() {
          return 'TestMessageClass';
        }

        constructor(pid) {
          this.pid = pid;
        }

        getPid() {
          return this.pid;
        }
      }

      yield system.destroy();

      system = actors({
        test: true,
        marshallers: ['/test-resources/actors/test-message-class-marshaller']
      });

      var rootActor = yield system.rootActor();
      var child = yield rootActor.createChild(
        {
          sayHello: (msg) => 'Hello ' + msg.getPid()
        },
        { mode: 'threaded' });

      var result = yield child.sendAndReceive('sayHello', new TestMessageClass(process.pid));

      expect(result).to.be.equal('Hello ' + process.pid);
    }));

    it('should support variable arguments', P.coroutine(function*() {
      var child = yield rootActor.createChild({
        hello: (from, to) => `Hello from ${from} to ${to}.`
      }, { mode: 'threaded' });

      var result = yield child.sendAndReceive('hello', 'Bob', 'Alice');

      expect(result).to.be.equal('Hello from Bob to Alice.');
    }));

    it('should be able to marshall each variable argument with a custom marshaller', P.coroutine(function*() {
      class TestMessageClass {
        static typeName() {
          return 'TestMessageClass';
        }

        constructor(pid) {
          this.pid = pid;
        }

        getPid() {
          return this.pid;
        }
      }

      yield system.destroy();

      system = actors({
        test: true,
        marshallers: ['/test-resources/actors/test-message-class-marshaller']
      });

      var rootActor = yield system.rootActor();
      var child = yield rootActor.createChild(
        {
          sayHello: (msg, from) => `Hello ${msg.getPid()} from ${from}`
        },
        { mode: 'threaded' });

      var result = yield child.sendAndReceive('sayHello', new TestMessageClass(process.pid), 'Test');

      expect(result).to.be.equal(`Hello ${process.pid} from Test`);
    }));

    it('should support http.Server object transfer', P.coroutine(function*() {
      var server = http.createServer();

      server.listen(8888);

      var child = yield rootActor.createChild({
        setServer: function(server) {
          // Handle HTTP requests.
          server.on('request', (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello!');
          });

          this.server = server;
        },

        destroy: function() {
          return require('bluebird').fromCallback(cb => {
            this.server.close(cb);
          });
        }
      }, { mode: 'threaded' });

      yield child.sendAndReceive('setServer', server);

      // Close server in this process to avoid receiving connections locally.
      yield P.fromCallback(cb => {
        server.close(cb);
      });

      yield request('http://127.0.0.1:8888')
        .get('/')
        .expect(200)
        .then(res => {
          expect(res.text).to.be.equal('Hello!');
        });
    }));

    it('should support net.Server object transfer', P.coroutine(function*() {
      var server = net.createServer();

      yield P.fromCallback(cb => {
        server.listen(8889, '127.0.0.1', cb);
      });

      var child = yield rootActor.createChild({
        setServer: function(server) {
          // Send hello message on connection.
          server.on('connection', socket => {
            socket.end('Hello!');
          });

          this.server = server;
        },

        destroy: function() {
          return require('bluebird').fromCallback(cb => {
            this.server.close(cb);
          });
        }
      }, { mode: 'threaded' });

      yield child.sendAndReceive('setServer', server);

      // Close server in this process to avoid receiving connections locally.
      yield P.fromCallback(cb => {
        server.close(cb);
      });

      var serverMessage = yield P.fromCallback(cb => {
        var clientSocket = new net.Socket();

        clientSocket.setEncoding('UTF8');

        clientSocket.on('data', data => {
          cb(null, data);
        });

        clientSocket.connect(8889, '127.0.0.1', (err) => {
          if (err) return cb(err);
        });
      });

      expect(serverMessage).to.be.equal('Hello!');
    }));

    it('should be able to pass actor references', P.coroutine(function*() {
      var rootActor = yield system.rootActor();
      var localCounter = 0;
      var localChild = yield rootActor.createChild({
        tell: msg => {
          localCounter++;

          return msg.toUpperCase();
        }
      });
      var forkedChild = yield rootActor.createChild({
        setLocal: function(actor) {
          this.localActor = actor;
        },

        tellLocal: function(msg) {
          return this.localActor.sendAndReceive('tell', msg);
        }
      }, { mode: 'threaded' });

      yield forkedChild.sendAndReceive('setLocal', localChild);

      var result = yield forkedChild.sendAndReceive('tellLocal', 'Hello!');

      expect(result).to.be.equal('HELLO!');
      expect(localCounter).to.be.equal(1);
    }));
  });

  describe('send()', function() {
    it('should support variable arguments', P.coroutine(function*() {
      var replyDfd = P.pending();
      var parent = yield rootActor.createChild({
        helloReply: function(from, to) {
          replyDfd.resolve(`Hello reply from ${from} to ${to}.`);
        }
      }, { mode: 'in-memory' });
      var child = yield parent.createChild({
        initialize: function(selfActor) {
          this.parent = selfActor.getParent();
        },

        hello: function(from, to) {
          this.parent.send('helloReply', to, from);
        }
      }, { mode: 'threaded' });

      yield child.send('hello', 'Bob', 'Alice');

      var result = yield replyDfd.promise;

      expect(result).to.be.equal('Hello reply from Alice to Bob.');
    }));
  });

  describe('createChild()', function() {
    it('should support ES6 class behaviour definitions', function() {
      class TestBase {
        sayHello() {
          return 'Hello from ' + this.name;
        }
      }

      class TestActor extends TestBase {
        initialize() {
          this.name = 'TestActor';
        }
      }

      return rootActor
        .createChild(TestActor, { mode: 'threaded' })
        .then(testActor => testActor.sendAndReceive('sayHello'))
        .then(result => expect(result).to.be.equal('Hello from TestActor'));
    });

    it('should support ES5 class behaviour definitions', function() {
      var TestActor = function() {
      };

      TestActor.prototype.initialize = function() {
        this.name = 'TestActor';
      };
      TestActor.prototype.sayHello = function() {
        return 'Hello from ' + this.name;
      };

      return rootActor
        .createChild(TestActor, { mode: 'threaded' })
        .then(testActor => testActor.sendAndReceive('sayHello'))
        .then(result => expect(result).to.be.equal('Hello from TestActor'));
    });

    it('should support ES5 class behaviour definitions in named function form', function() {
      function TestActor() {
        this.name = 'TestActor';
      }

      TestActor.prototype.initialize = function() {
        this.name += ' initialized';
      };
      TestActor.prototype.sayHello = function() {
        return 'Hello from ' + this.name;
      };

      return rootActor
        .createChild(TestActor, { mode: 'threaded' })
        .then(testActor => testActor.sendAndReceive('sayHello'))
        .then(result => expect(result).to.be.equal('Hello from TestActor initialized'));
    });

    it('should support ES5 class behaviour definition with inheritance', function() {
      function TestBase() {
      }

      TestBase.prototype.sayHello = function() {
        return 'Hello from ' + this.name;
      };

      function TestActor() {
        TestBase.call(this);
      }

      actors.inherits(TestActor, TestBase);

      TestActor.prototype.initialize = function() {
        this.name = 'TestActor';
      };

      return rootActor
        .createChild(TestActor, { mode: 'threaded' })
        .then(testActor => testActor.sendAndReceive('sayHello'))
        .then(result => expect(result).to.be.equal('Hello from TestActor'));
    });

    it('should be able to load an actor from a given module', function() {
      return rootActor
        .createChild('/test-resources/actors/test-actor', { mode: 'threaded' })
        .then(actor => {
          expect(actor.getName()).to.be.equal('TestActor');

          return actor.sendAndReceive('hello', 123)
            .then(response => {
              expect(response).to.be.equal('Hello 123!');
            });
        });
    });

    it('should be able to load an actor from a given TypeScript module', function() {
      return rootActor
        .createChild('/test-resources/actors/test-typescript-actor', { mode: 'threaded' })
        .then(actor => {
          expect(actor.getName()).to.be.equal('TestActor');

          return actor.sendAndReceive('hello', '123')
            .then(response => {
              expect(response).to.be.equal('Hello 123!');
            });
        });
    });

    it('should be able to pass custom parameters to child actor', P.coroutine(function*() {
      class MyActor {
        initialize(selfActor) {
          this.helloResponse = selfActor.getCustomParameters().helloResponse;
        }

        hello() {
          return this.helloResponse;
        }
      }

      // Create child actor with custom parameter.
      var childActor = yield rootActor.createChild(MyActor, {
        mode: 'threaded',
        customParameters: { helloResponse: 'Hi there!' }
      });

      var response = yield childActor.sendAndReceive('hello');

      expect(response).to.be.equal('Hi there!');
    }));

    it('should be able to pass actor references through custom parameters', P.coroutine(function*() {
      var rootActor = yield system.rootActor();
      var localCounter = 0;
      var localChild = yield rootActor.createChild({
        tell: msg => {
          localCounter++;

          return msg.toUpperCase();
        }
      });
      var forkedChild = yield rootActor.createChild({
        initialize: function(selfActor) {
          this.localActor = selfActor.getCustomParameters().localActor;
        },

        tellLocal: function(msg) {
          return this.localActor.sendAndReceive('tell', msg);
        }
      }, {
        mode: 'threaded',
        customParameters: {
          localActor: localChild
        }
      });

      var result = yield forkedChild.sendAndReceive('tellLocal', 'Hello!');

      expect(result).to.be.equal('HELLO!');
      expect(localCounter).to.be.equal(1);
    }));

    it('should be able to pass http.Server object as custom parameter to child actor', P.coroutine(function*() {
      var server = http.createServer();

      server.listen(8888);

      yield rootActor.createChild({
        initialize: function(selfActor) {
          this.server = selfActor.getCustomParameters().server;

          // Handle HTTP requests.
          this.server.on('request', (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello!');
          });
        },

        destroy: function() {
          return require('bluebird').fromCallback(cb => {
            this.server.close(cb);
          });
        }
      }, { mode: 'threaded', customParameters: { server: server } });

      // Close server in this process to avoid receiving connections locally.
      yield P.fromCallback(cb => {
        server.close(cb);
      });

      yield request('http://127.0.0.1:8888')
        .get('/')
        .expect(200)
        .then(res => {
          expect(res.text).to.be.equal('Hello!');
        });
    }));

    it('should be able to pass net.Server object as custom parameter to child actor', P.coroutine(function*() {
      var server = net.createServer();

      yield P.fromCallback(cb => {
        server.listen(8889, '127.0.0.1', cb);
      });

      yield rootActor.createChild({
        initialize: function(selfActor) {
          this.server = selfActor.getCustomParameters().server;

          // Send hello message on connection.
          this.server.on('connection', socket => {
            socket.end('Hello!');
          });
        },

        destroy: function() {
          return require('bluebird').fromCallback(cb => {
            this.server.close(cb);
          });
        }
      }, { mode: 'threaded', customParameters: { server: server } });

      // Close server in this process to avoid receiving connections locally.
      yield P.fromCallback(cb => {
        server.close(cb);
      });

      var serverMessage = yield P.fromCallback(cb => {
        var clientSocket = new net.Socket();

        clientSocket.setEncoding('UTF8');

        clientSocket.on('data', data => {
          cb(null, data);
        });

        clientSocket.connect(8889, '127.0.0.1', (err) => {
          if (err) return cb(err);
        });
      });

      expect(serverMessage).to.be.equal('Hello!');
    }));
  });

  describe('createChildren()', function() {
    it('should create module actor children from a specified directory', P.coroutine(function*() {
      var childActors = yield rootActor.createChildren('/test-resources/actors/child-actors', { mode: 'threaded' });

      expect(childActors.length).to.be.equal(2);

      var childActorNames = _.map(childActors, actor => actor.getName());

      expect(childActorNames).to.have.members(['ChildActor1', 'ChildActor2']);

      var childActorReplies = yield P.map(childActors, actor => actor.sendAndReceive('hello'));

      expect(childActorReplies).to.have.members(['Hello from ChildActor1', 'Hello from ChildActor2']);
    }));
  });

  describe('forwardToChild()', function() {
    it('should forward messages with given topics to a given child actor', P.coroutine(function*() {
      var parent = yield rootActor.createChild({
        initialize: selfActor => {
          // Create first child that receives 'hello' messages and sends 'tell...' messages to parent.
          var child1Promise = selfActor
            .createChild({
              initialize: function(selfActor) {
                this.parent = selfActor.getParent();
              },

              hello: function(msg) {
                return this.parent.sendAndReceive('tellChild2', msg);
              }
            }, { mode: 'threaded' })
            .then(child1 => {
              // Forward 'hello' messages to this child.
              return selfActor.forwardToChild(child1, 'hello');
            });

          // Create second child that receives 'tell...' messages and writes to mailbox.
          var child2Promise = selfActor
            .createChild({
              initialize: function() {
                this.mailbox = [];
              },

              tellChild2: function(msg) {
                this.mailbox.push(msg);
              },

              getMailbox: function() {
                return this.mailbox;
              }
            }, { mode: 'threaded' })
            .then(child2 => {
              // Forward 'tell...' and 'getMailbox' messages to this child.
              return selfActor.forwardToChild(child2, /^tell.*/, 'getMailbox');
            });

          return P.join(child1Promise, child2Promise);
        }
      });

      yield parent.sendAndReceive('hello', 'World!');

      var child2Mailbox = yield parent.sendAndReceive('getMailbox');

      expect(child2Mailbox).to.have.members(['World!']);
    }));
  });

  describe('metrics()', function() {
    it('should collect metrics from target actor and all the actor sub-tree', P.coroutine(function*() {
      var parent = yield rootActor.createChild({
        metrics: function() {
          return {
            parentMetric: 111
          };
        }
      });
      yield parent.createChild({
        metrics: function() {
          return {
            childMetric: 222
          };
        }
      }, { name: 'Child1', mode: 'threaded' });
      yield parent.createChild({
        metrics: function() {
          return {
            childMetric: 333
          };
        }
      }, { name: 'Child2', mode: 'threaded' });

      var metrics = yield parent.metrics();

      expect(metrics).to.be.deep.equal({
        parentMetric: 111,
        Child1: {
          childMetric: 222
        },
        Child2: {
          childMetric: 333
        }
      });
    }));

    it('should not collect metrics from destroyed actors', P.coroutine(function*() {
      var parent = yield rootActor.createChild({
        metrics: function() {
          return {
            parentMetric: 111
          };
        }
      });
      yield parent.createChild({
        metrics: function() {
          return {
            childMetric: 222
          };
        }
      }, { name: 'Child1', mode: 'threaded' });
      var child2 = yield parent.createChild({
        metrics: function() {
          return {
            childMetric: 333
          };
        }
      }, { name: 'Child2', mode: 'threaded' });

      yield child2.destroy();

      var metrics = yield parent.metrics();

      expect(metrics).to.be.deep.equal({
        parentMetric: 111,
        Child1: {
          childMetric: 222
        }
      });
    }));
  });
});