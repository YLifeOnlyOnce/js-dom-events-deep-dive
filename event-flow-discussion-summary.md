# DOM 事件流转模型讨论结论

这份文档记录一次关于 DOM 事件底层流转模型的讨论结论。重点不是罗列 API，而是把“事件对象、事件路径、EventTarget、listener records、currentTarget、默认行为”之间的关系整理清楚。

---

## 1. 我的原始表述

> 所以一个事件的流转过程是：当点击后，会生成一个点击事件的实例，同时会确定target对象，计算元素捕获和触发的事件路径，生成的点击事件的实例会在该路径中流转，并根据事件的配置字段来确定在各个currentTarget中的EventTarget的listeners的是否执行。整个过程都是基于event对象中的状态和配置来控制事件流转，EventTarget更多是维护listeners和注册的records的数据。

这段理解已经抓住了核心方向：

- 点击后会产生一个事件对象。
- 浏览器会确定 `target`。
- 浏览器会计算事件路径。
- 事件对象会沿路径流转。
- 每个阶段是否执行监听器，取决于事件状态和监听器配置。
- `currentTarget` 和监听器记录有关。

---

## 2. 更精确的校正版

更准确的说法是：

> 用户输入后，浏览器先通过命中测试确定初始 `target`，然后创建对应的事件对象，比如 `MouseEvent`、`PointerEvent` 或普通 `Event`。浏览器根据 `target` 和 DOM 树计算本次事件的事件路径。事件对象沿着这条路径依次经历捕获阶段、目标阶段和冒泡阶段。每到一个节点，这个节点会成为当前的 `currentTarget`，分发算法会查询该 `EventTarget` 自己维护的 listener records，并根据事件类型、阶段、监听器配置以及事件对象内部状态决定是否调用对应监听器。监听器执行过程中可以修改事件对象的内部状态，比如停止传播或取消默认行为。事件分发结束后，浏览器根据 `defaultPrevented` 等状态决定是否执行可取消的默认行为。

---

## 3. 一次事件的完整流转过程

```txt
用户输入
  ↓
浏览器命中测试，确定初始 target
  ↓
创建事件对象，比如 MouseEvent / PointerEvent / Event
  ↓
根据 target 和 DOM 树计算 event path
  ↓
事件对象沿 path 进入捕获阶段
  ↓
到达 target，进入目标阶段
  ↓
如果 event.bubbles 为 true，进入冒泡阶段
  ↓
每到一个 currentTarget，就查它自己的 listener records
  ↓
根据 type / capture / removed / once / passive / signal 等信息决定如何调用
  ↓
监听器可能修改 event 内部状态
  ↓
分发结束后，根据 defaultPrevented 决定是否执行可取消默认行为
```

---

## 4. 核心对象之间的关系

### 4.1 event.target

`event.target` 表示事件最初发生或被派发到的对象。

在一次点击中，它通常由浏览器通过命中测试得到：

```txt
鼠标坐标
  ↓
布局、层叠、可见性、pointer-events 等规则
  ↓
命中的 DOM 元素
  ↓
event.target
```

在脚本派发事件时：

```js
child.dispatchEvent(event);
```

`child` 就是本次事件的初始 `target`。

### 4.2 event path

事件路径是本次事件会经过的一串 `EventTarget`。

简化模型：

```txt
window
document
html
body
div
button
```

点击 `button` 时：

```txt
捕获阶段：
window -> document -> html -> body -> div

目标阶段：
button

冒泡阶段：
div -> body -> html -> document -> window
```

注意：事件路径通常在分发开始前计算出来。即使监听器执行过程中 DOM 结构发生变化，本次事件的主要传播路径也不会随意改变。

### 4.3 event.currentTarget

`event.currentTarget` 表示当前正在执行监听器的那个 `EventTarget`。

它会随着事件传播过程变化：

```txt
执行 body 监听器时：
target        = button
currentTarget = body

执行 div 监听器时：
target        = button
currentTarget = div

执行 button 监听器时：
target        = button
currentTarget = button
```

所以：

```txt
target 是本次事件的起点。
currentTarget 是当前分发算法走到的节点。
```

### 4.4 EventTarget 和 listener records

更准确地说，不是 `currentTarget` 维护监听器，而是每个 `EventTarget` 维护自己的 listener records。

当某个节点在分发过程中成为 `currentTarget` 时，分发算法会读取这个节点上的监听器表：

```txt
currentTarget._listeners
├── { type: "click", callback: A, capture: true }
├── { type: "click", callback: B, capture: false }
├── { type: "click", callback: C, once: true }
└── { type: "click", callback: D, passive: true }
```

因此更精确的表述是：

> `currentTarget` 不是一个专门维护监听器的对象身份，而是当前正在被处理的那个 `EventTarget`。每个 `EventTarget` 自己维护 listener records；当它成为 `currentTarget` 时，分发算法查询它的 listener records。

---

## 5. event 对象如何控制事件流转

事件对象不只是数据，它更像一次分发过程中的状态机。

可以把它理解成：

```js
const eventLike = {
  type: 'click',
  target: button,
  currentTarget: null,
  eventPhase: 0,
  bubbles: true,
  cancelable: true,
  defaultPrevented: false,

  stopPropagationFlag: false,
  stopImmediatePropagationFlag: false,
  inPassiveListenerFlag: false,
  dispatchFlag: false
};
```

这些状态会影响后续流程。

### 5.1 bubbles

```txt
bubbles = true
  进入冒泡阶段

bubbles = false
  不进入冒泡阶段
```

### 5.2 cancelable

```txt
cancelable = true
  preventDefault() 可以让 defaultPrevented 变成 true

cancelable = false
  preventDefault() 不产生取消默认行为的效果
```

### 5.3 stopPropagationFlag

调用：

```js
event.stopPropagation();
```

效果：

```txt
stopPropagationFlag = true
```

分发算法在准备进入后续节点前检查它。如果为 `true`，就不再继续传播。

### 5.4 stopImmediatePropagationFlag

调用：

```js
event.stopImmediatePropagation();
```

效果：

```txt
stopPropagationFlag = true
stopImmediatePropagationFlag = true
```

它不仅阻止继续传播到后续节点，也阻止当前 `currentTarget` 上剩余监听器继续执行。

### 5.5 defaultPrevented

调用：

```js
event.preventDefault();
```

如果事件可取消，并且当前不在 passive listener 中：

```txt
defaultPrevented = true
```

事件分发结束后，浏览器会根据它判断是否跳过可取消的默认行为。

---

## 6. listener record 如何参与决策

事件流转不是只看 event，也要看每个 listener record。

一条 listener record 可以粗略理解为：

```js
const listenerRecord = {
  type: 'click',
  callback: handleClick,
  capture: false,
  once: false,
  passive: false,
  signal: null,
  removed: false
};
```

分发算法到达某个 `currentTarget` 时，会根据这些字段判断：

```txt
type 是否匹配当前 event.type？
capture 是否匹配当前阶段？
removed 是否已经为 true？
once 是否需要调用后移除？
passive 是否让 preventDefault() 失效？
signal 是否已经 abort？
```

因此最终是否执行某个监听器，是由两类状态共同决定的：

```txt
event 对象状态
  type
  bubbles
  eventPhase
  stopPropagationFlag
  stopImmediatePropagationFlag

listener record 配置
  type
  callback
  capture
  once
  passive
  signal
  removed
```

---

## 7. dispatchEvent 的简化推导

可以用下面的伪代码理解：

```js
function dispatchEvent(target, event) {
  event.target = target;

  const path = buildEventPath(target);

  event.eventPhase = CAPTURING_PHASE;
  for (const currentTarget of path.fromRootToTargetParent()) {
    event.currentTarget = currentTarget;
    invokeListeners(currentTarget, event, { capture: true });
    if (event.stopPropagationFlag) break;
  }

  event.eventPhase = AT_TARGET;
  event.currentTarget = target;
  invokeListeners(target, event, { capture: true });
  invokeListeners(target, event, { capture: false });

  if (event.bubbles && !event.stopPropagationFlag) {
    event.eventPhase = BUBBLING_PHASE;

    for (const currentTarget of path.fromTargetParentToRoot()) {
      event.currentTarget = currentTarget;
      invokeListeners(currentTarget, event, { capture: false });
      if (event.stopPropagationFlag) break;
    }
  }

  event.currentTarget = null;
  event.eventPhase = NONE;

  return !event.defaultPrevented;
}
```

这个伪代码解释了很多上层表现：

- 为什么 `target` 通常不变。
- 为什么 `currentTarget` 会变化。
- 为什么捕获和冒泡的执行顺序相反。
- 为什么 `bubbles: false` 不会冒泡。
- 为什么 `preventDefault()` 会影响 `dispatchEvent()` 返回值。
- 为什么 `stopPropagation()` 会影响后续节点。

---

## 8. 最终结论

可以把最终模型压缩成这段话：

> 一个事件不是简单调用某个回调函数，而是浏览器围绕一个 `Event` 对象执行的一次分发过程。浏览器先确定 `target`，再计算事件路径，然后让同一个事件对象沿路径依次经历捕获、目标、冒泡阶段。每经过一个节点，该节点就成为 `currentTarget`，分发算法会查询它作为 `EventTarget` 所维护的 listener records，并结合事件对象状态决定哪些监听器要执行。监听器执行过程中可以修改事件对象的内部状态，从而影响后续传播、默认行为和 `dispatchEvent()` 的返回值。

一句更短的版本：

> `target` 决定事件从哪里开始，event path 决定事件经过哪里，`currentTarget` 表示当前处理到哪里，listener records 决定当前节点有哪些监听器，event 内部状态决定后续还能不能继续传播或执行默认行为。

