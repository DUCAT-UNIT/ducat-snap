/**
 * Jest transform that imports `.svg` files as strings, mirroring snaps-cli's webpack
 * `asset/source` rule so `src/brand.ts` resolves the same way under test and in the bundle.
 */
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
