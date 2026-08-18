const app = getApp();
const { deriveCardState, CARDS } = require("../../utils/state");
let GENTLE_V1 = app.getCopy();

Page({
  data: {
    role: "",
    themeClass: "",
    cards: [],
    needInput: false,
    inputCard: "",
    inputScore: "",
    customVisible: false,
    customName: "",
    customDesc: "",
    customScore: "",
    customSubmitting: false,
    cardSubmitting: false,
    copy: app.getCopy(),
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ role: app.globalData.role, themeClass: app.getThemeClass(app.globalData.role), copy: app.getCopy() });
    const cache = wx.getStorageSync("ting_cards_cache_" + app.globalData.spaceId);
    const copyPackId = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
    if (cache && cache.cacheVersion === 1 && cache.copyPackId === copyPackId) {
      this.setData({ cards: (cache.cards || []).map((card) => Object.assign({}, card, { actions: [] })) });
    }
    this.loadCards();
  },

  async loadCards() {
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "queryEvents",
        spaceId: app.globalData.spaceId,
        limit: 100,
      },
    });
    const r = res.result || {};
    if (!r.success || !r.events) return;

    const byCard = {};
    (r.events || []).forEach((e) => {
      if (e.kind !== "card_activate" || !e.cardType) return;
      if (!byCard[e.cardType]) byCard[e.cardType] = [];
      byCard[e.cardType].push(e);
    });

    const cards = app.getCopy().presetCards.map((card) => {
      const name = card.name;
      const evs = (byCard[name] || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const st = deriveCardState(evs);
      const lastScore = evs.length ? evs[evs.length - 1].score || 0 : 0;
      const actions = (st.state === "未激活" && this.data.role === "respond")
        ? [{ key: "offer", label: GENTLE_V1.actions.card.offer }]
        : (st.state === "暂不启用" && this.data.role === "respond")
        ? [{ key: "offer", label: GENTLE_V1.cards.resume }]
        : [];
      return {
        name,
        cardType: name,
        desc: card.desc,
        state: st.state,
        price: st.price,
        lastScore,
        lockedText: GENTLE_V1.cards.cardLocked.replace("{score}", st.price),
        actions,
      };
    });

    const customCards = Object.keys(byCard)
      .filter((cardType) => cardType.indexOf("custom_") === 0)
      .map((cardType) => {
        const evs = byCard[cardType].slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const definitionEvent = evs.find((e) => e.type === "create" || e.type === "request");
        let definition = { name: "专属心意", desc: "" };
        try {
          definition = Object.assign(definition, JSON.parse((definitionEvent && definitionEvent.text) || "{}"));
        } catch (err) {}
        const created = evs.find((e) => e.type === "create");
        const requested = evs.find((e) => e.type === "request");
        const accepted = evs.find((e) => e.type === "accept");
        const paused = evs.slice().reverse().find((e) => e.type === "pause");
        const createdScore = definitionEvent && typeof definitionEvent.score === "number" ? definitionEvent.score : 0;
        const activationEvents = evs.filter((e) => e.type !== "create" && e.type !== "request");
        let st = created ? { state: "已生效", price: createdScore } : deriveCardState(activationEvents);
        if (!created && requested && !accepted) {
          st = { state: paused ? "暂不启用" : "待 TA 确认", price: createdScore };
        }
        const actions = !created && (st.state === "待 TA 确认") && this.data.role === "guide"
          ? [{ key: "accept", label: GENTLE_V1.cards.accept }, { key: "pause", label: GENTLE_V1.actions.card.pause }]
          : (!created && st.state === "暂不启用" && this.data.role === "respond")
          ? [{ key: "offer", label: GENTLE_V1.cards.resend }]
          : [];
        return {
          name: definition.name,
          cardType,
          desc: definition.desc,
          state: st.state,
          price: st.price,
          lastScore: st.price,
          lockedText: GENTLE_V1.cards.cardLocked.replace("{score}", st.price),
          actions,
          custom: true,
        };
      });

    const nextCards = cards.concat(customCards);
    this.setData({ cards: nextCards });
    wx.setStorageSync("ting_cards_cache_" + app.globalData.spaceId, {
      cacheVersion: 1,
      copyPackId: wx.getStorageSync("ting_copy_pack_id") || "gentle_v1",
      cards: nextCards.map((card) => Object.assign({}, card, { actions: [] })),
    });
  },

  goDetail(e) {
    const cardType = e.currentTarget.dataset.cardType;
    wx.navigateTo({ url: `/pages/detail/detail?threadId=card_${cardType}` });
  },

  noop() {},

  onTapAction(e) {
    const { card, key } = e.currentTarget.dataset;
    if (key === "accept" || key === "pause") {
      this.submit(card, key);
      return;
    }
    this.setData({
      needInput: true,
      inputCard: card,
      inputScore: "",
    });
  },

  onInputScore(e) {
    this.setData({ inputScore: e.detail.value });
  },

  onCancelInput() {
    this.setData({ needInput: false });
  },

  onCustomInput(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },

  toggleCustom() {
    this.setData({ customVisible: !this.data.customVisible });
  },

  async createCustom() {
    if (this.data.customSubmitting) return;
    const name = this.data.customName.trim();
    const desc = this.data.customDesc.trim();
    const score = Number(this.data.customScore);
    if (!name || !desc || !score) {
      wx.showToast({ title: GENTLE_V1.cards.missing, icon: "none" });
      return;
    }
    if (score < 1 || score > 50) {
      wx.showToast({ title: GENTLE_V1.cards.scoreRange, icon: "none" });
      return;
    }
    const cardType = `custom_${Date.now()}`;
    this.setData({ customSubmitting: true, customVisible: false });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "appendEvent",
          spaceId: app.globalData.spaceId,
          kind: "card_activate",
          type: "create",
          cardType,
          text: JSON.stringify({ name, desc }),
          score,
        },
      });
      const r = res.result || {};
      if (!r.success) {
        this.setData({ customVisible: true });
        wx.showToast({ title: r.msg || GENTLE_V1.cards.retry, icon: "none" });
        return;
      }
      this.setData({ customName: "", customDesc: "", customScore: "" });
      wx.showToast({ title: GENTLE_V1.cards.saved, icon: "success" });
      await this.loadCards();
    } catch (e) {
      this.setData({ customVisible: true });
      wx.showToast({ title: GENTLE_V1.cards.retry, icon: "none" });
    } finally {
      this.setData({ customSubmitting: false });
    }
  },

  async createCustomRequest() {
    if (this.data.customSubmitting) return;
    const name = this.data.customName.trim();
    const desc = this.data.customDesc.trim();
    const score = Number(this.data.customScore);
    if (!name || !desc || !score) {
      wx.showToast({ title: GENTLE_V1.cards.missing, icon: "none" });
      return;
    }
    if (score < 1 || score > 50) {
      wx.showToast({ title: GENTLE_V1.cards.scoreRange, icon: "none" });
      return;
    }
    const cardType = `custom_${Date.now()}`;
    this.setData({ customSubmitting: true, customVisible: false });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "appendEvent",
          spaceId: app.globalData.spaceId,
          kind: "card_activate",
          type: "request",
          cardType,
          text: JSON.stringify({ name, desc }),
          score,
        },
      });
      const r = res.result || {};
      if (!r.success) {
        this.setData({ customVisible: true });
        wx.showToast({ title: r.msg || GENTLE_V1.cards.retry, icon: "none" });
        return;
      }
      this.setData({ customName: "", customDesc: "", customScore: "" });
      wx.showToast({ title: GENTLE_V1.cards.sent, icon: "success" });
      await this.loadCards();
    } catch (e) {
      this.setData({ customVisible: true });
      wx.showToast({ title: GENTLE_V1.cards.retry, icon: "none" });
    } finally {
      this.setData({ customSubmitting: false });
    }
  },

  async onSubmitInput() {
    if (this.data.cardSubmitting) return;
    const { inputCard, inputScore } = this.data;
    if (!inputScore) {
      wx.showToast({ title: GENTLE_V1.cards.fillScore, icon: "none" });
      return;
    }
    this.setData({ needInput: false });
    const ok = await this.submit(inputCard, inputCard.indexOf("custom_") === 0 ? "request" : "offer", Number(inputScore));
    if (!ok) this.setData({ needInput: true });
  },

  isLoading: false,

  async submit(card, type, score) {
    if (this.isLoading || this.data.cardSubmitting) return false;
    this.isLoading = true;
    this.setData({ cardSubmitting: true });
    const data = {
      action: "appendEvent",
      spaceId: app.globalData.spaceId,
      kind: "card_activate",
      cardType: card,
      type: type === "offer" ? "initiate" : type,
    };
    if (score !== "" && score !== null) data.score = score;
    try {
      const res = await wx.cloud.callFunction({ name: "loveApi", data });
      const r = res.result || {};
      if (r.success) {
        await this.loadCards();
        return true;
      }
      wx.showToast({ title: GENTLE_V1.cards.retry, icon: "none" });
      return false;
    } catch (e) {
      wx.showToast({ title: GENTLE_V1.cards.retry, icon: "none" });
      return false;
    } finally {
      this.isLoading = false;
      this.setData({ cardSubmitting: false });
    }
  },
});
