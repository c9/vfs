var ChildProcess = require('child_process');
var Embedder = require('embedder');

// This is the function to be bootstrapped on the remote node command
var bootstrap = ("(" + function () {
  var code = '';
  function onChunk(chunk) {

    // Read input chunks till the script is done piping in
    if (chunk[chunk.length - 1]) {
      code += chunk.toString();
      return;
    }
    code += chunk.slice(0, chunk.length - 1).toString();

    // Stop reading code and execute the code
    process.stdin.removeListener('data', onChunk);
    // process.title = "node generated.js";
    require('vm').runInNewContext(code, {
      require: require,
      Buffer: Buffer,
      process: process,
      console: console
    }, 'generated.js');
  }

  // Start reading the code
  process.stdin.on('data', onChunk);
  process.stdin.resume();

} + ")();").replace(new RegExp("//.*\n", "g"), "").replace(/"/g, '\\"').replace(/[\n ]+/ig, " ");

// @host is a domain name or ip address of the server you want to connect to
// @options can contain:
//   nodePath - for a custom path to node on the remote machine.  Defaults to /usr/local/bin/node
//   key - for a custom ssh private key on the local machine.
//   modules - an hash of require names and filepaths to modules that need to be sent over.
//   main - path to main script to run remotely
exports.connect = function (host, options, callback) {
  
  var nodePath = options.nodePath || "/usr/local/bin/node";

  // Send bootstrap on command line
  var args = [host];
  // A specific key may be passed in
  if (options.key) {
    args.push("-i");
    args.push(options.key);
  }
  args.push("-C");
  args.push(nodePath + ' -e "' + bootstrap + '"');
  var child = ChildProcess.spawn("ssh", args);

  // For debugging
  child.stderr.pipe(process.stderr);

  // Start our end of the protocol
  
  Protocol.connectToClient(child.stdout, child.stdin, function (err, remote, imports) {
    if (err) return callback(err);
    callback(null, agent.wrapper(remote, imports));
  });
  
  var modules = options.modules || {};

  if (options.main) { module["_"] = options.main; }
  // Send the child-agent and all it's dependencies to run remotely.
  Embedder(modules, function (err, code) {
    if (err) return callback(err);
    if (options.main) { code += "\n// Bootstrap main\nrequire('_');\n"; }
    child.stdin.write(code + "\0");
    // For ease of debugging, write the generated code to disk
    FS.writeFileSync('generated.js', code);
  });
}
