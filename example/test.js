var port = 5000;
var root = "http://creationix.com:" + port + "/rest/";

var vfs = require('vfs-ssh')({
  host: "creationix.com",
  user: "tim",
  root: "/home/tim/creationix.com/",
  httpRoot: root,
});

require('http').createServer(require('stack')(
  require('vfs-http-adapter')("/rest/", vfs)
)).listen(port);

console.log("RESTful interface at " + root);
