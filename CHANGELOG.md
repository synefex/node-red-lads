# Changelog -- @synefex/node-red-lads

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-12

First public release.

### Added
- `lads-connection` config node: persistent OPC UA client + session,
  auto-reconnect, status broadcast.
- `lads-read-value` action node: read the Value attribute of a single
  OPC UA node.
- `lads-write-value` action node: write a value with explicit OPC UA
  data-type encoding.
- `lads-call-method` action node: call an OPC UA method with input
  arguments and decoded outputs.
- `lads-operate` action node: drive the LADS FunctionalUnitState machine
  on a target FunctionalUnit (Start, Stop, Abort, Hold, Resume, ...).
- Editor picker: cascading Device -> Functional Unit -> Function ->
  Variable / Method browser, backed by `/lads/conn/:id/...` admin
  endpoints. Path-priority dedup, AFO IRI display, nested-variable
  aggregation.
- Apache-2.0 licensing.

### Notes
- Validated against Mettler Toledo SevenExcellence pH meter, Mettler
  Toledo XS105-DR balance, and Sigma centrifuge across all four
  security mode/policy combinations.
- LADS Program Manager and Results nodes are not yet implemented;
  deferred until needed against a server with a working ProgramManager.
