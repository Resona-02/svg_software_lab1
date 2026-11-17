import { BuiltinCommandsPlugin } from './BuiltinCommandsPlugin.js';
export { default as manifest } from './package.json' with { type: 'json' };
export default new BuiltinCommandsPlugin();
