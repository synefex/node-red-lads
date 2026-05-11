const opcua = require("node-opcua");
const { attachConnectionStatus } = require("../lib/status");

function coerceValueForType(dataTypeName, value) {
  if (value == null) return value;
  if (dataTypeName === "LocalizedText" && typeof value === "string") {
    return { text: value, locale: "" };
  }
  if (dataTypeName === "QualifiedName" && typeof value === "string") {
    return { name: value, namespaceIndex: 0 };
  }
  return value;
}

module.exports = function (RED) {
  function LadsWriteValueNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.connection = RED.nodes.getNode(config.connection);
    node.nodeIdValue = config.nodeId || "";
    node.nodeIdType = config.nodeIdType || "str";
    node.valueValue = config.value ?? "";
    node.valueType = config.valueType || "msg";
    node.dataType = config.dataType || "Double";
    node.includeMeta = !!config.includeMeta;

    if (!node.connection) {
      node.status({ fill: "red", shape: "ring", text: "no connection" });
      return;
    }

    const unsubscribe = attachConnectionStatus(node, node.connection);

    node.on("input", async (msg, send, done) => {
      let nodeId, value;
      try {
        nodeId = RED.util.evaluateNodeProperty(node.nodeIdValue, node.nodeIdType, node, msg);
        value = RED.util.evaluateNodeProperty(node.valueValue, node.valueType, node, msg);
      } catch (err) {
        if (done) done(err); else node.error(err, msg);
        return;
      }

      if (typeof nodeId !== "string" || !nodeId) {
        const err = new Error("LADS write: nodeId missing or not a string");
        if (done) done(err); else node.error(err, msg);
        return;
      }

      // msg.dataType overrides the configured dataType, per-call.
      const dataTypeName = (typeof msg.dataType === "string" && msg.dataType) || node.dataType;
      const dt = opcua.DataType[dataTypeName];
      if (dt == null) {
        const err = new Error(`LADS write: unknown dataType "${dataTypeName}"`);
        if (done) done(err); else node.error(err, msg);
        return;
      }

      const coerced = coerceValueForType(dataTypeName, value);

      let session;
      try {
        session = await node.connection.getSession();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "no session" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      let statusCode;
      try {
        statusCode = await session.write({
          nodeId,
          attributeId: opcua.AttributeIds.Value,
          value: { value: { dataType: dt, value: coerced } },
        });
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "write failed" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      const statusStr = statusCode?.toString() ?? null;
      const statusOk = typeof statusCode?.isGood === "function" ? statusCode.isGood() : false;

      if (!statusOk) {
        const err = new Error(`OPC UA write bad status: ${statusStr}`);
        err.statusCode = statusStr;
        node.status({ fill: "red", shape: "ring", text: statusStr || "bad status" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      // Successful write — pass the trigger msg through unchanged so the chain
      // can react to "write done" without conflating it with a read result.
      if (node.includeMeta) {
        msg.lads = {
          nodeId,
          dataType: dataTypeName,
          writtenValue: coerced,
          statusCode: statusStr,
        };
      }

      node.status({ fill: "green", shape: "dot", text: `wrote @ ${new Date().toLocaleTimeString()}` });
      send(msg);
      if (done) done();
    });

    node.on("close", () => {
      try { unsubscribe(); } catch (_) { /* ignore */ }
    });
  }

  RED.nodes.registerType("lads-write-value", LadsWriteValueNode);
};
