/* Online-Transport: schlichtes Polling gegen api/index.php.
 * Kein WebSocket, weil nur PHP erlaubt ist - fuer drei Spieler reicht das. */
(function (global) {
  'use strict';

  var UDM = global.UDM;

  function Net(code, token, endpoint) {
    this.code = code;
    this.token = token;
    this.endpoint = endpoint || 'api/index.php';
    this.pending = false;
    this.failures = 0;
    this.onError = null;
    this.onFatal = null;
  }

  /** Schickt eine Aktion an den Server. Gibt ein Promise auf den State. */
  Net.prototype.call = function (action, payload) {
    var self = this;
    var body = Object.assign({ action: action, code: this.code, token: this.token }, payload || {});

    return fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () {
        throw new Error('Server antwortet nicht mit JSON (HTTP ' + res.status + ').');
      }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || ('HTTP ' + res.status));
          err.fatal = res.status === 403 || res.status === 404;
          err.state = data.state || null;
          throw err;
        }
        self.failures = 0;
        return data;
      });
    }).catch(function (err) {
      self.failures++;
      if (err.fatal && self.onFatal) { self.onFatal(err); }
      else if (self.onError) { self.onError(err); }
      throw err;
    });
  };

  /** Zustand holen und dabei die eigene Position melden. */
  Net.prototype.sync = function (pos) {
    return this.call('state', pos ? { pos: pos } : {});
  };

  Net.prototype.leave = function () {
    // Beim Verlassen der Seite muss es ohne Promise gehen.
    var body = JSON.stringify({ action: 'leave', code: this.code, token: this.token });
    if (global.navigator && global.navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      global.navigator.sendBeacon(this.endpoint, blob);
    } else {
      fetch(this.endpoint, { method: 'POST', body: body, keepalive: true });
    }
  };

  UDM.Net = Net;
}(window));
