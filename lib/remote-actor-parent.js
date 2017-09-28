/*
 * Copyright (c) 2016-2017 Untu, Inc.
 * This code is licensed under Eclipse Public License - v 1.0.
 * The full license text can be found in LICENSE.txt file and
 * on the Eclipse official site (https://www.eclipse.org/legal/epl-v10.html).
 */

'use strict';

var ForkedActorParent = require('./forked-actor-parent.js');
var EventEmitter = require('events').EventEmitter;
var common = require('./utils/common.js');
var _ = require('underscore');

/**
 * Represents a parent (originator) process endpoint of a remote actor.
 */
class RemoteActorParent extends ForkedActorParent {
  /**
   * @param {Object} options Actor options.
   * - {ActorSystem} system Actor system.
   * - {Actor} parent Parent actor.
   * - {Object} definition Actor behaviour definition.
   * - {MessageSocket} bus Message bus to send/receive messages.
   * - {String} id Actor ID.
   * - {String} name Actor name.
   * - {Boolean} pingChild Whether to ping child actor.
   */
  constructor(options) {
    super(_.omit(options, 'pingChild'));
    EventEmitter.call(this);

    if (options.pingChild) {
      this.connectivityCheckStartTimeout = setTimeout(() => {
        this.connectivityCheckInterval = setInterval(() => {
          var lastPingTs = this._getLastReceiveTimestamp() || 0;
          var now = _.now();

          if (now - lastPingTs > options.system.getPingTimeout()) {
            options.bus.destroy();
            clearInterval(this.connectivityCheckInterval);

            this.emit('child-ping-timeout');
          }
        }, 1000);
      }, options.system.getPingTimeout());
    }
  }

  getMode() {
    return 'remote';
  }

  destroy0() {
    clearTimeout(this.connectivityCheckStartTimeout);
    clearInterval(this.connectivityCheckInterval);

    return super.destroy0();
  }

  _getReferenceMarshaller() {
    return this.getSystem().getRemoteActorReferenceMarshaller();
  }

  toString() {
    var name = this.getName();

    if (name) {
      return 'RemoteActorParent(' + this.getId() + ', ' + name + ')';
    }
    else {
      return 'RemoteActorParent(' + this.getId() + ')';
    }
  }
}

common.mixin(RemoteActorParent, EventEmitter);

module.exports = RemoteActorParent;