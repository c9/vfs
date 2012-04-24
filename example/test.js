
require('http').createServer(require('stack')(
    require('vfs-http-adapter')("/child/", require('vfs-child')({
        root: "/home/tim/vfs/",
        httpRoot: "http://localhost:8080/child/",
    })),
      require('vfs-http-adapter')("/ssh/", require('vfs-ssh')({
        host: "tim@creationix.com",
        nodePath: "/home/tim/nvm/v0.6.15/bin/node",
        root: "/home/tim/creationix.com/",
        httpRoot: "http://localhost:8080/ssh/",
    }))
)).listen(8080);

console.log("HTTP server using creationix.com ssh tunnel at http://localhost:8080/ssh/");
console.log("HTTP server using vfs child process at http://localhost:8080/child/");
