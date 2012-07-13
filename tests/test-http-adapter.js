var http = require('http');
var assert = require('assert');
var stack = require('stack');
var httpAdapter = require('vfs-http-adapter');
var expect = require('./base').expect;
var fulfill = require('./base').fulfill;
var doubleProxy = require('./base').doubleProxy;
var urlParse = require('url').parse;

var readFileSync = require('fs').readFileSync;

var tests = [
    "readdir", {method:"GET", path:"/"}, function (res) {
        assert.equal(res.headers['content-type'], 'application/json');
        assert(res.headers.etag);
        assert(res.body.length);
    }
];

doubleProxy(function (err, vfs, extras) {
    if (err) throw err;
    var server = http.createServer(stack(
        httpAdapter("/", vfs)
    ));
    expect("server.listen");
    server.listen(function () {
        fulfill("server.listen");
        var url = "http://localhost:" + server.address().port + "/";

        var i = 0;
        (function runTest() {
            if (i >= tests.length) return done();
            var name = tests[i++];
            var input = tests[i++];
            var check = tests[i++];
            expect(name);
            request(name, input, check, function () {
                fulfill(name);
                runTest();
            });
        }());

        function request(name, input, check, callback) {
            var uri = urlParse(url);
            uri.method = input.method || "GET";
            if (input.path) uri.path = input.path;
            if (input.headers) uri.headers = input.headers;
            expect("http.request");
            var req = http.request(uri, function (res) {
                fulfill("http.request");
                var chunks = [];
                var totalLength = 0;
                expect("http.request.end");
                res.on("data", function (chunk) {
                    chunks.push(chunk);
                    totalLength += chunk.length;
                });
                res.on("end", function () {
                    fulfill("http.request.end");
                    res.body = Buffer.concat(chunks, totalLength);
                    check(res)
                    callback();
                });
            });
            req.setTimeout(1000, function () {
                throw new Error("TIMEOUT at " + name + " HTTP request!");
            });
            req.on("error", function (err) {
                err.message += " " + name
                throw err;
            });
            req.end(input.body);
        }
        expect("http.get");
        http.get(urlParse(url), function (res) {
            fulfill("http.get");
        }).on("error", function (err) {
            console.log(urlParse(url));
            throw err;
        });
        console.log("Test server at " + url);
    });

    function done() {
        console.log("All tests passed, shutting down...");
        extras.server.close();
        extras.client.disconnect();
        extras.parent.disconnect();
    }
});

