'use strict';

var Socket = require('ws')
  , connections = {}
  , concurrent = 0;

//
// Get the session document that is used to generate the data.
//
var session = require(process.argv[2]);

//
// WebSocket connection details.
//
var masked = process.argv[4] === 'true'
  , binary = process.argv[5] === 'true'
  , protocol = +process.argv[3] || 7;

process.on('message', function message(task) {
  var now = Date.now();

  //
  // Write a new message to the socket. The message should have a size of x
  //
  if ('write' in task) {
    console.log("write");
    Object.keys(connections).forEach(function write(id) {
      write(connections[id], task, id);
    });
  }

  //
  // Shut down every single socket.
  //
  if (task.shutdown) {
    console.log("shutdown");
    Object.keys(connections).forEach(function shutdown(id) {
      connections[id].close();
    });
  }

  // End of the line, we are gonna start generating new connections.
  if (!task.url) return;

  // console.log("creating socket");
  var socket = new Socket(task.url, {
    protocolVersion: protocol
  });

  socket.on('open', function open() {
    process.send({ type: 'open', duration: Date.now() - now, id: task.id, concurrent: concurrent });
    socket.send('{"channel":"/meta/handshake","version":"1.0","supportedConnectionTypes":["websocket","long-polling"],"id":"1"}'.toString('utf-8'));
    // write(socket, task, task.id);
    // As the `close` event is fired after the internal `_socket` is cleaned up
    // we need to do some hacky shit in order to tack the bytes send.
  });

  socket.on('message', function message(data) {
    var clientId = ''
      , msgId = 0
      , msg = ''
      , channel = '';

    // console.dir(data);

    if (data.indexOf('"/meta/handshake","successful":true') > -1) {
      data = JSON.parse(data);
      clientId = data[0].clientId;
      msgId = parseInt(data[0].id, 10) + 1;
      msg = '{"channel":"/meta/connect","clientId":"' + clientId + '","connectionType":"websocket","id":"' + msgId + '"}';
      socket.send(msg.toString('utf-8'));
      channel = '/chat';
      msgId++;
      msg = '[{"channel":"/meta/subscribe","clientId":"'+ clientId + '","subscription":"' + channel + '","id":"' + msgId + '"}]';
      socket.send(msg.toString('utf-8'));
    } else if (data.indexOf('"/meta/subscribe","successful":true') > -1) {
      process.send({
        type: 'connection'
      });
      msgId++;
    } else if (data.indexOf('"channel":"/chat') > -1) {
      data = JSON.parse(data);
      process.send({
        type: 'message', latency: Date.now(), concurrent: concurrent,
        id: task.id, message: data[0].data.text
      });
    } else if (data === '[]') {
    } else if (data.indexOf('"advice":{"reconnect":"retry"') > -1) {
      data = JSON.parse(data);
      clientId = data[0].clientId;
      msgId = parseInt(data[0].id, 10) + 1;
      msg = '{"channel":"/meta/connect","clientId":"' + clientId + '","connectionType":"websocket","id":"' + msgId + '"}';
      socket.send(msg.toString('utf-8'));
    }
  });

  socket.on('close', function close() {
    console.log("close");
    var internal = socket._socket || {};

    process.send({
      type: 'close', id: task.id, concurrent: --concurrent,
      read: internal.bytesRead || 0,
      send: internal.bytesWritten || 0
    });

    delete connections[task.id];
  });

  socket.on('error', function error(err) {
    console.log("error: " + err.message);
    process.send({ type: 'error', message: err.message, id: task.id, concurrent: --concurrent });

    socket.close();
    delete connections[task.id];
  });

  setInterval( function () {
    if(socket.readyState === 1) {
      socket.send('[]'.toString('utf-8'));
    }
  }, 30000);

  // Adding a new socket to our socket collection.
  ++concurrent;
  connections[task.id] = socket;
});

/**
 * Helper function from writing messages to the socket.
 *
 * @param {WebSocket} socket WebSocket connection we should write to
 * @param {Object} task The given task
 * @param {String} id
 * @param {Function} fn The callback
 * @api private
 */
function write(socket, task, id, fn) {
  session[binary ? 'binary' : 'utf8'](task.size, function message(err, data) {
    var start = socket.last = Date.now();

    socket.send(data, {
      binary: binary,
      mask: masked
    }, function sending(err) {
      if (err) {
        process.send({ type: 'error', message: err.message, concurrent: --concurrent, id: id });

        socket.close();
        delete connections[id];
      }

      if (fn) fn(err);
    });
  });
}
