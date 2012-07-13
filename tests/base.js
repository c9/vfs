var Parent = require('vfs-child').Parent;
var Client = require('vfs-http-transport/client').Client;
var httpTransport = require('vfs-http-transport/server');
var http = require('http');

exports.doubleProxy = doubleProxy;
exports.expect = expect;
exports.fulfill = fulfill;

var expectations = [];
function expect(name) {
    expectations.push(name);
}
function fulfill(name) {
    var index = expectations.indexOf(name);
    if (index < 0) {
        throw new Error("Extranaous fulfillment " + name);
    }
    expectations.splice(index, 1);
}

// Gets a doubly proxied vfs instance for testing purposes
function doubleProxy(callback) {
    var parent = new Parent({root: __dirname + "/mock/" });
    expect("doubleProxy.parent.connect");
    parent.connect(function (err, childVfs) {
        fulfill("doubleProxy.parent.connect");
        if (err) return callback(err);
        var server = http.createServer();
        httpTransport(childVfs, server, "/workspace/");
        expect("doubleProxy.server.listen");
        server.listen(function () {
            fulfill("doubleProxy.server.listen");
            var port = server.address().port;
            var client = new Client("ws://localhost:" + port + "/workspace/");
            expect("doubleProxy.client.connect");
            client.connect(function (err, vfs) {
                fulfill("doubleProxy.client.connect");
                callback(err, vfs, {parent:parent,client:client,server:server,childVfs:childVfs});
            });
        });
    });
}

process.on("exit", function () {
    if (expectations.length) {
        throw new Error("Unfulfilled expectation" + (expectations.length > 1 ? "s " : " ") + expectations.join(" "));
    }
});


// Compat for node 0.6.x
if (!Buffer.concat) {
    Buffer.concat = function (list, totalLength) {
        if (!totalLength) {
            totalLength = 0;
            for (var i = 0, l = list.length; i < l; i++) {
                totalLength += list[i].length;
            }
        }
        var buffer = new Buffer(totalLength);
        var offset = 0;
        for (var i = 0, l = list.length; i < l; i++) {
            list[i].copy(buffer, offset);
            offset += list[i].length;
        }
        return buffer;
    };
}