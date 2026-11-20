/**
 * events.ts —— 类型化事件总线（合同层，冻结）
 *
 * 用法：
 *   const bus = createBus<GameEvent>();
 *   bus.on("entityDied", (e) => { ... });        // e 自动收窄为对应载荷
 *   bus.emit({ type: "entityDied", entityId: 7, faction: "enemy" });
 *
 * 战斗层系统用 emit 驱动表现；渲染层（M8-M11）订阅后更新画面。
 * 跨层解耦：逻辑系统永远不 import Phaser。
 */

export interface EventBus<E extends { type: string }> {
  /** 订阅事件，返回取消订阅函数 */
  on<K extends E["type"]>(
    type: K,
    handler: (event: Extract<E, { type: K }>) => void
  ): () => void;
  /** 发出事件 */
  emit(event: E): void;
  /** 清空所有订阅（战斗结束时调用，防泄漏） */
  clear(): void;
}

export function createBus<E extends { type: string }>(): EventBus<E> {
  type AnyHandler = (event: never) => void;
  const handlers = new Map<string, Set<AnyHandler>>();

  const bus: EventBus<E> = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as AnyHandler);
      return () => {
        set!.delete(handler as AnyHandler);
      };
    },

    emit(event) {
      const set = handlers.get(event.type);
      if (!set) return;
      // 复制一份，允许 handler 内部安全地增删订阅
      for (const h of [...set]) {
        (h as (e: E) => void)(event);
      }
    },

    clear() {
      handlers.clear();
    }
  };

  return bus;
}
