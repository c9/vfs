var root = "http://localhost:8080/rest/";

var vfs = require('vfs-local')({
  root: process.cwd(),
  httpRoot: root,
});

require('http').createServer(require('stack')(
  require('vfs-http-adapter')("/rest/", vfs)
)).listen(8080);

console.log("RESTful interface at " + root);
