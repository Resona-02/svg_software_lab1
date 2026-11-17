import manifest from './package.json' with { type: 'json' };
import { TreeStarPlugin } from './TreeStarPlugin.js';
export { manifest };
export default new TreeStarPlugin();
