var httpRoot = "http://localhost:9000/";
var vfs = require('./localfs')({
  root: "/home/tim/",
  httpRoot: httpRoot,
  uid: 1000,
  gid: 100
});


// TODO: convert this file to middleware module
http.createServer(function (req, res) {


}).listen(9000, function () {
  console.log("Server listening at " + httpRoot);
});
