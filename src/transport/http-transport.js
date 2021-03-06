"use strict";

var AbstractTransport = require("./abstract-transport.js");
var request = require("../platform/request.js");
var internalState = require("../internal-state");
var errors = require("../errors/codes");

function HttpTransport(address, timeout, maxRetries, messageHandler, initialConnectCallback) {
  this.abstractTransport = AbstractTransport.call(this, address, timeout, maxRetries, messageHandler);

  this.initialConnect(initialConnectCallback);
}

HttpTransport.prototype = Object.create(AbstractTransport.prototype);

HttpTransport.prototype.constructor = HttpTransport;

HttpTransport.prototype.connect = function (callback) {
  // send an invalid request to determine if the desired node is available (just need to see if we get a 200 response)
  request({
    url: this.address,
    method: "POST",
    json: { jsonrpc: "2.0", id: 0, method: "net_version" },
    timeout: this.timeout,
  }, function (error, response, jso) {
    if (error || response.statusCode !== 200) {
      callback(error);
    } else {
      if (jso.error) {
        error = new Error(jso.error.message || "Unknown error.");
        error.code = jso.error.code;
        error.data = jso.error.data;
        callback(error);
      } else {
        callback(null);
      }
    }
  });
};

HttpTransport.prototype.getTransportName = function () {
  return "HttpTransport";
};

HttpTransport.prototype.close = function () {
  this.abstractTransport.connected = false;
};

HttpTransport.prototype.submitRpcRequest = function (rpcObject, errorCallback) {
  request({
    url: this.address,
    method: "POST",
    json: rpcObject, // lies! this actually wants a JSO, not a JSON string
    timeout: this.timeout,
  }, function (error, response, body) {
    if (error) {
      if (error.code === "ECONNRESET") error.retryable = true;
      if (error.code === "ECONNREFUSED") error.retryable = true;
      if (error.code === "ETIMEDOUT") error.retryable = true;
      if (error.code === "ESOCKETTIMEDOUT") error.retryable = true;
      if (error.code === "EAI_AGAIN") error.retryable = true;
      if (error.code === "ENOTFOUND") error.retryable = true;
      errorCallback(error);
    } else if (response.statusCode === 200) {
      if (rpcObject.method === "eth_call" && body.result === "0x") {
        var outstandingRequest = internalState.get("outstandingRequests." + response.id) || {};
        var retries = outstandingRequest.retries || 0;
        error = new Error(errors.ETH_CALL_FAILED.message);
        if (retries < this.maxRetries) {
          internalState.set("outstandingRequests." + response.id, Object.assign({}, outstandingRequest, {retries: retries + 1}));
          error.retryable = true;
          return errorCallback(error);
        }
        return this.messageHandler(null, {
          id: response.body.id,
          jsonrpc: "2.0",
          error: {"code": -32601, "message": errors.ETH_CALL_FAILED.message},
        });
      }
      this.messageHandler(null, body);
    } else if (response.statusCode === 405) { // to handle INFURA's 405 Method Not Allowed response
      this.messageHandler(null, {
        id: rpcObject.id,
        jsonrpc: "2.0",
        error: {"code": -32601, "message": "Method not found"},
      });
    } else if (response.statusCode === 502) { // to handle INFURA's 502 error response
      console.warn("[ethrpc] http-transport 502 response", error, response);
      error = new Error("Gateway timeout, retryable");
      error.code = response.statusCode;
      error.retryable = true;
      errorCallback(error);
    } else {
      console.error("[ethrpc] http-transport unexpected status code", response);
      error = new Error("Unexpected status code.");
      error.code = response.statusCode;
      error.address = this.address;
      errorCallback(error);
    }
  }.bind(this));
};

module.exports = HttpTransport;
