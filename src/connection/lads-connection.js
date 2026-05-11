const fs = require("fs");
const path = require("path");
const opcua = require("node-opcua");
const {
  resolveSecurityMode,
  resolveSecurityPolicy,
  buildUserIdentity,
} = require("../lib/options");
const browse = require("../lib/browse");

const BROWSE_CACHE_TTL_MS = 5 * 60 * 1000;

// Read once at module load — served by the picker.js admin route below.
const PICKER_JS = fs.readFileSync(
  path.join(__dirname, "..", "lib", "picker", "picker.js"),
  "utf8",
);

module.exports = function (RED) {
  function LadsConnectionNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.endpoint = (config.endpoint || "").trim();
    node.securityMode = config.securityMode || "None";
    node.securityPolicy = config.securityPolicy || "None";
    node.authMode = config.authMode || "anonymous";
    node.applicationName = config.applicationName || "synefex-lads-nodered";
    node.applicationUri = config.applicationUri || "urn:synefex:nodered:lads-client";
    node.requestedSessionTimeout =
      parseInt(config.sessionTimeout, 10) || 60000;
    node.acceptServerCertificate = config.acceptServerCertificate !== false;

    const credentials = node.credentials || {};

    let client = null;
    let session = null;
    let sessionPromise = null;
    let closing = false;
    const statusListeners = new Set();
    const browseCache = new Map(); // key -> { data, expiry }

    function publishStatus(state, detail) {
      node._connectionStatus = { state, detail: detail || "", ts: Date.now() };
      for (const fn of statusListeners) {
        try {
          fn(node._connectionStatus);
        } catch (_) {
          /* listener error is not fatal */
        }
      }
    }

    node.onStatus = function (fn) {
      statusListeners.add(fn);
      if (node._connectionStatus) {
        try {
          fn(node._connectionStatus);
        } catch (_) {
          /* swallow */
        }
      }
      return () => statusListeners.delete(fn);
    };

    function attachClientEvents(c) {
      c.on("backoff", (retry, delay) => {
        publishStatus("connecting", `retry ${retry} in ${delay}ms`);
      });
      c.on("connection_lost", () => {
        publishStatus("reconnecting", "connection lost");
      });
      c.on("connection_reestablished", () => {
        publishStatus("connected", node.endpoint);
      });
      c.on("close", () => {
        if (!closing) publishStatus("disconnected", "client closed");
      });
    }

    function attachSessionEvents(s) {
      s.once("session_closed", () => {
        if (session === s) session = null;
        if (!closing) {
          publishStatus("session-closed", "session closed unexpectedly");
        }
      });
      s.on("keepalive_failure", () => {
        if (!closing) publishStatus("reconnecting", "keepalive failed");
      });
    }

    async function connect() {
      if (closing) throw new Error("connection closing");
      if (!node.endpoint) throw new Error("endpoint not configured");

      publishStatus("connecting", node.endpoint);

      const certificateManager = new opcua.OPCUACertificateManager({
        name: "PKI",
        rootFolder: path.join(RED.settings.userDir || ".", "lads-pki"),
        automaticallyAcceptUnknownCertificate: !!node.acceptServerCertificate,
      });
      await certificateManager.initialize();

      client = opcua.OPCUAClient.create({
        endpointMustExist: false,
        applicationName: node.applicationName,
        applicationUri: node.applicationUri,
        productUri: "urn:synefex:nodered:lads-client",
        connectionStrategy: {
          maxRetry: -1,
          initialDelay: 1000,
          maxDelay: 30000,
        },
        securityMode: resolveSecurityMode(node.securityMode),
        securityPolicy: resolveSecurityPolicy(node.securityPolicy),
        requestedSessionTimeout: node.requestedSessionTimeout,
        clientCertificateManager: certificateManager,
        keepSessionAlive: true,
      });
      attachClientEvents(client);

      try {
        await client.connect(node.endpoint);
      } catch (err) {
        publishStatus("error", `connect: ${err.message}`);
        try {
          await client.disconnect();
        } catch (_) {
          /* ignore */
        }
        client = null;
        throw err;
      }

      try {
        const userIdentity = buildUserIdentity(node.authMode, credentials);
        session = await client.createSession(userIdentity);
        attachSessionEvents(session);
      } catch (err) {
        publishStatus("error", `session: ${err.message}`);
        try {
          await client.disconnect();
        } catch (_) {
          /* ignore */
        }
        client = null;
        session = null;
        throw err;
      }

      publishStatus("connected", node.endpoint);
      return session;
    }

    function ensureSession() {
      if (closing) return Promise.reject(new Error("connection closing"));
      if (session) return Promise.resolve(session);
      if (sessionPromise) return sessionPromise;
      sessionPromise = connect().finally(() => {
        sessionPromise = null;
      });
      return sessionPromise;
    }

    node.getSession = ensureSession;

    // Browse / picker support — used by the editor-side cascading dropdowns
    // via the admin HTTP endpoints registered below.

    function cacheGet(key) {
      const entry = browseCache.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiry) {
        browseCache.delete(key);
        return undefined;
      }
      return entry.data;
    }
    function cacheSet(key, data) {
      browseCache.set(key, { data, expiry: Date.now() + BROWSE_CACHE_TTL_MS });
    }

    async function withCache(key, fn) {
      const cached = cacheGet(key);
      if (cached) return cached;
      const sess = await ensureSession();
      const data = await fn(sess);
      cacheSet(key, data);
      return data;
    }

    node.listDevices = () => withCache("devices", (s) => browse.listDevices(s));

    node.browseChildren = (parent, filter) => {
      switch (filter) {
        case "fu":
          return withCache("fu:" + parent, (s) => browse.listFus(s, parent));
        case "function":
          return withCache("function:" + parent, (s) => browse.listFunctions(s, parent));
        case "variable":
          return withCache("variable:" + parent, (s) => browse.listVariables(s, parent));
        case "writable":
          return withCache("writable:" + parent, (s) => browse.listVariables(s, parent, { writableOnly: true }));
        default:
          return Promise.reject(new Error("unknown filter: " + filter));
      }
    };

    node.listMethods = (target) =>
      withCache("methods:" + target, (s) => browse.listMethods(s, target));

    node.listAfo = (nid) =>
      withCache("afo:" + nid, (s) => browse.listAfoEntries(s, nid));

    node.invalidateBrowseCache = () => browseCache.clear();

    ensureSession().catch((err) => {
      node.error(`LADS initial connect failed: ${err.message}`);
    });

    node.on("close", async (done) => {
      closing = true;
      statusListeners.clear();
      browseCache.clear();
      try {
        if (session) {
          try {
            await session.close();
          } catch (_) {
            /* ignore */
          }
        }
        if (client) {
          try {
            await client.disconnect();
          } catch (_) {
            /* ignore */
          }
        }
      } finally {
        session = null;
        client = null;
        sessionPromise = null;
        if (typeof done === "function") done();
      }
    });
  }

  RED.nodes.registerType("lads-connection", LadsConnectionNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" },
    },
  });

  // ---------------------------------------------------------------------------
  // Editor-side picker support: admin HTTP endpoints. Each looks up the live
  // connection node by ID and delegates to its async browse methods. Routes
  // are scoped under /lads/conn/:id/... to avoid clashing with anything else
  // a user might mount in Node-RED.
  // ---------------------------------------------------------------------------

  function picker(handler) {
    return async (req, res) => {
      const node = RED.nodes.getNode(req.params.id);
      if (!node || typeof node.listDevices !== "function") {
        return res.status(404).json({ error: "lads-connection not found: " + req.params.id });
      }
      try {
        const data = await handler(node, req);
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    };
  }

  RED.httpAdmin.get(
    "/lads/conn/:id/devices",
    RED.auth.needsPermission("flows.read"),
    picker((node) => node.listDevices()),
  );

  RED.httpAdmin.get(
    "/lads/conn/:id/browse",
    RED.auth.needsPermission("flows.read"),
    picker((node, req) => {
      const parent = req.query.parent;
      const filter = req.query.filter;
      if (!parent) throw new Error("?parent=<nodeId> required");
      if (!filter) throw new Error("?filter=<fu|function|variable|writable> required");
      return node.browseChildren(parent, filter);
    }),
  );

  RED.httpAdmin.get(
    "/lads/conn/:id/methods",
    RED.auth.needsPermission("flows.read"),
    picker((node, req) => {
      const target = req.query.target;
      if (!target) throw new Error("?target=<nodeId> required");
      return node.listMethods(target);
    }),
  );

  RED.httpAdmin.get(
    "/lads/conn/:id/afo",
    RED.auth.needsPermission("flows.read"),
    picker((node, req) => {
      const nid = req.query.node;
      if (!nid) throw new Error("?node=<nodeId> required");
      return node.listAfo(nid);
    }),
  );

  RED.httpAdmin.post(
    "/lads/conn/:id/cache/invalidate",
    RED.auth.needsPermission("flows.write"),
    picker((node) => { node.invalidateBrowseCache(); return { ok: true }; }),
  );

  // Serve the picker.js asset for the editor. No auth here beyond Node-RED's
  // standard admin gate — the file is static JS, all sensitive data lives
  // behind the data endpoints which already require flows.read.
  RED.httpAdmin.get("/lads/picker.js", (req, res) => {
    res.type("application/javascript").send(PICKER_JS);
  });
};
