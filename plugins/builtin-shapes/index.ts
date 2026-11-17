import { BuiltinShapesPlugin } from './BuiltinShapesPlugin.js';
export { default as manifest } from './package.json' with { type: 'json' };
export default new BuiltinShapesPlugin();
