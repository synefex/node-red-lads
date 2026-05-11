# Contributing to @synefex/node-red-lads

Thanks for considering a contribution. This package provides Node-RED
nodes for LADS lab devices.

## Development setup

Requirements:
- Node.js 18 or newer
- For live testing: a reachable LADS-conformant OPC UA server (a lab
  device or a sim)

```bash
git clone https://github.com/synefex/node-red-lads.git
cd node-red-lads
npm install
npm test
```

## Layout

```
.
├── package.json
├── README.md
├── LICENSE                Apache-2.0
├── NOTICE                 third-party attribution
├── CHANGELOG.md
├── src/
│   ├── lib/
│   │   ├── coerce.js      OPC UA DataValue unwrapping
│   │   ├── variant.js     building OPC UA Variants from JS values
│   │   ├── options.js     security mode / policy / user-identity resolution
│   │   ├── status.js      status broadcasting
│   │   ├── browse.js      OPC UA browse helpers (LADS device tree)
│   │   └── picker/        browser-side picker widget
│   ├── connection/        lads-connection config node
│   ├── read-value/        lads-read-value action node
│   ├── write-value/       lads-write-value action node
│   ├── call-method/       lads-call-method action node
│   └── operate/           lads-operate action node (FunctionalUnitState)
└── test/                  mocha + node-red-node-test-helper
```

## Testing

```bash
npm test
```

Tests use `node-red-node-test-helper` against a mocked Node-RED runtime.
No live OPC UA server is required for the unit + load tests. Coverage:

- `test/coerce.test.js` -- OPC UA DataValue unwrap, LocalizedText /
  QualifiedName flattening, statusCode propagation
- `test/variant.test.js` -- input Variant construction, type resolution,
  arrayType auto-detection
- `test/options.test.js` -- security mode/policy resolution + user
  identity construction
- `test/status.test.js` -- connection-state -> node.status mapping
- `test/lads-*.test.js` -- per-node load tests (connection + 4 actions)

## Pull requests

- Branch from `main`.
- Keep changes focused -- one feature or fix per PR.
- Add tests for new behavior.
- Update `CHANGELOG.md` under `[Unreleased]`.
- Run `npm test`.
- Sign off your commits: `Signed-off-by: Your Name <you@example.com>`.

## Code style

- Plain JavaScript, no TypeScript build step.
- Two-space indent, LF line endings, UTF-8 (see `.editorconfig`).
- One subdirectory per node under `src/<node-name>/`.
- Shared helpers in `src/lib/`.
- Comments explain *why*, not *what*.

## License

By contributing, you agree that your contributions will be licensed under
the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
