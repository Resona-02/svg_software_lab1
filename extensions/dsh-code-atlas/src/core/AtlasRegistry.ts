import type { LanguageProvider, NodeLabelProvider, ReadingStrategy } from './types.js';
import type { LabelDecoratorFactory } from './Labels.js';
import { BasicNodeLabel, PublicApiLabel, ReadLabel } from './Labels.js';
import { DependenciesFirst, UsersFirst } from './ReadingStrategies.js';
import { AtlasError } from './AtlasError.js';

/** Three independent change axes; extensions do not receive the mutable workbench. */
export class AtlasRegistry {
  private readonly languages = new Map<string, LanguageProvider>();
  private readonly strategies = new Map<string, ReadingStrategy>();
  private readonly decorators = new Map<string, LabelDecoratorFactory>();
  constructor(provider: LanguageProvider) {
    this.registerLanguage(provider);
    this.registerStrategy(new DependenciesFirst());
    this.registerStrategy(new UsersFirst());
  }
  registerLanguage(provider: LanguageProvider): () => void {
    return this.register(this.languages, provider);
  }
  registerStrategy(strategy: ReadingStrategy): () => void {
    return this.register(this.strategies, strategy);
  }
  registerLabel(factory: LabelDecoratorFactory): () => void {
    return this.register(this.decorators, factory);
  }
  language(name: string): LanguageProvider {
    const value = this.languages.get(name);
    if (!value) throw new AtlasError(`Language provider not registered: ${name}`, 'PROVIDER_MISSING');
    return value;
  }
  strategy(name: string): ReadingStrategy {
    const value = this.strategies.get(name);
    if (!value) throw new AtlasError(`Reading strategy not registered: ${name}`, 'STRATEGY_MISSING');
    return value;
  }
  labels(publicApi: boolean): NodeLabelProvider {
    let label: NodeLabelProvider = new BasicNodeLabel();
    if (publicApi) label = new PublicApiLabel(label);
    label = new ReadLabel(label);
    for (const decorator of this.decorators.values()) label = decorator.wrap(label);
    return label;
  }
  private register<T extends { readonly name: string }>(map: Map<string, T>, value: T): () => void {
    if (!value.name.trim() || map.has(value.name)) throw new AtlasError(`Duplicate extension: ${value.name}`, 'DUPLICATE_EXTENSION');
    map.set(value.name, value);
    return () => { if (map.get(value.name) === value) map.delete(value.name); };
  }
}
