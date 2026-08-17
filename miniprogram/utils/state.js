const SILENT_ACCEPT_MS = 5 * 60 * 1000;
const { GENTLE_V1 } = require("./copy");

const CARDS = GENTLE_V1.presetCards;

function countByType(events, type) {
  return events.filter((e) => e.type === type).length;
}

function deriveCardState(events) {
  const sorted = (events || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const hasAccept = sorted.some((e) => e.type === "accept");
  if (hasAccept) {
    const acceptEvent = sorted.slice().reverse().find((e) => e.type === "accept");
    return {
      state: "已生效",
      terminal: true,
      price: acceptEvent.score || 0,
      guideActions: [],
      respondActions: [],
    };
  }
  const last = sorted[sorted.length - 1];
  if (!last) {
    return { state: "未激活", terminal: false, price: 0, guideActions: [], respondActions: ["offer"] };
  }
  // 最后一次终止（pause/cancel/giveup）之后重新计数
  const lastEndIdx = Math.max(
    sorted.map((e) => e.type).lastIndexOf("pause"),
    sorted.map((e) => e.type).lastIndexOf("cancel"),
    sorted.map((e) => e.type).lastIndexOf("giveup")
  );
  const chain = lastEndIdx >= 0 ? sorted.slice(lastEndIdx + 1) : sorted;
  const initiateCount = chain.filter((e) => e.type === "initiate").length;
  let state = "待回应";
  if (last.type === "pause") state = "暂不启用";
  else if (last.type === "cancel" || last.type === "giveup") state = "已放弃";
  else if (last.type === "counter") state = "协商中";
  else if (last.type === "initiate") state = "待回应";

  let guideActions = [];
  let respondActions = [];

  if (state === "待回应") {
    // 回应方发起后：引导方操作
    if (initiateCount >= 2) {
      // 第 2 次发起（修改后）：引导方不能再还价
      guideActions = ["accept", "pause"];
      respondActions = [];  // 二次出价后：回应方等待对方接受或取消，不再显示「这张卡先不发了」
    } else {
      // 第 1 次发起：引导方接受/还价/暂不启用
      guideActions = ["accept", "counter", "pause"];
      respondActions = ["withdraw"];
    }
  } else if (state === "协商中") {
    // 引导方还价后：回应方操作（接受/放弃/修改）
    respondActions = ["offer", "accept", "giveup"];
    guideActions = [];
  } else if (state === "暂不启用" || state === "已放弃") {
    respondActions = ["offer"];
  }
  return { state, terminal: false, price: 0, guideActions, respondActions };
}

function deriveState(events) {
  const sorted = (events || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const now = Date.now();

  let state = "待回应";
  let terminal = false;
  let softEnd = false;
  let silentAccept = false;
  let guideActions = [];
  let respondActions = [];

  const counterCount = countByType(sorted, "counter");
  const reviseCount = countByType(sorted, "revise");
  const hasAccept = countByType(sorted, "accept") > 0;
  const hasSubmit = countByType(sorted, "submit") > 0;
  const hasConfirm = countByType(sorted, "confirm") > 0;
  const hasCancel = countByType(sorted, "cancel") > 0;
  const lastEvent = sorted[sorted.length - 1];

  if (hasConfirm) {
    state = "已完成";
    terminal = true;
  } else if (hasCancel) {
    state = "已取消";
    terminal = true;
  } else if (reviseCount >= 3) {
    state = "已取消";
    terminal = true;
    softEnd = true;
    guideActions = ["confirm", "cancel"];  // 引导方有最终决定权
  } else if (hasSubmit) {
    state = "待确认";
  } else if (hasAccept) {
    state = "进行中";
  } else if (counterCount > 0) {
    state = "协商中";
  } else if (lastEvent && now - (lastEvent.createdAt || now) >= SILENT_ACCEPT_MS) {
    state = "进行中";
    silentAccept = true;
  } else {
    state = "待回应";
  }

  if (terminal) {
    return { state, terminal, softEnd, silentAccept, counterCount, reviseCount, guideActions, respondActions };
  }

  if (state === "待回应") {
    respondActions = ["counter", "submit"];
    guideActions = ["cancel"];  // 引导方可以取消
  } else if (state === "协商中") {
    if (counterCount >= 3) {
      // 第 3 次讨价后：引导方只有「取消这条约定」，回应方无按钮
      guideActions = ["cancel"];
      respondActions = [];
    } else if (lastEvent && lastEvent.type === "counter") {
      guideActions = ["initiate", "cancel"];
      respondActions = [];
    } else if (lastEvent && lastEvent.type === "initiate") {
      guideActions = [];
      respondActions = ["counter", "accept"];
    } else {
      guideActions = ["initiate", "cancel"];
      respondActions = ["counter", "accept"];
    }
  } else if (state === "进行中") {
    respondActions = ["submit"];
    guideActions = ["cancel"];
  } else if (state === "待确认") {
    if (lastEvent && lastEvent.type === "revise") {
      guideActions = [];             // 引导方已经驳回，等待回应方重新提交
      respondActions = ["submit"];
    } else {
      guideActions = ["confirm", "revise", "cancel"];
      respondActions = [];           // 正常待确认，回应方无按钮
    }
  }

  return { state, terminal, softEnd, silentAccept, counterCount, reviseCount, guideActions, respondActions };
}

function deriveCapsuleBox(events, role) {
  const sorted = (events || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const lastEvent = sorted[sorted.length - 1];
  if (!lastEvent) return "新动态";
  const st = deriveState(sorted);
  if (st.terminal) return "新动态";
  if (lastEvent.type === "counter" && role === "guide") return "待回应";
  if (lastEvent.type === "submit" && role === "guide") return "待回应";
  if (lastEvent.type === "revise" && role === "respond") return "待回应";
  if (lastEvent.type === "initiate" && role === "respond") return "待回应";
  return "新动态";
}

module.exports = { deriveState, deriveCapsuleBox, deriveCardState, CARDS };
