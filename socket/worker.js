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

  var vfs = vfsLocal(fsOptions);
  // TODO: fix streams

  var agent = new Agent(vfs);
  agent.attach(socketTransport(input, output), function (parent) {
    if (fsOptions.callback) fsOptions.callback(parent);
  });
  return vfs;

};
