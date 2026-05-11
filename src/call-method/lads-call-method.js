const opcua = require("node-opcua");
const { extractValue } = require("../lib/coerce");
const { buildInputVariant } = require("../lib/variant");

module.exports = function (RED) {
  function LadsCallMethodNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.connection = RED.nodes.getNode(config.connection);
    node.objectIdValue = config.objectId || "";
    node.objectIdType = config.objectIdType || "str";
    node.methodIdValue = config.methodId || "";
    node.methodIdType = config.methodIdType || "str";
    node.inputArgsValue = config.inputArgs || "[]";
    node.inputArgsType = config.inputArgsType || "json";
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

    function unwrapOutputArg(variant) {
      if (!variant) return null;
      const dataTypeName = variant.dataType != null
        ? opcua.DataType[variant.dataType] ?? null
        : null;
      return {
        value: extractValue(variant.value, dataTypeName),
        rawValue: variant.value,
        dataType: dataTypeName,
      };
    }

    node.on("input", async (msg, send, done) => {
      let objectId, methodId, inputArgs;
      try {
        objectId = RED.util.evaluateNodeProperty(node.objectIdValue, node.objectIdType, node, msg);
        methodId = RED.util.evaluateNodeProperty(node.methodIdValue, node.methodIdType, node, msg);
        inputArgs = RED.util.evaluateNodeProperty(node.inputArgsValue, node.inputArgsType, node, msg);
      } catch (err) {
        if (done) done(err); else node.error(err, msg);
        return;
      }

      if (typeof objectId !== "string" || !objectId) {
        const err = new Error("LADS call: objectId missing or not a string");
        if (done) done(err); else node.error(err, msg);
        return;
      }
      if (typeof methodId !== "string" || !methodId) {
        const err = new Error("LADS call: methodId missing or not a string");
        if (done) done(err); else node.error(err, msg);
        return;
      }
      if (inputArgs == null) inputArgs = [];
      if (!Array.isArray(inputArgs)) {
        const err = new Error("LADS call: inputArguments must be an array of { dataType, value }");
        if (done) done(err); else node.error(err, msg);
        return;
      }

      let inputVariants;
      try {
        inputVariants = inputArgs.map(buildInputVariant);
      } catch (err) {
        if (done) done(err); else node.error(err, msg);
        return;
      }

      let session;
      try {
        session = await node.connection.getSession();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "no session" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      let result;
      try {
        result = await session.call({
          objectId,
          methodId,
          inputArguments: inputVariants,
        });
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "call failed" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      const statusCode = result.statusCode?.toString() ?? null;
      const statusOk = typeof result.statusCode?.isGood === "function"
        ? result.statusCode.isGood()
        : false;

      if (!statusOk) {
        const err = new Error(`OPC UA call bad status: ${statusCode}`);
        err.statusCode = statusCode;
        node.status({ fill: "red", shape: "ring", text: statusCode || "bad status" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      const outputs = (result.outputArguments || []).map(unwrapOutputArg);

      // Void methods (Zero, Stop, Abort, ...) declare no outputs — leave the
      // message property untouched so the trigger msg chains through cleanly.
      if (outputs.length > 0) {
        const payload = outputs.length === 1
          ? outputs[0].value
          : outputs.map((o) => o && o.value);
        try {
          if (node.outputPropertyType === "msg") {
            RED.util.setMessageProperty(msg, node.outputProperty, payload, true);
          } else if (node.outputPropertyType === "flow" || node.outputPropertyType === "global") {
            node.context()[node.outputPropertyType].set(node.outputProperty, payload);
          } else {
            RED.util.setMessageProperty(msg, node.outputProperty, payload, true);
          }
        } catch (err) {
          if (done) done(err); else node.error(err, msg);
          return;
        }
      }

      if (node.includeMeta) {
        msg.lads = {
          objectId,
          methodId,
          statusCode,
          inputArgumentResults: (result.inputArgumentResults || [])
            .map((s) => (s && typeof s.toString === "function" ? s.toString() : String(s))),
          outputArguments: outputs,
        };
      }

      node.status({ fill: "green", shape: "dot", text: `ok @ ${new Date().toLocaleTimeString()}` });
      send(msg);
      if (done) done();
    });

    node.on("close", () => {
      try { unsubscribe(); } catch (_) { /* ignore */ }
    });
  }

  RED.nodes.registerType("lads-call-method", LadsCallMethodNode);
};
