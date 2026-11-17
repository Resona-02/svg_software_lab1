import type { EditorSession } from './EditorSession.js';
import { AttributeTransaction } from './AttributeTransaction.js';
import type { AttributeResult } from './AttributeHandler.js';
import { ShapePlacements } from '../domain/ShapePlacements.js';
import type { Shape } from '../domain/Shape.js';
import type { UndoState } from './UndoState.js';

/** 编辑业务接收者：组织领域对象、局部撤销记录、原子回滚和操作反馈。 */
export class EditReceiver {
  constructor(private readonly session: EditorSession) {}

  private get document() { return this.session.document; }

  undo(state: UndoState): string {
    return state.undo();
  }

  create(state: UndoState, type: string, id: string, params: readonly string[], parentId?: string): string {
    return state.run(() => {
      const shape = this.session.shapes.create(type, id, [...params]);
      this.document.add(shape, parentId);
      state.record(() => shape.parent!.remove(shape));
      return shape.creationMessage(parentId);
    }, () => `${type}#${id} creation undone`);
  }

  delete(state: UndoState, id: string): string {
    const shape = this.document.find(id);
    shape.parent!.assertCanDetach(shape);
    return state.run(() => {
      this.rememberPositions(state, [shape]);
      this.document.delete(id);
      return `${shape.tag}#${id} deleted`;
    }, () => {
      const parent = shape.parent === this.document.root ? 'svg' : `g#${shape.parent!.id}`;
      return `${shape.tag}#${id} restored into ${parent}`;
    });
  }

  move(state: UndoState, id: string, dx: number, dy: number): string {
    const shape = this.document.find(id);
    return state.run(() => {
      state.record(shape.rememberPosition());
      shape.move(dx, dy);
      return `${shape.movementSummary()} moved by (${dx},${dy})`;
    }, () => `${shape.movementSummary()} moved back by (${-dx},${-dy})`);
  }

  scale(state: UndoState, id: string, factor: number): string {
    const shape = this.document.find(id);
    return state.run(() => {
      state.record(shape.rememberGeometry());
      shape.scale(factor);
      return `${shape.summary()} scaled by ${factor}`;
    }, () => `${shape.summary()} scale undone`);
  }

  set(state: UndoState, id: string, attribute: string, value: string): string {
    const shape = this.document.find(id);
    const handlers = [...this.session.extensions.attributes.values()].filter(handler => handler.handles(shape, attribute));
    if (handlers.length > 1) throw new Error(`ambiguous attribute handlers: ${attribute} (${handlers.map(handler => handler.name).join(', ')})`);
    const handler = handlers[0];
    if (handler) {
      let undone: string;
      return state.run(() => {
        const edit = new AttributeTransaction(shape, state);
        let result: AttributeResult;
        try {
          result = handler.apply(shape, attribute, value, edit);
        } finally {
          edit.close();
        }
        if (result instanceof Promise) {
          // A mistaken async handler must not produce an unhandled rejection later.
          void result.catch(() => undefined);
          throw new Error(`attribute handler must be synchronous: ${handler.name}`);
        }
        if (!result || typeof result.message !== 'string' || typeof result.undone !== 'function') {
          throw new Error(`invalid attribute result: ${handler.name}`);
        }
        undone = result.undone();
        if (typeof undone !== 'string') throw new Error(`invalid attribute result: ${handler.name}`);
        return result.message;
      }, () => undone);
    }
    return state.run(() => {
      state.record(shape.rememberAttribute(attribute));
      shape.setAttribute(attribute, value);
      return `${shape.tag}#${id} updated: ${attribute}=${JSON.stringify(value)}`;
    }, () => {
      const old = attribute === 'text' ? shape.text : shape.attributes()[attribute];
      return `${shape.tag}#${id} updated: ${attribute}=${old === undefined ? '(unset)' : JSON.stringify(old)}`;
    });
  }

  group(state: UndoState, newId: string, ids: readonly string[]): string {
    return state.run(() => {
      // 校验和组合规则属于 SvgDocument；这里只记录被选中节点的位置。
      const shapes = [...new Set(ids)].map(id => this.document.find(id));
      for (const shape of shapes) shape.parent!.assertCanDetach(shape);
      this.rememberPositions(state, shapes);
      this.document.group(newId, ids);
      const group = this.document.find(newId);
      state.record(() => group.parent!.remove(group));
      return `g#${newId} created with ${ids.length} children`;
    }, () => `g#${newId} grouping undone`);
  }

  ungroup(state: UndoState, id: string): string {
    const group = this.document.find(id).asContainer();
    group.assertCanUngroup();
    return state.run(() => {
      this.rememberPositions(state, [group, ...group.children]);
      for (const child of group.children) {
        for (const attribute of ['fill', 'stroke', 'stroke-width']) {
          state.record(child.rememberAttribute(attribute));
        }
      }
      this.document.ungroup(id);
      return `g#${id} ungrouped`;
    }, () => `g#${id} restored`);
  }

  addTo(state: UndoState, groupId: string, id: string): string {
    const shape = this.document.find(id);
    shape.parent!.assertCanDetach(shape);
    return state.run(() => {
      this.rememberPositions(state, [shape]);
      this.document.addTo(groupId, id);
      return `${shape.tag}#${id} moved into g#${groupId}`;
    }, () => `${shape.tag}#${id} parent restored`);
  }

  front(state: UndoState, id: string): string {
    return this.reorder(state, id, () => this.document.front(id), 'front');
  }

  back(state: UndoState, id: string): string {
    return this.reorder(state, id, () => this.document.back(id), 'back');
  }

  private reorder(state: UndoState, id: string, action: () => void, direction: string): string {
    const shape = this.document.find(id);
    shape.parent!.assertCanDetach(shape);
    return state.run(() => {
      this.rememberPositions(state, [shape]);
      action();
      return `${shape.tag}#${id} moved to ${direction}`;
    }, () => `${shape.tag}#${id} order restored`);
  }

  private rememberPositions(state: UndoState, shapes: readonly Shape[]): void {
    const positions = new ShapePlacements(shapes);
    state.record(() => positions.restore());
  }
}
