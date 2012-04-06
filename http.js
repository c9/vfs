var http = require('http');
var urlParse = require('url').parse;

var httpRoot = "http://localhost:9000/";
var vfs = require('./localfs')({
  root: "/home/tim/",
  httpRoot: httpRoot,
  uid: 1000,
  gid: 100
});

http.createServer(function (req, res) {

  function abort(err, code) {
    console.error(err.stack);
    if (code) res.statusCode = code;
    else if (err.code === "ENOENT") res.statusCode = 404;
    else if (err.code === "EACCESS") res.statucCode = 403;
    else res.statusCode = 500;
    var message = (err.stack || err) + "\n";
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Length", Buffer.byteLength(message));
    res.end(message);
  }

  var options = {};
  if (req.method === "HEAD") {
    options.head = true;
    req.method = "GET";
  }

  var path = urlParse(req.url).pathname;

  if (req.method === "GET") {

    if (req.headers.hasOwnProperty("if-none-match")) options.etag = req.headers["if-none-match"];

    if (req.headers.hasOwnProperty('range')) {
      var range = options.range = {};
      var p = req.headers.range.indexOf('=');
      var parts = req.headers.range.substr(p + 1).split('-');
      if (parts[0].length) {
        range.start = parseInt(parts[0], 10);
      }
      if (parts[1].length) {
        range.end = parseInt(parts[1], 10);
      }
      if (req.headers.hasOwnProperty('if-range')) range.etag = req.headers["if-range"];
    }

    if (path[path.length - 1] === "/") {
      vfs.readdir(path, options, onGet);
    } else {
      vfs.createReadStream(path, options, onGet);
    }

    function onGet(err, meta) {
      res.setHeader("Date", (new Date()).toUTCString());
      if (err) return abort(err);
      if (meta.rangeNotSatisfiable) return abort(meta.rangeNotSatisfiable, 416);

      if (meta.hasOwnProperty('etag')) res.setHeader("ETag", meta.etag);

      if (meta.notModified) res.statusCode = 304;
      if (meta.partialContent) res.statusCode = 206;

      if (meta.hasOwnProperty('stream') || options.head) {
        if (meta.hasOwnProperty('mime')) res.setHeader("Content-Type", meta.mime);
        if (meta.hasOwnProperty("size")) {
          res.setHeader("Content-Length", meta.size);
          if (meta.hasOwnProperty("partialContent")) {
            res.setHeader("Content-Range", "bytes " + meta.partialContent.start + "-" + meta.partialContent.end + "/" + meta.partialContent.size);
          }
        }
      }
      if (meta.hasOwnProperty('stream')) {
        meta.stream.on("error", abort);
        meta.stream.pipe(res);
      } else {
        res.end();
      }
    }

  } // end GET request

  else if (req.method === "PUT") {

    if (path[path.length - 1] === "/") {
      vfs.mkdir(path, {}, function (err, meta) {
        if (err) return abort(err);
        res.end();
      });
    } else {
      // TODO: Does this pause/buffer *all* events or just some?
      req.pause();
      vfs.createWriteStream(path, {}, function (err, meta) {
        if (err) return abort(err);
        if (meta.stream) {
          meta.stream.on("error", abort);
          req.pipe(meta.stream);
          req.resume();
          meta.stream.on("saved", function () {
            res.end();
          });
        } else {
          res.end();
        }
      });
    }
  } // end PUT request

  else if (req.method === "DELETE") {
    var command;
    if (path[path.length - 1] === "/") {
      command = vfs.rmdir;
    } else {
      command = vfs.unlink;
    }
    command(path, {}, function (err, meta) {
      if (err) return abort(err);
      res.end();
    });
  } // end DELETE request

  else if (req.method === "POST") {
    var data = "";
    req.on("data", function (chunk) {
      data += chunk;
    });
    req.on("end", function () {
      var message;
      try {
        message = JSON.parse(data);
      } catch (err) {
        return abort(err);
      }
      var command, options = {};
      if (message.renameFrom) {
        command = vfs.rename;
        options.from = message.renameFrom;
      }
      else if (message.copyFrom) {
        command = vfs.copy;
        options.from = message.copyFrom;
      }
      else if (message.linkTo) {
        command = vfs.symlink;
        options.target = message.linkTo;
      }
      else {
        return abort(new Error("Invalid command in POST " + data));
      }
      command(path, options, function (err, meta) {
        if (err) return abort(err);
        res.end();
      });
    });
  } // end POST commands
  else {
    return abort("Unsupported HTTP method", 501);
  }


}).listen(9000, function () {
  console.log("Server listening at " + httpRoot);
});
