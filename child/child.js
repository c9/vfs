// Tiny stub to create a vfs-socket instance and connect it to stdin using
// config options from argv[2].
var config = JSON.parse(process.argv[2]);
config.input = process.stdin;
require('vfs-socket')(config);
process.stdin.resume();
