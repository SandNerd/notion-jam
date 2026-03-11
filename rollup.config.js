import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
// import { terser } from 'rollup-plugin-terser';
import banner from 'rollup-plugin-banner2';
import json from '@rollup/plugin-json';
import shebang from 'rollup-plugin-shebang-bin';
import S from 'tiny-dedent';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const license = () => S(`
  /*!
   * ${packageJson.nameFull} v${packageJson.version} (${packageJson.homepage})
   * Copyright (c) ${packageJson.author}
   * @license ${packageJson.license}
   */
   `
);

// const production = !process.env.ROLLUP_WATCH;
// const sourcemap = production ? true : 'inline';
// const entry = 'src/index.js';

const assumptions = {
  constantSuper: true,
  enumerableModuleMeta: true,
  ignoreFunctionLength: true,
  ignoreToPrimitiveHint: true,
  noClassCalls: true,
  noDocumentAll: true,
  noNewArrows: true,
  privateFieldsAsProperties: true,
  setClassMethods: true,
  setComputedProperties: true,
  setPublicClassFields: true,
};

const config = [

  // Node script
  {
    input: 'src/cli.js',
    output: [
      {
        file: packageJson.bin,
        format: 'esm',
        sourcemap: false,
        //exports: 'default',
      },
    ],
    external: [/node_modules/],
    plugins: [
      resolve({
        preferBuiltins: true,
        mainFields: ['module', 'main'],
        extensions: ['.js', '.mjs', '.json', '.node'],
        exportConditions: ['node']
      }),
      commonjs({
        transformMixedEsModules: true,
      }),
      json(),
      banner(license),
      shebang(),
    ]
  },

  // GitHub Action
  {
    input: 'src/action.js',
    output: [
      {
        file: packageJson.action,
        format: 'esm',
        sourcemap: false,
        //exports: 'default',
      },
    ],
    // external: [/node_modules/],
    plugins: [
      resolve({
        preferBuiltins: true,
        mainFields: ['module', 'main'],
        extensions: ['.js', '.mjs', '.json', '.node'],
        exportConditions: ['node']
      }),
      commonjs({
        transformMixedEsModules: true,
        defaultIsModuleExports: true,
      }),
      json(),
      babel({
        babelHelpers: 'bundled',
        assumptions,
        presets: [
          ['@babel/preset-env', {
            targets: { node: 'current' },
            modules: false
          }]
        ],
        plugins: [
          ['@babel/plugin-proposal-class-properties', { loose: true }],
          ['@babel/plugin-proposal-private-methods', { loose: true }]
        ],
        exclude: [] // Transpile everything including node_modules
      }),
      banner(license)
    ],
    context: 'this',
    onwarn(warning, warn) {
      warn(warning);
    }
  },
];

export default config;
