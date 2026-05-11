# @synefex/node-red-lads

Node-RED nodes for **LADS** lab devices.
[LADS](https://reference.opcfoundation.org/LADS/v100/docs/) (Laboratory
and Analytical Device Standard) is the OPC UA companion spec for lab
instruments. One persistent session per connection, an editor-side
picker that browses the device tree, and four action nodes covering
read, write, method call, and state-machine operate.

[![npm version](https://img.shields.io/npm/v/@synefex/node-red-lads.svg)](https://www.npmjs.com/package/@synefex/node-red-lads)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Install

In your Node-RED userDir (typically `~/.node-red/`):

```bash
npm install @synefex/node-red-lads
```

Restart Node-RED. Five new nodes appear in the palette under the
`Synefex LADS` section.

## Nodes

| Node | Purpose |
|---|---|
| `lads-connection` | LADS server connection, persistent session, auto-reconnect. Config node. |
| `lads-read-value` | Read the Value attribute of a node. |
| `lads-write-value` | Write a value with explicit data-type encoding. |
| `lads-call-method` | Call a method with input args and decoded outputs. |
| `lads-operate` | Drive the LADS `FunctionalUnitState` machine (Start, Stop, Abort, Hold, Resume, ...). |

## Quick start

1. Drop a **LADS connection** config node, point it at your server's
   endpoint (`opc.tcp://host:port`), and pick the right security
   mode/policy + auth combination for your server.
2. Wire an **inject -> LADS read -> debug** flow.
3. Open the LADS read node. The picker (cascading dropdowns above the
   manual NodeId field) lets you browse Device -> Functional Unit ->
   Function -> Variable. Pick the variable you want.
4. Deploy and click inject. `payload` becomes the decoded value.

## Picker

Open any LADS action node in the editor and the picker shows up above
the manual fields:

- **Device** -- top-level LADS device (browsed from the connection)
- **Functional Unit** -- subsystem within a device (e.g. WeighingSensor)
- **Function** -- behavior within an FU (e.g. CurrentValue)
- **Variable** / **Method** -- the leaf you actually pick

The picker resolves to a NodeId and writes it into the manual NodeId
field; the symbolic browse path is stored alongside for re-edit
restoration. Picking writable variables also auto-fills the Data type
dropdown on the write node.

## Security

For lab devices on a trusted network, **None / None / Anonymous** is
usually enough. Switch to **Sign** or **Sign & Encrypt** with a matching
policy when the server requires it. Validated combinations:

- None / None / Anonymous
- Sign / Basic256Sha256 / Anonymous
- SignAndEncrypt / Basic256Sha256 / Anonymous
- SignAndEncrypt / Aes128_Sha256_RsaOaep / Anonymous
- SignAndEncrypt / Aes256_Sha256_RsaPss / Anonymous
- (and Username/Password variants of all of the above)

The first time a secured connection is attempted, a self-signed client
certificate is generated under `<userDir>/lads-pki/own/certs/`. The
server administrator may need to add it to the server's trust list
before the connection succeeds, or you can flip on **Auto-trust server
certificate** for lab/testing.

## License

Apache License, Version 2.0. See [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE).
