// Local harness adapter: the application defaults to listening on every interface.
// Pin only this isolated API process to loopback without editing its generated dist.
const net = require('node:net');
const path = require('node:path');
const { loopbackListenArgs } = require('./core.cjs');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) { return listen.apply(this, loopbackListenArgs(args)); };
require(path.resolve(__dirname, '../api/dist/index.js'));
