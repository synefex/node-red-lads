// LADS-aware OPC UA browse helpers used by the connection node's editor-side
// pickers. Each helper returns plain JS objects suitable for JSON.stringify
// (no node-opcua-typed values leak through).
const opcua = require("node-opcua");

const STATE_MACHINE_NAMES = ["FunctionalUnitState", "ControlFunctionState"];

// Well-known LADS variable names, ranked highest first for picker UX
const VARIABLE_RANK = [
  "SensorValue", "CurrentValue", "TargetValue", "RawValue",
  "DifferenceValue", "CurrentMode", "CompensationValue", "Trigger",
  "AccelerationRamp", "DecelerationRamp", "IsEnabled",
];

async function browseChildren(session, nodeId) {
  const r = await session.browse({
    nodeId,
    referenceTypeId: "HierarchicalReferences",
    includeSubtypes: true,
    browseDirection: opcua.BrowseDirection.Forward,
    resultMask: 0x3F,
  });
  // Some servers (e.g. the Mettler pH meter) emit the same node via multiple
  // hierarchical reference subtypes — dedupe by nodeId, keeping the first.
  const seen = new Set();
  const out = [];
  for (const ref of r.references || []) {
    const key = ref.nodeId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

async function browseByRefType(session, nodeId, refTypeNodeId) {
  const r = await session.browse({
    nodeId,
    referenceTypeId: refTypeNodeId,
    includeSubtypes: true,
    browseDirection: opcua.BrowseDirection.Forward,
    resultMask: 0x3F,
  });
  return r.references || [];
}

function refToBasic(r) {
  return {
    nodeId: r.nodeId.toString(),
    browseName: r.browseName?.name || "",
    qualifiedName: r.browseName?.toString() || "",
    displayName: r.displayName?.text || r.browseName?.name || "",
  };
}

function inferFunctionKind(browseName) {
  const n = (browseName || "").toLowerCase();
  if (n.includes("sensor")) return "sensor";
  if (n.includes("controller")) return "controller";
  if (n.includes("lid") || n.includes("cover") || n.includes("door")) return "lid";
  if (n.includes("timer")) return "timer";
  if (n.includes("rotor") || n.includes("bucket")) return "rotor";
  return "unknown";
}

async function listDevices(session) {
  const objects = await browseChildren(session, "ObjectsFolder");
  const ds = objects.find((r) => r.browseName?.name === "DeviceSet");
  if (!ds) return [];
  const refs = await browseChildren(session, ds.nodeId.toString());
  return refs
    .filter((r) => r.nodeClass === 1 && r.browseName?.name !== "DeviceFeatures")
    .map(refToBasic);
}

async function listFus(session, deviceNodeId) {
  const refs = await browseChildren(session, deviceNodeId);
  const fuSet = refs.find((r) => r.browseName?.name === "FunctionalUnitSet");
  if (!fuSet) return [];
  const fus = await browseChildren(session, fuSet.nodeId.toString());
  const out = [];
  for (const r of fus) {
    if (r.nodeClass !== 1 || r.browseName?.name === "NodeVersion") continue;
    const children = await browseChildren(session, r.nodeId.toString());
    out.push({
      ...refToBasic(r),
      hasState: children.some((c) => STATE_MACHINE_NAMES.includes(c.browseName?.name)),
      hasProgramManager: children.some((c) => c.browseName?.name === "ProgramManager"),
    });
  }
  return out;
}

async function listFunctions(session, fuNodeId) {
  const refs = await browseChildren(session, fuNodeId);
  const fSet = refs.find((r) => r.browseName?.name === "FunctionSet");
  if (!fSet) return [];
  const fns = await browseChildren(session, fSet.nodeId.toString());
  const out = [];
  for (const r of fns) {
    if (r.nodeClass !== 1 || r.browseName?.name === "NodeVersion") continue;
    out.push({
      ...refToBasic(r),
      kind: inferFunctionKind(r.browseName?.name),
    });
  }
  return out;
}

// Recursive aggregators we skip when walking one level deeper for variables.
// These either re-aggregate the tree (FunctionalUnitSet etc.) or expose a
// huge subtree we don't want to flatten into the picker.
const NESTED_VAR_BLACKLIST = new Set([
  "FunctionSet", "FunctionalUnitSet", "DeviceFeatures",
  "Components", "SupportedPropertiesSet",
  "Identification", "Maintenance",
  "ProgramTemplateSet", "ResultSet", "ActiveProgram",
]);

// List variable children of a given parent, INCLUDING variables one level
// deeper inside immediate non-aggregator object children (state machines,
// Operational, CoverState, ...). This surfaces state-machine variables like
// `Lid/CoverState/CurrentState` and `FunctionalUnitState/CurrentState`
// which would otherwise be hidden from the picker.
// Same NodeId can be reachable via multiple HasComponent paths (e.g. a
// state variable exposed both on FunctionalUnitState and Operational, or
// directly on the function and on its Operational child). Pick the most
// semantic path: direct first, then state machines, then Operational.
const VARIABLE_PREFIX_PRIORITY = {
  "": 0,
  "FunctionalUnitState": 1,
  "ControlFunctionState": 2,
  "CoverState": 3,
  "Operational": 4,
  "Lock": 5,
};
function variablePathPriority(prefix) {
  const head = prefix.replace(/\/$/, "");
  const p = VARIABLE_PREFIX_PRIORITY[head];
  return p === undefined ? 99 : p;
}

async function listVariables(session, parentNodeId, opts = {}) {
  const { writableOnly = false } = opts;
  const refs = await browseChildren(session, parentNodeId);

  const candidates = [];
  for (const r of refs) {
    if (r.nodeClass === 2) {
      candidates.push({ ref: r, prefix: "", ownerId: parentNodeId });
    }
  }
  for (const child of refs) {
    if (child.nodeClass !== 1) continue;
    const name = child.browseName?.name || "";
    if (NESTED_VAR_BLACKLIST.has(name)) continue;
    const grand = await browseChildren(session, child.nodeId.toString());
    for (const r of grand) {
      if (r.nodeClass !== 2) continue;
      candidates.push({
        ref: r,
        prefix: name + "/",
        ownerId: child.nodeId.toString(),
      });
    }
  }

  // Dedupe by nodeId — same Variable can be exposed via multiple
  // HasComponent paths. Prefer the entry with higher path priority.
  const byId = new Map();
  for (const c of candidates) {
    const nid = c.ref.nodeId.toString();
    const existing = byId.get(nid);
    if (!existing || variablePathPriority(c.prefix) < variablePathPriority(existing.prefix)) {
      byId.set(nid, c);
    }
  }
  const deduped = Array.from(byId.values());

  const out = [];
  for (const { ref, prefix, ownerId } of deduped) {
    const nodeId = ref.nodeId.toString();
    let dataType = null;
    let accessLevel = null;
    try {
      const attrs = await session.read([
        { nodeId, attributeId: opcua.AttributeIds.DataType },
        { nodeId, attributeId: opcua.AttributeIds.AccessLevel },
      ]);
      const dtNid = attrs[0].value?.value;
      if (dtNid && dtNid.namespace === 0 && opcua.DataType[dtNid.value]) {
        dataType = opcua.DataType[dtNid.value];
      }
      accessLevel = attrs[1].value?.value;
    } catch (_) { /* node refused attribute read — leave nulls */ }

    const writable = !!(accessLevel & 0x02);
    if (writableOnly && !writable) continue;

    const name = ref.browseName?.name || "";
    const rankIdx = VARIABLE_RANK.indexOf(name);
    out.push({
      ...refToBasic(ref),
      ownerId,
      prefix,
      fullName: prefix + name,
      dataType,
      accessLevel,
      writable,
      readable: !!(accessLevel & 0x01),
      rank: rankIdx === -1 ? 999 : rankIdx,
    });
  }
  // Direct (un-prefixed) variables first, then nested. Within each group,
  // ranked names first, then alpha by browseName.
  out.sort((a, b) => {
    const ap = a.prefix ? 1 : 0;
    const bp = b.prefix ? 1 : 0;
    if (ap !== bp) return ap - bp;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.browseName.localeCompare(b.browseName);
  });
  return out;
}

async function readMethodSignature(session, methodRef, ownerId, source) {
  const methodId = methodRef.nodeId.toString();
  const argRefs = await browseChildren(session, methodId);

  async function readArgs(name) {
    const ref = argRefs.find((r) => r.browseName?.name === name);
    if (!ref) return [];
    try {
      const dv = await session.read({
        nodeId: ref.nodeId.toString(),
        attributeId: opcua.AttributeIds.Value,
      });
      return (dv.value?.value || []).map((a) => ({
        name: a.name,
        dataType: a.dataType?.toString() || null,
        valueRank: a.valueRank,
        description: a.description?.text || "",
      }));
    } catch (_) { return []; }
  }

  return {
    name: methodRef.browseName?.name,
    methodId,
    ownerId,
    source,
    inputArguments: await readArgs("InputArguments"),
    outputArguments: await readArgs("OutputArguments"),
  };
}

// Source preference for the picker: when the same method name shows up under
// multiple sub-objects (e.g. Lid exposes Open via both Operational and
// CoverState), keep the entry from the most specific state-machine source.
const SOURCE_PRIORITY = {
  FunctionalUnitState: 0,
  ControlFunctionState: 1,
  CoverState: 2,
  Operational: 3,
  direct: 4,
};
function sourcePriority(name) {
  return SOURCE_PRIORITY[name] ?? 5;
}

// Gathers methods callable on a target. Walks one level: direct methods on
// the target itself, plus methods on any immediate object child (state
// machines, Operational, CoverState, ...). Dedupes by name with a stable
// preference for more semantic sources.
async function listMethods(session, targetNodeId) {
  const direct = await browseChildren(session, targetNodeId);
  const all = [];

  for (const r of direct) {
    if (r.nodeClass === 4) {
      all.push(await readMethodSignature(session, r, targetNodeId, "direct"));
    }
  }
  for (const child of direct) {
    if (child.nodeClass !== 1) continue;
    const grand = await browseChildren(session, child.nodeId.toString());
    for (const m of grand) {
      if (m.nodeClass !== 4) continue;
      all.push(await readMethodSignature(
        session,
        m,
        child.nodeId.toString(),
        child.browseName?.name || "child",
      ));
    }
  }

  const byName = new Map();
  for (const m of all) {
    const existing = byName.get(m.name);
    if (!existing || sourcePriority(m.source) < sourcePriority(existing.source)) {
      byName.set(m.name, m);
    }
  }
  return Array.from(byName.values());
}

// HasDictionaryEntry reference type lives at i=17597 in the standard nodeset.
// LADS uses these to bind nodes to AFO ontology IRIs.
async function listAfoEntries(session, nodeId) {
  const refs = await browseByRefType(session, nodeId, "ns=0;i=17597");
  return refs.map((r) => ({
    nodeId: r.nodeId.toString(),
    browseName: r.browseName?.name || "",
    qualifiedName: r.browseName?.toString() || "",
    displayName: r.displayName?.text || r.browseName?.name || "",
  }));
}

module.exports = {
  listDevices,
  listFus,
  listFunctions,
  listVariables,
  listMethods,
  listAfoEntries,
};
