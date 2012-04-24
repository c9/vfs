var sshConnect = require('./ssh-transport').connect;

sshConnect("192.168.1.4", {modules: {
  "architect-agent": require.resolve('architect-agent'),
  "architect-socket-transport": require.resolve('architect-socket-transport'),
  "simple-mime": require.resolve('simple-mime'),
  "msgpack-js": require.resolve('msgpack-js'),
  "simple-mime": require.resolve('simple-mime'),
  "child-agent": __dirname + "/child-agent.js"
}}, require('./child-agent'), function () {
});


