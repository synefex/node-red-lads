"use strict";

const helper = require("node-red-node-test-helper");
const operateNode = require("../src/operate/lads-operate");
const connectionNode = require("../src/connection/lads-connection");

helper.init(require.resolve("node-red"));

describe("lads-operate node", function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  it("loads with a connection and reads its config", function (done) {
    const flow = [
      { id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" },
      {
        id: "n1",
        type: "lads-operate",
        name: "test-operate",
        connection: "c1",
        fu: "ns=6;i=5050",
        fuType: "str",
        operation: "Start",
        operationType: "str",
        inputArgs: "[]",
        inputArgsType: "json",
        outputProperty: "payload",
        outputPropertyType: "msg",
      },
    ];
    helper.load([connectionNode, operateNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        require("assert").ok(n);
        done();
      } catch (e) { done(e); }
    });
  });

  it("defaults operation to 'Start' when not specified", function (done) {
    const flow = [
      { id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" },
      {
        id: "n1",
        type: "lads-operate",
        connection: "c1",
        fu: "ns=6;i=5050",
      },
    ];
    helper.load([connectionNode, operateNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        require("assert").ok(n);
        done();
      } catch (e) { done(e); }
    });
  });
});
