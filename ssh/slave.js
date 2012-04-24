module.exports = function (config) {
    config.input = process.stdin;
    config.output = process.stdout;
    require('vfs-socket/worker')(config);
};
