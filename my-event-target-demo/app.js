const logElement = document.querySelector('#log');

function log(message) {
  logElement.textContent += `${message}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}

function resetLog() {
  logElement.textContent = '';
}

/*
  MyEvent 是教学版事件对象。

  浏览器里的 Event 不是一个普通数据包，它会随着分发过程不断变化：
  - target 表示事件最初派发到哪个对象。
  - currentTarget 表示当前正在执行哪个对象上的监听器。
  - eventPhase 表示当前处于捕获、目标还是冒泡阶段。
  - defaultPrevented 表示默认行为是否已经被取消。

  下面这些 _xxx 字段模拟的是规范里的内部标志位。
  真实浏览器不会把它们暴露给 JS，但 stopPropagation()、
  preventDefault() 这些方法本质上就是在修改这类内部状态。
*/
class MyEvent {
  static NONE = 0;
  static CAPTURING_PHASE = 1;
  static AT_TARGET = 2;
  static BUBBLING_PHASE = 3;

  constructor(type, options = {}) {
    // 事件类型，例如 click、input；这个 demo 里用 save。
    this.type = type;

    // 是否允许进入冒泡阶段。事件委托依赖这个能力。
    this.bubbles = Boolean(options.bubbles);

    // 是否允许 preventDefault() 生效。
    this.cancelable = Boolean(options.cancelable);

    // 是否已经被 preventDefault() 取消默认行为。
    this.defaultPrevented = false;

    // target 在一次分发中固定为最初调用 dispatchEvent 的对象。
    this.target = null;

    // currentTarget 会随着分发过程变化：root、parent、child...
    this.currentTarget = null;

    // 当前阶段：NONE / CAPTURING_PHASE / AT_TARGET / BUBBLING_PHASE。
    this.eventPhase = MyEvent.NONE;

    // 自定义事件携带的数据，对应浏览器 CustomEvent 的 detail。
    this.detail = options.detail;

    // 防止同一个事件对象在分发过程中被再次分发。
    this._dispatchFlag = false;

    // stopPropagation() 会设置这个标志，阻止继续走到后续节点。
    this._stopPropagationFlag = false;

    // stopImmediatePropagation() 会设置这个标志，连当前节点后续监听器也阻止。
    this._stopImmediatePropagationFlag = false;

    // passive 监听器执行期间为 true，此时 preventDefault() 应该失效。
    this._inPassiveListenerFlag = false;
  }

  stopPropagation() {
    // 只阻止继续传播到后续节点，不影响当前节点后续监听器。
    this._stopPropagationFlag = true;
  }

  stopImmediatePropagation() {
    // 更强：既阻止后续节点，也阻止当前节点剩余监听器。
    this._stopPropagationFlag = true;
    this._stopImmediatePropagationFlag = true;
  }

  preventDefault() {
    // 不可取消的事件，即使调用 preventDefault() 也不改变 defaultPrevented。
    if (!this.cancelable) {
      log('  preventDefault ignored: event.cancelable is false');
      return;
    }

    // passive 的含义是：开发者承诺不会取消默认行为。
    // 因此浏览器可以更积极地执行滚动等默认行为。
    if (this._inPassiveListenerFlag) {
      log('  preventDefault ignored: current listener is passive');
      return;
    }

    this.defaultPrevented = true;
  }
}

/*
  MyEventTarget 是教学版 EventTarget。

  核心模型：
  - 每个 target 都有一张监听器表 _listeners。
  - addEventListener 往表里加 listener record。
  - removeEventListener 把匹配的 record 标记为 removed。
  - dispatchEvent 根据 parent 链构建事件路径，然后按阶段调用监听器。

  这里的 parent 是为了模拟 DOM 树里的 parentNode。
*/
class MyEventTarget {
  constructor(name) {
    // name 仅用于日志，方便观察当前节点。
    this.name = name;

    // 模拟 DOM 父节点。真实 DOM 中是 parentNode / getRootNode 等更复杂结构。
    this.parent = null;

    // 监听器记录表。真实浏览器也会维护类似的内部列表。
    this._listeners = [];
  }

  appendTo(parent) {
    // 为了演示事件路径，手动建立 root -> parent -> child 的关系。
    this.parent = parent;
    return this;
  }

  addEventListener(type, callback, options = {}) {
    if (typeof callback !== 'function') return;

    // 浏览器同时支持第三个参数传 boolean 或对象，这里统一归一化。
    const normalized = normalizeOptions(options);

    /*
      去重规则的关键通常是：
      type + callback + capture

      once、passive 不是常规 remove 匹配的关键。
      所以同一个函数、同一个事件类型、同一个 capture 重复注册时不会追加多条。
    */
    const exists = this._listeners.some((listener) => {
      return listener.type === type &&
        listener.callback === callback &&
        listener.capture === normalized.capture &&
        !listener.removed;
    });

    if (exists) return;

    // listener record：这是理解 addEventListener 的核心。
    const record = {
      type,
      callback,
      capture: normalized.capture,
      once: normalized.once,
      passive: normalized.passive,
      signal: normalized.signal,
      removed: false
    };

    if (record.signal) {
      // 如果 signal 已经 abort，监听器根本不会被添加。
      if (record.signal.aborted) {
        return;
      }

      // AbortSignal 的本质：外部 abort 时，把对应 listener record 移除。
      record.abortHandler = () => {
        record.removed = true;
        log(`[abort] remove ${this.name}.${type}`);
      };

      record.signal.addEventListener('abort', record.abortHandler, {
        once: true
      });
    }

    this._listeners.push(record);
  }

  removeEventListener(type, callback, options = {}) {
    const normalized = normalizeOptions(options);

    /*
      removeEventListener 不是靠“代码长得一样”移除，
      而是靠同一个函数对象引用 + 同 type + 同 capture。
    */
    for (const listener of this._listeners) {
      if (
        listener.type === type &&
        listener.callback === callback &&
        listener.capture === normalized.capture
      ) {
        listener.removed = true;
      }
    }
  }

  dispatchEvent(event) {
    if (!(event instanceof MyEvent)) {
      throw new TypeError('dispatchEvent expects a MyEvent instance');
    }

    // 同一个事件对象不能嵌套分发，这是对 dispatchFlag 的模拟。
    if (event._dispatchFlag) {
      throw new Error('This event is already being dispatched');
    }

    event._dispatchFlag = true;

    // dispatchEvent 是在 this 上派发，因此 this 就是事件 target。
    event.target = this;

    // 从 child 往上找 parent，构建事件路径。
    const path = buildPath(this);

    // 捕获阶段需要从根节点走向目标父节点，所以把祖先反过来。
    const ancestors = path.slice(1).reverse();

    log(`\n[dispatch] ${this.name}.${event.type}`);
    log(`path: ${path.map((node) => node.name).reverse().join(' -> ')}`);

    /*
      捕获阶段：
      root -> parent
      注意：不包含 target 自己，target 会在目标阶段处理。
    */
    event.eventPhase = MyEvent.CAPTURING_PHASE;
    for (const currentTarget of ancestors) {
      if (event._stopPropagationFlag) break;
      invokeListeners(currentTarget, event, true);
    }

    /*
      目标阶段：
      同一个 target 上，capture=true 和 capture=false 的监听器都会被调用。
      它们的 eventPhase 都是 AT_TARGET。
    */
    if (!event._stopPropagationFlag) {
      event.eventPhase = MyEvent.AT_TARGET;
      invokeListeners(this, event, true);

      if (!event._stopImmediatePropagationFlag) {
        invokeListeners(this, event, false);
      }
    }

    /*
      冒泡阶段：
      只有 event.bubbles 为 true，并且传播没有被中断，才会从 parent 回到 root。
    */
    if (event.bubbles && !event._stopPropagationFlag) {
      event.eventPhase = MyEvent.BUBBLING_PHASE;

      for (const currentTarget of path.slice(1)) {
        if (event._stopPropagationFlag) break;
        invokeListeners(currentTarget, event, false);
      }
    }

    // 分发结束后，清理动态状态。
    event.eventPhase = MyEvent.NONE;
    event.currentTarget = null;
    event._dispatchFlag = false;

    /*
      dispatchEvent 的返回值来自 defaultPrevented：
      - 没有被取消：true
      - 被 preventDefault 取消：false
    */
    log(`[result] defaultPrevented=${event.defaultPrevented}, dispatchEvent returns ${!event.defaultPrevented}`);

    return !event.defaultPrevented;
  }
}

function normalizeOptions(options) {
  // 兼容 addEventListener(type, callback, true) 这种旧写法。
  if (typeof options === 'boolean') {
    return {
      capture: options,
      once: false,
      passive: false,
      signal: null
    };
  }

  return {
    capture: Boolean(options.capture),
    once: Boolean(options.once),
    passive: Boolean(options.passive),
    signal: options.signal ?? null
  };
}

function buildPath(target) {
  /*
    构建事件路径。
    这个 demo 的路径是 child -> parent -> root。
    日志展示时会反过来显示为 root -> parent -> child。

    真实浏览器的路径更复杂：
    window / document / html / body / shadow root / slot 都可能参与。
  */
  const path = [];
  let current = target;

  while (current) {
    path.push(current);
    current = current.parent;
  }

  return path;
}

function invokeListeners(currentTarget, event, capture) {
  // currentTarget 是当前正在执行监听器的对象，它会随传播过程变化。
  event.currentTarget = currentTarget;

  /*
    取快照是为了模拟浏览器行为：
    分发过程中新增或移除监听器，不应该让当前循环变得不可预测。
    真实规范细节更复杂，但“快照 + removed 标记”是很好的理解模型。
  */
  const snapshot = currentTarget._listeners.filter((listener) => {
    return listener.type === event.type &&
      listener.capture === capture &&
      !listener.removed;
  });

  for (const listener of snapshot) {
    // stopImmediatePropagation 会阻止当前节点剩余监听器。
    if (event._stopImmediatePropagationFlag) break;
    if (listener.removed) continue;

    // once 的本质：调用前或调用后把记录标记为 removed，确保只执行一次。
    if (listener.once) {
      listener.removed = true;
    }

    // 调用 passive 监听器期间，preventDefault 应该被忽略。
    event._inPassiveListenerFlag = listener.passive;

    log(`  ${phaseName(event.eventPhase)} ${currentTarget.name} capture=${listener.capture} once=${listener.once} passive=${listener.passive}`);

    // 浏览器调用监听器时，this 通常指向 currentTarget。
    listener.callback.call(currentTarget, event);

    // 离开当前监听器后，恢复 passive 状态。
    event._inPassiveListenerFlag = false;
  }
}

function phaseName(phase) {
  if (phase === MyEvent.CAPTURING_PHASE) return 'capture';
  if (phase === MyEvent.AT_TARGET) return 'target ';
  if (phase === MyEvent.BUBBLING_PHASE) return 'bubble ';
  return 'none   ';
}

/*
  建立一棵极简“DOM 树”：

  root
    └── parent
          └── child

  child.dispatchEvent(event) 时：
  - 捕获阶段：root -> parent
  - 目标阶段：child
  - 冒泡阶段：parent -> root
*/
const root = new MyEventTarget('root');
const parent = new MyEventTarget('parent').appendTo(root);
const child = new MyEventTarget('child').appendTo(parent);

// 用来演示 signal 选项：controller.abort() 会移除对应监听器。
const controller = new AbortController();

// root 捕获监听器：在事件到达目标 child 之前执行。
root.addEventListener('save', function (event) {
  log(`    root capture sees target=${event.target.name}, currentTarget=${event.currentTarget.name}`);
}, { capture: true });

// root 冒泡监听器：如果事件 bubbles=true，会在最后阶段执行。
root.addEventListener('save', function () {
  log('    root bubble runs at the end');
});

// parent 捕获监听器：演示捕获阶段从外到内。
parent.addEventListener('save', function () {
  log('    parent capture runs before target');
}, { capture: true });

// parent 冒泡监听器：演示冒泡阶段从内到外。
parent.addEventListener('save', function () {
  log('    parent bubble runs after target');
});

// signal listener：点击 abort 按钮后，这个监听器会被移除。
parent.addEventListener('save', function () {
  log('    parent signal listener runs until abort()');
}, { signal: controller.signal });

// 普通目标监听器：调用 preventDefault，让 dispatchEvent 返回 false。
child.addEventListener('save', function (event) {
  log('    child normal listener calls preventDefault()');
  event.preventDefault();
});

// once 监听器：第一次 dispatch 后会自动移除。
child.addEventListener('save', function () {
  log('    child once listener runs only once');
}, { once: true });

// passive 监听器：即使调用 preventDefault，也会被忽略。
child.addEventListener('save', function (event) {
  log('    child passive listener tries preventDefault()');
  event.preventDefault();
}, { passive: true });

// 派发一个可冒泡、可取消的事件，最接近常见 DOM click 的观察方式。
document.querySelector('#dispatch').addEventListener('click', function () {
  child.dispatchEvent(new MyEvent('save', {
    bubbles: true,
    cancelable: true,
    detail: { source: 'primary button' }
  }));
});

// 派发一个不冒泡事件：parent/root 的冒泡监听器不会执行。
document.querySelector('#dispatchNoBubble').addEventListener('click', function () {
  child.dispatchEvent(new MyEvent('save', {
    bubbles: false,
    cancelable: true
  }));
});

// 触发 AbortController，移除 parent 上带 signal 的监听器。
document.querySelector('#abort').addEventListener('click', function () {
  controller.abort();
});

document.querySelector('#reset').addEventListener('click', resetLog);

resetLog();
log('点击 dispatch child:save 开始观察。');
