const opcua = require("node-opcua");
const { extractValue } = require("../lib/coerce");
const { attachConnectionStatus } = require("../lib/status");
const { buildInputVariant } = require("../lib/variant");

const LADS_STATE_OPS = [
  "Start", "Stop", "Abort", "Hold", "Resume", "Reset",
  "StartProgram", "ClearAll", "Suspend",
];

const STATE_MACHINE_NAMES = ["FunctionalUnitState", "ControlFunctionState"];

module.exports = function (RED) {
  function LadsOperateNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.connection = RED.nodes.getNode(config.connection);
    node.fuValue = config.fu || "";
    node.fuType = config.fuType || "str";
    node.opValue = config.operation || "Start";
    node.opType = config.operationType || "str";
    node.inputArgsValue = config.inputArgs || "[]";
    node.inputArgsType = config.inputArgsType || "json";
    node.outputProperty = config.outputProperty || "payload";
    node.outputPropertyType = config.outputPropertyType || "msg";
    node.includeMeta = !!config.includeMeta;

    if (!node.connection) {
      node.status({ fill: "red", shape: "ring", text: "no connection" });
      return;
    }

    const unsubscribe = attachConnectionStatus(node, node.connection);

    // Per-target cache: targetNodeId -> { ownerId, methods: Map<opName, methodId>, source }
    const targetCache = new Map();

    async function browseChildren(session, nodeId) {
      const r = await session.browse({
        nodeId,
        referenceTypeId: "HierarchicalReferences",
        includeSubtypes: true,
        browseDirection: opcua.BrowseDirection.Forward,
        resultMask: 0x3F,
      });
      return r.references || [];
    }

    // Resolve where the methods live for a given target NodeId.
    // Order:
    //   1. Methods directly on the target (e.g. user passed an Operational
    //      or a state machine NodeId directly).
    //   2. A state machine child (FunctionalUnitState or ControlFunctionState).
    async function discoverTarget(session, targetNodeId) {
      if (targetCache.has(targetNodeId)) return targetCache.get(targetNodeId);

      const direct = await browseChildren(session, targetNodeId);

      const directMethods = new Map();
      for (const r of direct) {
        if (r.nodeClass === 4) directMethods.set(r.browseName.name, r.nodeId.toString());
      }
      if (directMethods.size > 0) {
        const entry = { ownerId: targetNodeId, methods: directMethods, source: "direct" };
        targetCache.set(targetNodeId, entry);
        return entry;
      }

      const sm = direct.find((r) =>
        r.browseName && STATE_MACHINE_NAMES.includes(r.browseName.name),
      );
      if (!sm) {
        throw new Error(
          `target ${targetNodeId} has no methods and no ` +
          `FunctionalUnitState/ControlFunctionState child`,
        );
      }

      const smChildren = await browseChildren(session, sm.nodeId.toString());
      const methods = new Map();
      for (const r of smChildren) {
        if (r.nodeClass === 4) methods.set(r.browseName.name, r.nodeId.toString());
      }

      const entry = {
        ownerId: sm.nodeId.toString(),
        methods,
        source: sm.browseName.name,
      };
      targetCache.set(targetNodeId, entry);
      return entry;
    }

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
      let fuNodeId, opName, inputArgs;
      try {
        fuNodeId = RED.util.evaluateNodeProperty(node.fuValue, node.fuType, node, msg);
        opName = RED.util.evaluateNodeProperty(node.opValue, node.opType, node, msg);
        inputArgs = RED.util.evaluateNodeProperty(node.inputArgsValue, node.inputArgsType, node, msg);
      } catch (err) {
        if (done) done(err); else node.error(err, msg);
        return;
      }

      if (typeof fuNodeId !== "string" || !fuNodeId) {
        const err = new Error("LADS operate: FunctionalUnit nodeId missing");
        if (done) done(err); else node.error(err, msg);
        return;
      }
      if (typeof opName !== "string" || !opName) {
        const err = new Error("LADS operate: operation missing");
        if (done) done(err); else node.error(err, msg);
        return;
      }
      if (inputArgs == null) inputArgs = [];
      if (!Array.isArray(inputArgs)) {
        const err = new Error("LADS operate: inputArguments must be an array");
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

      let entry, methodId;
      try {
        entry = await discoverTarget(session, fuNodeId);
        methodId = entry.methods.get(opName);
        if (!methodId) {
          const available = Array.from(entry.methods.keys()).join(", ");
          throw new Error(
            `target ${fuNodeId} does not support "${opName}"` +
            (available ? ` (available: ${available})` : " (no methods found)"),
          );
        }
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "discover failed" });
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

      let result;
      try {
        result = await session.call({
          objectId: entry.ownerId,
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
        const err = new Error(`OPC UA operate "${opName}" bad status: ${statusCode}`);
        err.statusCode = statusCode;
        node.status({ fill: "red", shape: "ring", text: statusCode || "bad status" });
        if (done) done(err); else node.error(err, msg);
        return;
      }

      const outputs = (result.outputArguments || []).map(unwrapOutputArg);
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
          target: fuNodeId,
          operation: opName,
          ownerId: entry.ownerId,
          source: entry.source, // "direct" | "FunctionalUnitState" | "ControlFunctionState"
          methodId,
          statusCode,
          outputArguments: outputs,
        };
      }

      node.status({
        fill: "green",
        shape: "dot",
        text: `${opName} ok @ ${new Date().toLocaleTimeString()}`,
      });
      send(msg);
      if (done) done();
    });

    node.on("close", () => {
      try { unsubscribe(); } catch (_) { /* ignore */ }
    });
  }

  RED.nodes.registerType("lads-operate", LadsOperateNode);
  // expose for help-doc reference if Node-RED ever needs it
  LadsOperateNode.standardOps = LADS_STATE_OPS;
};
