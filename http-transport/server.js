var Worker = require('vfs-socket/worker').Worker;
var WebSocketTransport = require('./transport').WebSocketTransport;
var WebSocketServer = require('ws').Server;

// Takes in a vfs instance (vfs-ssh, vfs-child, vfs-local, ...), a websocket,
// and a namespace to listen under.
module.exports = setup;
function setup(vfs, server, namespace) {
    // Register the websocket listener at the namespace for the RPC half of the
    // interface.
    var wss = new WebSocketServer({ server: server, path: namespace });
    wss.on("connection", function (client) {
        // Wrap the local vfs in a worker.  We will serve it over http using the
        // websocket channel.
        var worker = new Worker(vfs);
        worker.connect(new WebSocketTransport(client));
        worker.on("error", function (err) {
          if (err && err.stack) console.error(err.stack);
          client.terminate();
        });
    });
};
