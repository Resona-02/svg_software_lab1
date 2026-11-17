import manifest from './package.json' with { type: 'json' };
import { StatsPlugin } from './StatsPlugin.js';

export { manifest };
export default new StatsPlugin();
