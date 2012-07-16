////////////////////////////////////////////////////////////////////////////////
// SAMPLE HTTP SERVER                                                         //
////////////////////////////////////////////////////////////////////////////////

var httpAdapter = require('vfs-http-adapter');

// A dynamic list of http middleware routes.  Each item is a connect-style
// handler function.
var routes = [];

// Start an http server.
var server = require('http').createServer(require('stack')(
    // Log requests for easy debugging
    require('creationix').log(),
    // Simple middleware to iterate over the registered dynamic routes.
    function (req, res, next) {
        check(0);
        function check(index) {
            var handler = routes[index];
            if (!handler) return next();
            handler(req, res, function (err) {
                if (err) return next(err);
                check(index + 1);
            });
        }
    }
));

// Start the server listening at 8080
server.listen(8080, function () {
    console.log("http server listening at http://localhost:8080/");
    registerVfs();
});


////////////////////////////////////////////////////////////////////////////////
// SAMPLE HYBRID VFS OVER HTTP                                                //
////////////////////////////////////////////////////////////////////////////////

function registerVfs() {

    // var vfs = require('vfs-local')({root: process.env.HOME + "/"});

    var Parent = require('vfs-child').Parent;
    var httpTransport = require('vfs-http-transport/server');

    var child = new Parent({root: process.env.HOME + "/"});
    console.log("Spawning vfs instance in child process");
    child.connect(function (err, vfs) {
        if (err) throw err;
        console.log("vfs-child instance initialized");
        // Serve the vfs-child instance over REST for easy testing.
        routes.push(httpAdapter("/child/", vfs));
        console.log("child vfs at http://localhost:8080/child/");

        // Serve the vfs over the http transport. We have to pass in the http server
        // instance to give socket.io access to the "upgrade" event on it.
        console.log("creating http-transport instance");
        httpTransport(vfs, server, "/home/");
        console.log("http transport listening at ws://localhost:8080/home/");
        startClient();
    });

}

////////////////////////////////////////////////////////////////////////////////
// SAMPLE HTTP CLIENT                                                         //
////////////////////////////////////////////////////////////////////////////////

function startClient() {

    console.log("creating http-transport client")
    var Client = require('vfs-http-transport/client').Client;
    var client = new Client("ws://localhost:8080/home/");
    client.connect(function (err, vfs) {
        if (err) throw err;
        routes.push(httpAdapter("/http/", vfs));
        console.log("http vfs at http://localhost:8080/http/");

        vfs.extend("math", {file: __dirname + "/extension.js"}, function (err, meta) {
            if (err) throw err;
            console.log("extend", meta);
            meta.api.add(3, 5, function (err, result) {
                if (err) throw err;
                console.log("extend add(3, 5)", result);
            });
        });

        vfs.extend("math2", {stream: require('fs').createReadStream(__dirname + "/extension.js")}, function (err, meta) {
            if (err) throw err;
            
            meta.api.add(13, 5, function (err, result) {
                if (err) throw err;
                console.log("extend add(13, 5)", result);


                vfs.extend("math3", {stream: require('fs').createReadStream(__dirname + "/extension.js")}, function (err, meta) {
                    if (err) throw err;
                    meta.api.add(13, 15, function (err, result) {
                        if (err) throw err;
                        console.log("extend add(13, 15)", result);
                    });
                });

            });

        });


    });
}
