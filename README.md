# ts-expand-type

This repo provides a TS Server plugin, which aids in determining quick information about a type.

Additionally, it exposes utilities for "expanding" types generated by the TypeScript Compiler.

<!---
TODO: more information, screenshots, usage guide, etc...
-->

## Building

First install deps with `yarn install`. To build,

```bash
yarn build
```

## Testing

Write test cases in `tests/cases`. Running,

```bash
yarn test
```

Will then compare generated baselines to those in `tests/baselines/reference`. Any which fail will go into the `tests/baselines/local` folder, where you can inspect/diff them. To accept new baselines, run,

```bash
yarn baseline-accept
```