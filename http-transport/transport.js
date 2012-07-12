var EventEmitter = require('events').EventEmitter;
var smith = require('vfs-socket/worker').smith;
var inspect = require('util').inspect;
var msgpack = smith.msgpack;
var inherits = require('util').inherits;
exports.WebSocketTransport = WebSocketTransport;
inherits(WebSocketTransport, smith.Transport);

// "message" - event emitted when we get a message from the other side.
// "disconnect" - the transport was disconnected
// "error" - event emitted for stream error or disconnect
// "drain" - drain event from output stream
function WebSocketTransport(socket) {
    this.socket = socket;
    var self = this;
    socket.on("message", function (data) {
        var message;
        try {
            message = msgpack.decode(data);
        } catch (err) {
            self.emit("error", err);
            return;
        }
        // console.log(process.pid + " <- " + inspect(message, false, 2, true));
        self.emit("message", message);
    });
    socket.on("close", function () {
        self.emit("disconnect");
    });
    socket.on("error", function () {
        self.disconnect();
    });
    // TODO: Implement "drain" event properly.
}

WebSocketTransport.prototype.disconnect = function () {
  this.socket.terminate();
};

WebSocketTransport.prototype.send = function (message) {
    // console.log(process.pid + " -> " + inspect(message, false, 2, true));
    var data;
    try {
        data = msgpack.encode(message);
    } catch (err) {
        this.emit("error", err);
        return;
    }
    this.socket.send(data, {binary: true});
};

