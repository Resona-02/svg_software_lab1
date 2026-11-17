import manifest from './package.json' with { type: 'json' };
import { BoxPlugin } from './BoxPlugin.js';
export { manifest };
export default new BoxPlugin();
