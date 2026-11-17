import type { Shape } from '../domain/Shape.js';

/** Mutations recorded through this port participate in one set transaction. */
/** apply 的唯一写入口；目标之外的写入拒绝，每次写入先登记局部补偿。 */
export interface AttributeEdit {
  set(shape: Shape, attribute: string, value: string): void;
}
export interface AttributeResult {
  readonly message: string;
  readonly undone: () => string;
}
export interface AttributeHandler {
  readonly name: string;
  /** 纯查询：不得改变模型、历史或外部状态。多个命中整体拒绝。 */
  handles(shape: Shape, attribute: string): boolean;
  /** 同步执行；通过 edit.set 修改，失败向外抛出，不允许吞错后走默认处理。 */
  apply(shape: Shape, attribute: string, value: string, edit: AttributeEdit): AttributeResult;
}
