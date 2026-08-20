import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/fast.ts', 'src/invariant.ts'],
  format: ['esm'],
  dts: false,
  outDir: 'lib',
})
