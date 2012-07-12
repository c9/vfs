var Consumer = require('vfs-socket/consumer').Consumer;
var WebSocketTransport = require('./transport').WebSocketTransport;
var inherits = require('util').inherits;
var WebSocket = require('ws');

exports.Client = Client;
inherits(Client, Consumer);
function Client(url) {
    Consumer.call(this);
    this.url = url;
}
Client.prototype.connect = function (callback) {
    var socket = new WebSocket(this.url);

    var transport = new WebSocketTransport(socket);
    socket.on("error", function (err) {
        callback(err);
    });
    var self = this;
    socket.on("open", function () {
        Consumer.prototype.connect.call(self, transport, callback)
    });

}
