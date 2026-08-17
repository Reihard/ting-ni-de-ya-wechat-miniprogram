const assert = require("assert");
const { deriveState } = require("../miniprogram/utils/state");
const SILENT_ACCEPT_MS = 5 * 60 * 1000;

const ev = (type, createdAt) => ({ type, createdAt: createdAt || Date.now() });

// S1
let r = deriveState([ev("initiate")]);
assert.strictEqual(r.state, "待回应");
assert.strictEqual(r.terminal, false);

// S2
r = deriveState([ev("initiate"), ev("counter"), ev("accept")]);
assert.strictEqual(r.state, "进行中");

// S3
r = deriveState([
  ev("initiate"),
  ev("counter"),
  ev("counter"),
  ev("counter"),
]);
assert.strictEqual(r.state, "协商中");
assert.ok(r.counterCount >= 3);
assert.deepStrictEqual(r.guideActions, ["cancel"]);  // 第 3 次讨价后引导方只有取消

// S4
r = deriveState([ev("initiate"), ev("counter"), ev("accept"), ev("submit"), ev("confirm")]);
assert.strictEqual(r.state, "已完成");
assert.strictEqual(r.terminal, true);

// S5
r = deriveState([
  ev("initiate"),
  ev("counter"),
  ev("accept"),
  ev("submit"),
  ev("revise"),
  ev("submit"),
  ev("confirm"),
]);
assert.strictEqual(r.state, "已完成");

// S6 温柔终止
r = deriveState([
  ev("initiate"),
  ev("counter"),
  ev("accept"),
  ev("submit"),
  ev("revise"),
  ev("revise"),
  ev("revise"),
]);
assert.strictEqual(r.state, "已取消");
assert.strictEqual(r.terminal, true);
assert.strictEqual(r.softEnd, true);

// S7 静默接受：唯一 initiate，超过 5 分钟 → 进行中
r = deriveState([{ type: "initiate", createdAt: Date.now() - SILENT_ACCEPT_MS - 1000 }]);
assert.strictEqual(r.state, "进行中");
assert.strictEqual(r.silentAccept, true);

console.log("Step2 state 自检全部通过");
