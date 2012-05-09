require('vfs-ssh')({
    host: "tim@creationix.com",
    nodePath: "/home/tim/nvm/v0.6.17/bin/node",
    root: "/home/tim/creationix.com/",
}, function (err, ssh) {
    if (err) throw err;
    require('http').createServer(require('stack')(
        require('vfs-http-adapter')("/ssh/", ssh)
    )).listen(8080, function () {
        console.log("ssh filesystem listening at http://localhost:8080/ssh/");
    });
});
