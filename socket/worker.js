var Stream = require('stream').Stream;
var socketTransport = require('architect-socket-transport');
var Agent = require('architect-agent').Agent;
var vfsLocal = require('vfs-local');

// @fsOptions can have:
//   all fs options from cfs-local
//   and also:
//   fsOptions.input - input stream
//   fsOptions.output - output stream (reuses input if not given)
module.exports = function setup(fsOptions) {
  var input = fsOptions.input;
  if (!(input instanceof Stream && input.readable !== false)) throw new TypeError("input must be a readable Stream");
  var output = fsOptions.hasOwnProperty("output") ? fsOptions.output : input;
  if (!(output instanceof Stream && output.writable !== false)) throw new TypeError("output must be a writable Stream");


  function wrap(fn, name) {
    return function wrapped(path, options, callback) {
      // console.log(name, path, options);
      fn(path, options, function (err, meta) {
        // console.error(name, err, meta);
        if (meta.stream) {
          err = new Error("STREAM!");
        }
        if (err) {
          var nerr = {
            stack: process.pid + ": " + err.stack
          }
          if (err.hasOwnProperty("code")) nerr.code = err.code;
          if (err.hasOwnProperty("message")) nerr.message = err.message;
          console.log("nerr", nerr);
          return callback(nerr);
        }
        callback(null, meta);
      });
    }
  }

  // Get the local vfs and wrap it so we can fix streams
  var vfs = vfsLocal(fsOptions);
  for (var key in vfs) {
    vfs[key] = wrap(vfs[key], key);
  }

  var agent = new Agent(vfs);
  agent.attach(socketTransport(input, output), function (parent) {
    if (fsOptions.callback) fsOptions.callback(parent);
  });
  return vfs;

};
