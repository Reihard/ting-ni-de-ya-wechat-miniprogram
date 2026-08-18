const app = getApp();
const { deriveState, deriveCardState, CARDS } = require("../../utils/state");
let GENTLE_V1 = app.getCopy();

let TYPE_LABEL = GENTLE_V1.eventLabels;
let ACTION_LABEL = GENTLE_V1.actions.promise;
let CARD_ACTION_LABEL = GENTLE_V1.actions.card;

Page({
  data: {
    threadId: "",
    events: [],
    state: "",
    role: "",
    themeClass: "",
    copy: app.getCopy(),
    actions: [],
    inputText: "",
    softCopy: "",
    info: { title: "", desc: "", score: 0 },
    eventsExpanded: false,
    loading: false,
    editSubmitting: false,
    showInputArea: false,
    showRejectInput: false,
    editingInitiate: false,
    redeeming: false,
    editTitle: "",
    editDesc: "",
    editScore: 0,
    editReason: "",
    isCard: false,
    isExecute: false,
    cardName: "",
    cardType: "",
    editActionKey: "", // 当前编辑动作：offer / counter
  },

  onLoad(options) {
    GENTLE_V1 = app.getCopy();
    TYPE_LABEL = GENTLE_V1.eventLabels;
    ACTION_LABEL = GENTLE_V1.actions.promise;
    CARD_ACTION_LABEL = GENTLE_V1.actions.card;
    app.applyThemeChrome(app.globalData.role);
    const tid = options.threadId || "";
    const isCard = tid.indexOf("card_") === 0;
    const isExecute = tid.indexOf("_execute_") > -1;
    this.setData({
      threadId: tid,
      role: app.globalData.role,
      themeClass: app.getThemeClass(app.globalData.role),
      isCard,
      isExecute,
      cardName: isCard ? tid.replace("card_", "").split("_execute_")[0] : "",
      cardType: isCard ? tid.replace("card_", "").split("_execute_")[0] : "",
    });
    this.load();
  },

  async load() {
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "queryEvents",
        spaceId: app.globalData.spaceId,
        threadId: this.data.threadId,
        limit: 100,
      },
    });
    const r = res.result || {};
    if (!r.success) return;

    const events = (r.events || []).slice().reverse();
    const customDefinition = this.data.isCard && events.find((e) => e.type === "create" || e.type === "request");
    const customCreate = this.data.isCard && events.find((e) => e.type === "create");
    const cardEvents = this.data.isCard ? events.filter((e) => e.type !== "create") : events;
    const st = this.data.isCard
      ? (customCreate ? { state: "已生效", terminal: true, price: customCreate.score || 0 } : deriveCardState(cardEvents))
      : deriveState(events);
    if (customDefinition && !customCreate && !events.some((e) => e.type === "accept")) {
      st.state = events.some((e) => e.type === "pause") ? "暂不启用" : "待 TA 确认";
    }
    // 卡片约定复用约定的状态推导（状态判断一致）
    if (this.data.isExecute && st.state === "待回应") {
      st.state = "待执行";  // 卡片约定的「待回应」显示为「待执行」
    }
    const lastEvent = events[events.length - 1];

    let info = { title: "", desc: "", score: 0, latestMessage: "" };

    if (this.data.isCard) {
      // 心意卡：标题是卡名
      info.title = this.data.cardName;
      if (customDefinition) {
        try {
          const definition = JSON.parse(customDefinition.text || "{}");
          info.title = definition.name || info.title;
          info.desc = definition.desc || "";
          info.score = customDefinition.score || 0;
          this.data.cardName = info.title;
        } catch (err) {}
      }
      if (st.state === "已生效") {
        // 已生效：显示锁定文案，不显示商议理由
        info.latestMessage = GENTLE_V1.cards.cardLocked.replace("{score}", st.price);
        info.score = 0;
      } else {
        // 找最新报价事件（initiate 或 counter），取分值
        const quoteEvents = events.filter((e) => e.type === "initiate" || e.type === "counter");
        const latestQuote = quoteEvents[quoteEvents.length - 1];
        if (latestQuote) {
          info.score = latestQuote.score || 0;
          if (latestQuote.type === "counter") {
            info.latestMessage = latestQuote.text || "";
          } else {
            try {
              const parsed = JSON.parse(latestQuote.text);
              info.latestMessage = parsed.reason || "";
            } catch (err) {
              info.latestMessage = latestQuote.text || "";
            }
          }
        }
      }
    } else {
      // 找第一条 initiate（原始约定）
      const firstInitiate = events.find((e) => e.type === "initiate");
      // 找最新一条 initiate（可能是修改约定）
      const latestInitiate = events.slice().reverse().find((e) => e.type === "initiate");

      // 从第一条 initiate 提取原始标题/说明
      if (firstInitiate) {
        try {
          const parsed = JSON.parse(firstInitiate.text);
          info.title = parsed.title || "";
          info.desc = parsed.desc || "";
        } catch (err) {
          info.title = firstInitiate.text || "";
        }
      }

      // 分数以"最后一条谈定带分事件"为准（initiate/counter 中最新一条）
      // 与云函数 confirm 入账口径保持一致：例 10 分改 15 分后，显示与入账均为 15
      const scoredEvents = events.filter(
        (e) => (e.type === "initiate" || e.type === "counter") && typeof e.score === "number"
      );
      const lastScored = scoredEvents[scoredEvents.length - 1];
      info.score = lastScored ? lastScored.score : 0;

      // 如果最新 initiate 和第一条不同，说明有修改（用于标题/补充说明更新）
      if (latestInitiate && latestInitiate._id !== firstInitiate._id) {
        try {
          JSON.parse(latestInitiate.text);
          // 是 JSON，说明是新的完整约定
          const parsed = JSON.parse(latestInitiate.text);
          info.title = parsed.title || info.title;
          info.desc = parsed.desc || info.desc;
          info.latestMessage = parsed.reason || "";
        } catch (err) {
          // 不是 JSON，是修改理由
          info.latestMessage = latestInitiate.text;
        }
      }

      // 找对方最新的事件（counter、submit 或 initiate）——actor 存的是角色（guide/respond）
      const myRole = this.data.role;
      const opponentRole = myRole === "guide" ? "respond" : "guide";
      const opponentEvents = events.filter((e) =>
        e.actor === opponentRole &&
        (e.type === "counter" || e.type === "submit" || (e.type === "initiate" && (!firstInitiate || e._id !== firstInitiate._id)))
      );
      const opponentLatestEvent = opponentEvents[opponentEvents.length - 1];
      if (opponentLatestEvent) {
        if (opponentLatestEvent.type === "counter") {
          info.latestMessage = opponentLatestEvent.text;
        } else if (opponentLatestEvent.type === "submit") {
          info.latestMessage = opponentLatestEvent.text || "TA 已经回复了这条约定";
        } else if (opponentLatestEvent.type === "initiate") {
          try {
            const parsed = JSON.parse(opponentLatestEvent.text);
            info.latestMessage = parsed.reason || "";
          } catch (err) {
            info.latestMessage = opponentLatestEvent.text;
          }
        }
      }
    }

    if (this.data.isExecute) {
      const firstInitiate = events.find((e) => e.type === "initiate");
      if (firstInitiate && firstInitiate.cardType) {
        this.data.cardName = firstInitiate.cardType;
        this.data.cardType = firstInitiate.cardType;
      }
      if (firstInitiate) {
        info.score = firstInitiate.score || 0;
      }
    }

    if (this.data.isCard || this.data.isExecute) {
      info.title = this.data.cardName;  // 卡名
      // 找卡片文案
      const card = app.getCopy().presetCards.find((c) => c.name === this.data.cardName);
      if (card) {
        info.description = card.desc;
      }
    }

    const space = app.globalData.space;
    const nicknames = (space && space.nicknames) || {};
    const roles = (space && space.roles) || {};
    const nicknameByRole = {};
    Object.keys(roles).forEach((openid) => {
      nicknameByRole[roles[openid]] = nicknames[openid] || "";
    });

    if (this.data.isCard && st.state !== "已生效") {
      const latestCardAction = events[events.length - 1];
      const latestActorName = latestCardAction && nicknameByRole[latestCardAction.actor] || "TA";
      if (latestCardAction && latestCardAction.type === "pause") {
        info.latestMessage = GENTLE_V1.cards.paused;
      } else if (latestCardAction && (latestCardAction.type === "cancel" || latestCardAction.type === "giveup")) {
        info.latestMessage = `${latestActorName} ${GENTLE_V1.cards.giveup}`;
      }
    }

    const displayEvents = events.map((e) => {
      const actorName = e.actor === "system" ? "系统" : nicknameByRole[e.actor] || "";
      let text = "";
      if (this.data.isExecute) {
        if (e.type === "submit") {
          text = `${nicknameByRole["guide"] || "TA"} ${GENTLE_V1.detail.executeSubmit}`;
          if (e.text) text += "\n" + e.text;
        } else if (e.type === "pause") {
          text = `${nicknameByRole["guide"] || "TA"} ${GENTLE_V1.detail.executePause}`;
        } else if (e.type === "confirm") {
          text = `${nicknameByRole["respond"] || "TA"} ${GENTLE_V1.detail.executeConfirm}`;
          if (e.text) text += "\n" + e.text;
        } else if (e.type === "revise") {
          text = `${nicknameByRole["respond"] || "TA"} ${GENTLE_V1.detail.executeRevise}`;
          if (e.text) text += "\n" + e.text;
        } else if (e.type === "cancel") {
          text = `「${this.data.cardName}」${GENTLE_V1.detail.executeCancel}`;
          if (e.text) text += "\n" + e.text;
        } else {
          text = e.text || "";
        }
      } else if (this.data.isCard) {
        if (e.type === "initiate") {
          try {
            const parsed = JSON.parse(e.text);
            text = parsed.reason || "";
          } catch (err) {
            text = e.text || "";
          }
        } else if (e.type === "accept") {
          text = e.text || "";
        } else {
          text = e.text || "";
        }
        // 只有报价事件（initiate/counter）展示分值前缀；accept 文案已含分值，避免重复
        if ((e.type === "initiate" || e.type === "counter") && typeof e.score === "number" && e.score > 0) {
          text = text ? `${e.score} 分 · ${text}` : `${e.score} 分`;
        }
      } else {
        if (e.type === "cancel" && e.kind === "promise") {
          text = GENTLE_V1.detail.promiseCancel;
        } else if (e.type === "remember") {
          text = GENTLE_V1.detail.remembered;
        } else {
          try {
            const parsed = JSON.parse(e.text);
            text = parsed.desc || e.text;
          } catch (err) {
            text = e.text;
          }
        }
      }
      return {
        label: TYPE_LABEL[e.type] || e.type,
        text,
        actorName,
        time: this.formatTime(e.createdAt),
      };
    });

    if (this.data.isExecute) {
      const myRole = this.data.role;
      const opponentRole = myRole === "guide" ? "respond" : "guide";
      const opponentEvents = events.filter((e) => e.actor === opponentRole && e.type !== "initiate");
      const opponentLatest = opponentEvents[opponentEvents.length - 1];
      if (opponentLatest) {
        let msg = "";
        if (opponentLatest.type === "submit") {
          msg = `${nicknameByRole[opponentRole] || "TA"} 答应了，正在为你做这件事`;
          if (opponentLatest.text) msg += "\n" + opponentLatest.text;
        } else if (opponentLatest.type === "pause") {
          msg = `${nicknameByRole[opponentRole] || "TA"} 今天先不做这张卡片的约定。不是不答应，是想等更好的时候。卡还在。`;
        } else if (opponentLatest.type === "confirm") {
          msg = `${nicknameByRole[opponentRole] || "TA"} 收到了，很满足`;
          if (opponentLatest.text) msg += "\n" + opponentLatest.text;
        } else if (opponentLatest.type === "revise") {
          msg = `${nicknameByRole[opponentRole] || "TA"} 希望更好，再试一次也愿意等`;
          if (opponentLatest.text) msg += "\n" + opponentLatest.text;
        } else if (opponentLatest.type === "cancel") {
          msg = `「${this.data.cardName}」的约定，先放下了`;
          if (opponentLatest.text) msg += "\n" + opponentLatest.text;
        }
        info.latestMessage = msg;
      }
    }

    let myActionsKey;
    if (this.data.isExecute) {
      const lastEvent = events[events.length - 1];

      if (st.state === "待执行") {
        // initiate 后（或 revise 后回到待回应）
        myActionsKey = this.data.role === "guide" ? ["submit", "pause"] : [];
      } else if (st.state === "待确认") {
        if (lastEvent && lastEvent.type === "revise") {
          // 回应方驳回后，引导方重新执行
          myActionsKey = this.data.role === "guide" ? ["submit", "pause"] : [];
        } else {
          // 正常待确认，回应方操作
          myActionsKey = this.data.role === "respond" ? ["confirm", "revise", "cancel"] : [];
        }
      } else if (st.softEnd && this.data.role === "guide") {
        // 温柔终止后，引导方有最终决定权
        myActionsKey = ["confirm", "cancel"];
      } else {
        myActionsKey = [];
      }
    } else {
      myActionsKey = this.data.role === "guide" ? st.guideActions : st.respondActions;
    }
    let actions = myActionsKey.map((k) => ({
      key: k,
      label: this.data.isCard ? (CARD_ACTION_LABEL[k] || ACTION_LABEL[k]) : ACTION_LABEL[k],
    }));

    if (this.data.isCard) {
      if (st.state === "已生效" && this.data.role === "respond") {
        // 已生效：回应方可以「使用」
        actions = [{ key: "redeem", label: GENTLE_V1.detail.redeem }];
      } else if (st.state === "暂不启用" && this.data.role === "respond") {
        // 暂不启用：回应方可以「重新启用」或「放弃」
        actions = [
          { key: "offer", label: GENTLE_V1.cards.resume },
          { key: "giveup", label: GENTLE_V1.cards.giveup }
        ];
      } else if (customDefinition && !customCreate && this.data.role === "guide" && st.state === "待 TA 确认") {
        actions = [
          { key: "accept", label: GENTLE_V1.cards.accept },
          { key: "pause", label: GENTLE_V1.actions.card.pause },
        ];
      } else if (st.state === "已放弃") {
        // 已放弃：没有按钮
        actions = [];
      }
    }

    // 契约终止态不显示任何按钮（已完成/已取消）；温柔终止除外（引导方留有最终决定权）；心意卡已生效除外
    if (!this.data.isCard && st.terminal && !st.softEnd) {
      actions = [];
    }

    actions.sort((a, b) => {
      if (a.key === "submit") return -1;
      if (b.key === "submit") return 1;
      return 0;
    });

    let showInputArea = false;
    if (!st.softEnd) {  // 温柔终止后不显示输入框
      if (!this.data.isCard && !this.data.isExecute) {
        showInputArea =
          (this.data.role === "respond" && ["待回应", "协商中", "进行中"].includes(st.state) && !(st.state === "协商中" && lastEvent && lastEvent.type === "counter")) ||
          (this.data.role === "guide" && st.state === "待确认" && this.data.showRejectInput);
      } else if (this.data.isExecute) {
        showInputArea = !st.softEnd;  // 温柔终止后不显示，其余始终显示
      }
    }

    let softCopy = "";
    if (this.data.isCard) {
      const initiateCount = events.filter((e) => e.type === "initiate").length;
      if (this.data.role === "respond" && initiateCount >= 2 && st.state === "待回应") {
        // 出价 2 次截止，引导方做最后决定
        softCopy = GENTLE_V1.detail.softTwice;
      } else if (st.state === "暂不启用" && this.data.role === "respond") {
        // 暂不启用软文案（蓝图原文）
        softCopy = GENTLE_V1.detail.softPaused;
      }
    } else if (st.softEnd) {
      softCopy = GENTLE_V1.detail.softEnded;
    } else if (st.counterCount >= 3 && this.data.role === "respond") {
      softCopy = GENTLE_V1.detail.softCounterEnded;
    }

    this.setData({
      events: displayEvents,
      state: st.state,
      actions,
      softCopy,
      info,
      showInputArea,
    });

    // 进入详情即视为已读，清掉首页的未读提醒（后台执行，不阻塞渲染）
    wx.cloud.callFunction({
      name: "loveApi",
      data: { action: "markRead", spaceId: app.globalData.spaceId, threadId: this.data.threadId },
    });
  },

  formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onInputText(e) {
    this.setData({ inputText: e.detail.value });
  },

  toggleEvents() {
    this.setData({ eventsExpanded: !this.data.eventsExpanded });
  },

  async onTapAction(e) {
    const key = e.currentTarget.dataset.key;

    if (key === "redeem") {
      if (this.data.redeeming) return;   // 防连点重复兑换
      this.setData({ redeeming: true });
      try {
        const res = await wx.cloud.callFunction({
          name: "loveApi",
          data: { action: "redeemCard", spaceId: app.globalData.spaceId, cardType: this.data.cardType },
        });
        const r = res.result || {};
        if (r.success) {
          wx.showToast({ title: GENTLE_V1.detail.used, icon: "success" });
          wx.redirectTo({ url: `/pages/detail/detail?threadId=${r.threadId}` });
        } else {
          wx.showToast({ title: r.msg || GENTLE_V1.detail.retry, icon: "none" });
        }
      } catch (e) {
        wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
      } finally {
        this.setData({ redeeming: false });   // 失败可重试；成功将跳转本页不再用
      }
      return;
    }

    if (this.data.isCard) {
      if (key === "offer" || key === "counter") {
        this.setData({
          editingInitiate: true,
          editScore: this.data.info.score || 0,
          editReason: "",
          editActionKey: key,
        });
        return;
      }
      if (key === "accept") {
        await this.submit(key, "", this.data.info.score);
        return;
      }
      await this.submit(key, "");
      return;
    }

    if (this.data.isExecute) {
      const text = this.data.inputText;

      if (key === "revise" && !text) {
        // 驳回：必须写理由
        wx.showToast({ title: GENTLE_V1.detail.reasonRequired, icon: "none" });
        return;
      }

      if (key === "submit" || key === "pause") {
        // 执行/暂不执行：选填
        const ok = await this.submit(key, text);
        if (ok) this.setData({ inputText: "" });
        return;
      }

      if (key === "confirm" || key === "cancel") {
        // 确认/取消：选填
        const ok = await this.submit(key, text, key === "confirm" ? this.data.info.score : undefined);
        if (ok) this.setData({ inputText: "" });
        return;
      }

      if (key === "revise") {
        // 驳回：带理由提交
        const ok = await this.submit(key, text);
        if (ok) this.setData({ inputText: "" });
        return;
      }
    }

    const text = this.data.inputText;

    if (key === "initiate") {
      this.setData({
        editingInitiate: true,
        editTitle: this.data.info.title,
        editDesc: this.data.info.desc,
        editScore: this.data.info.score,
        editReason: "",
      });
      return;
    }

    if (key === "counter" && !text) {
      wx.showToast({ title: GENTLE_V1.detail.reasonRequired, icon: "none" });
      return;
    }

    if (key === "revise") {
      if (!this.data.showRejectInput) {
        this.setData({ showRejectInput: true });
        this.load();
        return;
      }
      const ok = await this.submit(key, text);
      if (ok) this.setData({ inputText: "", showRejectInput: false });
      return;
    }

    const ok = key === "confirm"
      ? await this.submit(key, "", this.data.info.score)
      : await this.submit(key, text);
    if (ok) this.setData({ inputText: "", showRejectInput: false });
  },

  onEditTitleInput(e) {
    this.setData({ editTitle: e.detail.value });
  },

  onEditDescInput(e) {
    this.setData({ editDesc: e.detail.value });
  },

  onEditScoreInput(e) {
    this.setData({ editScore: e.detail.value });
  },

  onEditReasonInput(e) {
    this.setData({ editReason: e.detail.value });
  },

  onCancelEdit() {
    this.setData({ editingInitiate: false, editReason: "" });
  },

  async onSubmitEdit() {
    if (this.data.loading || this.data.editSubmitting) return;
    const { editTitle, editScore, editReason } = this.data;
    if (!editTitle || !editScore) {
      wx.showToast({ title: GENTLE_V1.detail.fill, icon: "none" });
      return;
    }
    const text = JSON.stringify({ title: editTitle, desc: this.data.info.desc, way: "文字约定", reason: editReason });
    this.setData({ editSubmitting: true, editingInitiate: false });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "appendEvent",
          spaceId: app.globalData.spaceId,
          threadId: this.data.threadId,
          type: "initiate",
          text,
          score: Number(editScore),
        },
      });
      const r = res.result || {};
      if (!r.success) {
        this.setData({ editingInitiate: true });
        wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
        return;
      }
      this.setData({ editReason: "" });
      await this.load();
    } catch (e) {
      this.setData({ editingInitiate: true });
      wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
    } finally {
      this.setData({ editSubmitting: false });
    }
  },

  async onSubmitCardEdit() {
    if (this.data.loading || this.data.editSubmitting) return;
    const { editScore, editReason, editActionKey } = this.data;
    if (!editScore) {
      wx.showToast({ title: GENTLE_V1.detail.fill, icon: "none" });
      return;
    }
    const isOffer = editActionKey === "offer";
    const type = isOffer ? "initiate" : "counter";
    const text = isOffer ? JSON.stringify({ reason: editReason }) : editReason;

    this.setData({ editSubmitting: true, editingInitiate: false });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "appendEvent",
          spaceId: app.globalData.spaceId,
          threadId: this.data.threadId,
          kind: "card_activate",
          cardType: this.data.cardType,
          type,
          text,
          score: Number(editScore),
        },
      });
      const r = res.result || {};
      if (r.success) {
        this.setData({ editReason: "" });
        await this.load();
      } else {
        this.setData({ editingInitiate: true });
        wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
      }
    } catch (e) {
      this.setData({ editingInitiate: true });
      wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
    } finally {
      this.setData({ editSubmitting: false });
    }
  },

  async submit(type, text, score) {
    if (this.data.loading) return;
    this.setData({ loading: true, actions: [], showInputArea: false, showRejectInput: false });
    const data = {
      action: "appendEvent",
      spaceId: app.globalData.spaceId,
      threadId: this.data.threadId,
      type: this.data.isCard && type === "withdraw" ? "cancel" : type,
    };
    if (this.data.isCard) {
      data.kind = "card_activate";
      data.cardType = this.data.cardType;
    }
    if (this.data.isExecute) {
      data.kind = "card_execute";
      data.cardType = this.data.cardType;
    }
    if (text) data.text = text;
    if (score) data.score = score;
    try {
      const res = await wx.cloud.callFunction({ name: "loveApi", data });
      const r = res.result || {};
      if (r.success) {
        await this.load();
        return true;
      }
      wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
      await this.load();
      return false;
    } catch (e) {
      wx.showToast({ title: GENTLE_V1.detail.retry, icon: "none" });
      await this.load();
      return false;
    } finally {
      this.setData({ loading: false });
    }
  },
});
