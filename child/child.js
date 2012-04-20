var config = JSON.parse(process.argv[2]);
config.input = process.stdin;
config.output = process.stdout;
require('vfs-socket')(config);
process.stdin.resume();
