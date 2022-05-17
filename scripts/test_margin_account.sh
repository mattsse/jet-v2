#!/bin/bash

pushd ../libraries/ts
rm -rf lib
yarn build
popd

npx ts-mocha -p ../tsconfig.json -t 1000000 ../tests/integration/marginAccount.test.ts
