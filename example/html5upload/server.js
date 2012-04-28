
var local = require('vfs-local')({
    root: __dirname + "/"
});


require('http').createServer(require('stack')(
    require('vfs-http-adapter')("/", local)
)).listen(8080);

console.log("HTTP server at http://localhost:8080/");
