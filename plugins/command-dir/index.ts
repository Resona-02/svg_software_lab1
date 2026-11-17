import manifest from './package.json' with { type: 'json' };
import { DirPlugin } from './DirPlugin.js';

export { manifest };
export default new DirPlugin();
