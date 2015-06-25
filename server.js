/**
 * Module dependencies
 */

process.env.TZ = 'UTC';

require('newrelic');
var http = require('http');
var port = process.env.PORT || 8080;

//Create a server so we can do health checks
var server = http.createServer(function(request, response) {
    response.end('Alive');
});

//Start the server and the app process
server.listen(port, function() {
    console.log('Server up');
    require('./app');
});
