const opcua = require("node-opcua");
const { unwrapDataValue } = require("../lib/coerce");

module.exports = function (RED) {
  function LadsReadValueNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.connection = RED.nodes.getNode(config.connection);
    node.nodeIdValue = config.nodeId || "";
    node.nodeIdType = config.nodeIdType || "str";
    node.outputProperty = config.outputProperty || "payload";
    node.outputPropertyType = config.outputPropertyType || "msg";
    node.includeMeta = !!config.includeMeta;

    if (!node.connection) {
      node.status({ fill: "red", shape: "ring", text: "no connection" });
      return;
    }

    function applyConnectionStatus(status) {
      const text = status.detail ? `${status.state}: ${status.detail}` : status.state;
      switch (status.state) {
        case "connected":
          node.status({ fill: "green", shape: "dot", text: "connected" });
          break;
        case "connecting":
        case "reconnecting":
        case "session-closed":
          node.status({ fill: "yellow", shape: "ring", text });
          break;
        case "error":
        case "disconnected":
          node.status({ fill: "red", shape: "ring", text });
          break;
        default:
          node.status({ fill: "grey", shape: "ring", text });
      }
    }

    const unsubscribe = node.connection.onStatus(applyConnectionStatus);

    node.on("input", async (msg, send, done) => {
      let nodeId;
      try {
        nodeId = RED.util.evaluateNodeProperty(
          node.nodeIdValue,
          node.nodeIdType,
          node,
          msg,
        );
      } catch (err) {
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      if (typeof nodeId !== "string" || nodeId.length === 0) {
        const err = new Error("LADS read: nodeId is missing or not a string");
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      let session;
      try {
        session = await node.connection.getSession();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "no session" });
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      let dataValue;
      try {
        dataValue = await session.read({
          nodeId,
          attributeId: opcua.AttributeIds.Value,
        });
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "read failed" });
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      const result = unwrapDataValue(dataValue);

      if (!result.statusOk) {
        const err = new Error(`OPC UA read bad status: ${result.statusCode}`);
        err.statusCode = result.statusCode;
        node.status({
          fill: "red",
          shape: "ring",
          text: result.statusCode || "bad status",
        });
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      try {
        if (node.outputPropertyType === "msg") {
          RED.util.setMessageProperty(msg, node.outputProperty, result.value, true);
        } else if (
          node.outputPropertyType === "flow" ||
          node.outputPropertyType === "global"
        ) {
          const ctx = node.context()[node.outputPropertyType];
          ctx.set(node.outputProperty, result.value);
        } else {
          RED.util.setMessageProperty(msg, node.outputProperty, result.value, true);
        }
      } catch (err) {
        if (done) done(err);
        else node.error(err, msg);
        return;
      }

      if (node.includeMeta) {
        msg.lads = {
          nodeId,
          dataType: result.dataType,
          arrayType: result.arrayType,
          statusCode: result.statusCode,
          sourceTimestamp: result.sourceTimestamp,
          serverTimestamp: result.serverTimestamp,
        };
      }

      node.status({
        fill: "green",
        shape: "dot",
        text: `ok @ ${new Date().toLocaleTimeString()}`,
      });
      send(msg);
      if (done) done();
    });

    node.on("close", () => {
      try {
        unsubscribe();
      } catch (_) {
        /* ignore */
      }
    });
  }

  RED.nodes.registerType("lads-read-value", LadsReadValueNode);
};
