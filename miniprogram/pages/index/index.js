const app = getApp();
const { deriveState, deriveCapsuleBox, deriveCardState } = require("../../utils/state");
let GENTLE_V1 = app.getCopy();

const MOOD_TAGS = [
  "想躲进你怀里",
  "想听你说爱我",
  "想做你的挂件",
  "今天很乖，随时待命",
  "只想被你养着",
];

const MOOD_WAIT_MS = 3000;

const ONBOARDING_STEPS = (role) => [
  {
    title: "看看你们的空间",
    text: "这里会记下你们的约定、心意和日记。",
  },
  role === "guide"
    ? { title: GENTLE_V1.home.firstPromiseGuide, text: "从一件想和 TA 一起完成的小事开始。" }
    : { title: GENTLE_V1.home.firstPromiseRespond, text: "收到约定后，再一起商量怎么完成。" },
  {
    title: GENTLE_V1.home.firstAnniversary,
    text: "把你们想一起记住的日子放进来。",
  },
];

function parseTitle(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    parsed = null;
  }
  return parsed ? parsed.title : text;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

Page({
  data: {
    role: "",
    themeClass: "",
    ongoing: [],
    empty: true,
    spaceName: "",
    daysTogether: 0,
    overview: {
      pendingPromiseCount: 0,
      pendingCardCount: 0,
      todayJournalCount: 0,
      anniversaryCount: 0,
    },
    callout: { threadId: "", text: "" },
    otherNickname: "",
    hasMood: false,
    otherMoodTags: [],
    otherMoodEventId: "",
    moodEmptyText: "",
    otherDiaryText: { label: "", text: "" },
    moodTags: MOOD_TAGS,
    selectedMood: [],
    moodPublishing: false,
    showCustomMoodInput: false,
    customMoodText: "",
    annReminder: { shown: false, name: "", days: 0 },
    festivalReminder: { shown: false, texts: [] },
    pairingStatus: "", // solo / paired
    todayTraces: [],
    todayCardVisible: false,
    todayTitle: GENTLE_V1.home.todayTitle,
    onboardingVisible: false,
    onboardingStep: 0,
    onboardingTitle: "",
    onboardingText: "",
    onboardingLast: false,
    copy: app.getCopy(),
  },

  readHomeCache() {
    const active = wx.getStorageSync("ting_home_cache_active");
    if (!active || !active.spaceId) return null;
    const cache = wx.getStorageSync("ting_home_cache_" + active.spaceId);
    const copyPackId = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
    if (
      !cache ||
      cache.spaceId !== active.spaceId ||
      cache.cacheVersion !== 1 ||
      (cache.copyPackId && cache.copyPackId !== copyPackId) ||
      !cache.view
    ) return null;
    return cache;
  },

  hydrateHomeCache() {
    const cache = this.readHomeCache();
    if (!cache) return;
    this._cacheSpaceId = cache.spaceId;
    this._homeCacheMeta = {
      cacheVersion: cache.cacheVersion,
      lastEventAt: cache.lastEventAt || 0,
      copyPackId: cache.copyPackId || "gentle_v1",
    };
    this.setData(cache.view);
  },

  saveHomeCache(view, meta = {}) {
    const spaceId = app.globalData.spaceId;
    if (!spaceId || !view) return;
    const copyPackId = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
    const active = wx.getStorageSync("ting_home_cache_active");
    if (active && active.spaceId && active.spaceId !== spaceId) {
      wx.removeStorageSync("ting_home_cache_" + active.spaceId);
    }
    wx.setStorageSync("ting_home_cache_" + spaceId, {
      spaceId,
      cacheVersion: 1,
      cachedAt: Date.now(),
      view,
      lastEventAt: meta.lastEventAt || 0,
      copyPackId,
    });
    wx.setStorageSync("ting_home_cache_active", { spaceId });
  },

  onLoad() {
    GENTLE_V1 = app.getCopy();
    this.hydrateHomeCache();
    app.restore().then((r) => {
      if (r.backup) {
        wx.reLaunch({ url: "/pages/memories/memories?mode=backup" });
        return;
      }
      if (!r.ok) {
        const active = wx.getStorageSync("ting_home_cache_active");
        if (active && active.spaceId) wx.removeStorageSync("ting_home_cache_" + active.spaceId);
        wx.removeStorageSync("ting_home_cache_active");
        if (app.globalData.invite) {
          this.showInviteCard();
        } else {
          wx.reLaunch({ url: "/pages/pair/pair" });
        }
        return;
      }
      this.loadAll(r);
    });
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    this.setData({ copy: app.getCopy() });
    if (app.globalData.spaceId || app.globalData.invite) {
      this.loadAll();
    }
  },

  showInviteCard() {
    this.setData({ pairingStatus: "solo" });
  },

  async loadAll(restored) {
    const rr = restored || await app.restore();
    if (rr.backup) {
      wx.reLaunch({ url: "/pages/memories/memories?mode=backup" });
      return;
    }
    if (!rr.ok) {
      if (app.globalData.invite) this.showInviteCard();
      return;
    }
    const space = app.globalData.space;
    // 先同步角色，再计算 Hero / 未读 / 心情 / 日记，避免首次渲染短暂使用默认空角色。
    this.setData({
      role: app.globalData.role,
      themeClass: app.getThemeClass(app.globalData.role),
    });
    this.maybeShowOnboarding();
    if (space && space.pairingStatus === "paired") {
      app.globalData.invite = null;
    }
    const myUnread = space && space.unread ? space.unread[app.globalData.openid] || {} : {};

    let res;
    try {
      res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "queryEvents",
          spaceId: app.globalData.spaceId,
          limit: 100,
        },
      });
    } catch (err) {
      wx.showToast({ title: GENTLE_V1.errors.networkRetry, icon: "none" });
      return;
    }
    const r = res.result || {};
    if (!r.success || !r.events) {
      wx.showToast({ title: GENTLE_V1.errors.networkRetry, icon: "none" });
      return;
    }

    const events = r.events || [];
    const lastEventAt = events.reduce((latest, e) => Math.max(latest, e.createdAt || 0), 0);
    const byThread = {};
    events.forEach((e) => {
      // 随手记、心情和纪念日等自由事件不属于约定线程。
      // 回应心情时，随手记会带 mood_* threadId 用于关联原心情，不能因此被首页当成约定展示。
      const isFreeEvent = ["journal", "mood", "anniversaryGrant", "remember", "festivalGrant"].includes(e.type);
      if (!e.threadId || isFreeEvent) return;
      if (!byThread[e.threadId]) byThread[e.threadId] = [];
      byThread[e.threadId].push(e);
    });

    const pendingPromiseCount = Object.keys(byThread).filter((tid) => {
      if (tid.indexOf("card_") === 0) return false;
      const st = deriveState(byThread[tid]);
      return !st.terminal;
    }).length;

    const cardEvents = events.filter((e) => e.kind === "card_activate");
    const byCard = {};
    const cardTitles = {};
    cardEvents.forEach((e) => {
      if (!e.cardType) return;
      if (!byCard[e.cardType]) byCard[e.cardType] = [];
      byCard[e.cardType].push(e);
      if ((e.type === "create" || e.type === "request") && e.cardType.indexOf("custom_") === 0) {
        try {
          const parsed = JSON.parse(e.text || "{}");
          cardTitles[e.cardType] = parsed.name || e.cardType;
        } catch (err) {}
      }
    });
    const pendingCardCount = Object.keys(byCard).filter((card) => {
      const st = deriveCardState(byCard[card]);
      return st.state === "待回应" || st.state === "协商中";
    }).length;

    const today = startOfToday();
    const todayJournalCount = events.filter(
      (e) => e.type === "journal" && e.createdAt >= today
    ).length;
    const anniversaryCount = (space.anniversaries || []).length;

    let calloutThread = null;
    let calloutText = "";
    Object.keys(myUnread).forEach((tid) => {
      const evs = byThread[tid];
      if (!evs) return;
      const sorted = evs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const latestInitiate = sorted.slice().reverse().find((e) => e.type === "initiate") || sorted[0];
      const text = parseTitle(latestInitiate.text);
      const isCard = tid.indexOf("card_") === 0;
      let box;
      if (isCard) {
        const cs = deriveCardState(evs);
        const sortedCardEvents = evs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const latestCardEvent = sortedCardEvents[sortedCardEvents.length - 1];
        // 心意卡只有对方刚发起/还价时，才算当前用户需要处理的回音。
        const waitingForMe = latestCardEvent && (
          (this.data.role === "guide" && (latestCardEvent.type === "request" || latestCardEvent.type === "initiate")) ||
          (this.data.role === "respond" && latestCardEvent.type === "counter")
        );
        box = waitingForMe ? "待回应" : "新动态";
        const cardType = tid.replace("card_", "");
        const cardName = cardTitles[cardType] || cardType;
        if (box === "待回应") {
          calloutThread = tid;
          calloutText = cardName;
          return;
        }
      } else {
        box = deriveCapsuleBox(evs, this.data.role);
      }
      // 已完成 / 已取消的约定不再进入“有新的回音”，避免历史未读残留继续占位。
      const terminal = isCard ? deriveCardState(evs).terminal : deriveState(evs).terminal;
      if (terminal) return;
      if (box === "待回应") {
        calloutThread = tid;
        calloutText = text;
      }
    });

    const ongoing = [];
    Object.keys(byThread).forEach((tid) => {
      const evs = byThread[tid];
      const isCard = tid.indexOf("card_") === 0;
      let state = "";
      let text = "";
      if (isCard) {
        const cs = deriveCardState(evs);
        if (cs.terminal) return;
        if (cs.state === "暂不启用" || cs.state === "已放弃") return;  // 首页不显示暂不启用/已放弃的卡
        state = cs.state;
        const cardType = tid.replace("card_", "");
        text = cardTitles[cardType] || cardType;
      } else {
        const st = deriveState(evs);
        if (st.terminal) return;
        state = st.state;
        const sorted = evs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const latest = sorted.slice().reverse().find((e) => e.type === "initiate") || sorted[0];
        text = parseTitle(latest.text) || "";
      }
      ongoing.push({ threadId: tid, text, state });
    });

    const todayTraces = events
      .filter((e) => e.createdAt >= today && (e.type === "journal" || e.type === "mood"))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 3)
      .map((e) => ({
        type: e.type,
        label: e.type === "mood" ? "今天的心情" : "今天的随手记",
        text: e.type === "mood" ? ((e.moodTags || []).join("、") || "留下了一份今天的心情") : (e.text || "记下了一笔此刻"),
      }));

    this.buildHero(events, space);
    this.checkReminders({ hasTraces: todayTraces.length > 0, hasCallout: !!calloutThread });

    const beginEvent = events.find((e) => e.type === "begin");
    const daysTogether = beginEvent
      ? Math.floor((Date.now() - new Date(beginEvent.text).getTime()) / 86400000) + 1
      : 0;

    this.setData({
      role: app.globalData.role,
      themeClass: app.getThemeClass(app.globalData.role),
      spaceName: space.spaceName || "",
      daysTogether,
      overview: { pendingPromiseCount, pendingCardCount, todayJournalCount, anniversaryCount },
      callout: { threadId: calloutThread || "", text: calloutText || "" },
      todayTraces,
      todayCardVisible: !!calloutThread,
      ongoing,
      empty: ongoing.length === 0,
      pairingStatus: (space && space.pairingStatus) || "",
    });

    this.saveHomeCache({
      role: app.globalData.role,
      themeClass: app.getThemeClass(app.globalData.role),
      spaceName: space.spaceName || "",
      daysTogether,
      overview: { pendingPromiseCount, pendingCardCount, todayJournalCount, anniversaryCount },
      callout: { threadId: calloutThread || "", text: calloutText || "" },
      todayTraces,
      todayCardVisible: !!calloutThread,
      ongoing,
      empty: ongoing.length === 0,
      pairingStatus: (space && space.pairingStatus) || "",
      otherNickname: this.data.otherNickname,
      hasMood: this.data.hasMood,
      otherMoodTags: this.data.otherMoodTags,
      otherMoodEventId: this.data.otherMoodEventId,
      moodEmptyText: this.data.moodEmptyText,
      otherDiaryText: this.data.otherDiaryText,
    }, { lastEventAt });
  },

  maybeShowOnboarding() {
    const spaceId = app.globalData.spaceId;
    if (!spaceId) return;
    const pending = wx.getStorageSync(`ting_onboarding_pending_${spaceId}`);
    const done = wx.getStorageSync(`ting_onboarding_done_${spaceId}`);
    if (!pending || done || this.data.onboardingVisible) return;
    const steps = ONBOARDING_STEPS(app.globalData.role);
    this.setData({
      onboardingVisible: true,
      onboardingStep: 0,
      onboardingTitle: steps[0].title,
      onboardingText: steps[0].text,
      onboardingLast: false,
    });
  },

  nextOnboarding() {
    const next = this.data.onboardingStep + 1;
    const steps = ONBOARDING_STEPS(app.globalData.role);
    if (next >= steps.length) {
      this.finishOnboarding();
      return;
    }
    this.setData({
      onboardingStep: next,
      onboardingTitle: steps[next].title,
      onboardingText: steps[next].text,
      onboardingLast: next === steps.length - 1,
    });
  },

  skipOnboarding() {
    this.finishOnboarding();
  },

  finishOnboarding() {
    const spaceId = app.globalData.spaceId;
    if (spaceId) {
      wx.setStorageSync(`ting_onboarding_done_${spaceId}`, true);
      wx.removeStorageSync(`ting_onboarding_pending_${spaceId}`);
    }
    this.setData({ onboardingVisible: false });
  },

  async checkReminders(options = {}) {
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: { action: "checkAnniversaries", spaceId: app.globalData.spaceId },
    });
    const r = res.result || {};
    if (!r.success) return;

    const ann = r.anniversaries && r.anniversaries[0];
    const annReminder = {
      shown: app.globalData.role === "guide" && !!ann,
      name: ann ? ann.name : "",
      days: ann ? ann.days : 0,
    };

    const festivalTexts = (r.festivals || []).map((f) =>
      f.name === "七夕"
        ? "七夕的小小心意｜今天是七夕。愿你们在忙碌里，也能留一点时间给彼此。已送上一份 52 分的节日心意，愿它陪你们把今天过得更温柔一些。"
        : "情人节的小心意｜今天想为你们留下一点甜。已点亮 52 分的节日心意，愿它变成一句问候、一段陪伴，或一个只属于今天的小仪式。"
    );
    const festivalReminder = { shown: festivalTexts.length > 0, texts: festivalTexts };

    (r.festivals || []).forEach((f) => {
      wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "appendEvent",
          spaceId: app.globalData.spaceId,
          type: "festivalGrant",
          text: f.name,
        },
      });
    });

    const hasReminder = annReminder.shown || festivalReminder.shown;
    const hasOtherToday = !!options.hasCallout;
    this.setData({
      annReminder,
      festivalReminder,
      todayCardVisible: hasReminder || hasOtherToday,
      todayTitle: GENTLE_V1.home.todayTitle,
    });
  },

  onTodayTraceTap(e) {
    if (e.currentTarget.dataset.type === "journal") {
      wx.navigateTo({ url: "/pages/diary/diary" });
      return;
    }
    wx.navigateTo({ url: "/pages/traces/traces" });
  },

  async onAnniversaryGrant() {
    const { name } = this.data.annReminder;
    if (!name) return;
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "appendEvent",
        spaceId: app.globalData.spaceId,
        type: "anniversaryGrant",
        text: name,
      },
    });
    const r = res.result || {};
    if (r.success) {
      this.setData({ annReminder: { shown: false, name: "", days: 0 } });
      wx.navigateTo({ url: "/pages/ledger/ledger" });
    } else {
      this.setData({ annReminder: { shown: false, name: "", days: 0 } });
    }
  },

  async onAnniversaryRemember() {
    const { name } = this.data.annReminder;
    if (!name) return;
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "appendEvent",
        spaceId: app.globalData.spaceId,
        type: "remember",
        text: name,
      },
    });
    const r = res.result || {};
    if (r.success) {
      this.setData({ annReminder: { shown: false, name: "", days: 0 } });
    }
  },

  buildHero(events, space) {
    const myRole = this.data.role;
    const otherOpenid = (space.members || []).find((m) => m !== app.globalData.openid);
    const otherNickname =
      (otherOpenid && space.nicknames && space.nicknames[otherOpenid]) || "";
    const otherRole = myRole === "guide" ? "respond" : "guide";
    const today = startOfToday();

    const todayJournals = events
      .filter((e) => e.type === "journal" && e.createdAt >= today)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const otherJournal = todayJournals.find((e) => e.actor === otherRole);

    const todayMoods = events
      .filter((e) => e.type === "mood" && e.createdAt >= today)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const otherMood = todayMoods.find((e) => e.actor === otherRole);

    const hasMood = myRole === "guide" && !!otherMood && !!(otherMood.moodTags && otherMood.moodTags.length);

    this.setData({
      otherNickname,
      otherDiaryText: otherJournal
        ? { label: `${otherNickname}今天写了`, text: otherJournal.text }
        : { label: "", text: "" },
      hasMood,
      otherMoodTags: hasMood ? otherMood.moodTags : [],
      otherMoodEventId: hasMood ? otherMood._id : "",
      moodEmptyText: `${otherNickname}还没有留下今天的状态`,
    });
  },

  onMoodTap(e) {
    const tag = e.currentTarget.dataset.tag;
    let selected = this.data.selectedMood.slice();
    const idx = selected.indexOf(tag);
    if (idx > -1) {
      selected.splice(idx, 1);
    } else {
      if (selected.length >= 3) {
        wx.showToast({ title: "最多选 3 个心情", icon: "none" });
        return;
      }
      selected.push(tag);
    }
    this.setData({ selectedMood: selected });
    this.scheduleMoodPublish();
  },

  toggleCustomMoodInput() {
    this.setData({ showCustomMoodInput: !this.data.showCustomMoodInput, customMoodText: "" });
  },

  onCustomMoodInput(e) {
    this.setData({ customMoodText: e.detail.value });
  },

  submitCustomMood() {
    const text = this.data.customMoodText.trim();
    if (!text) {
      wx.showToast({ title: "请输入心情", icon: "none" });
      return;
    }
    let selected = this.data.selectedMood.slice();
    if (selected.length >= 3) {
      wx.showToast({ title: "最多选 3 个心情", icon: "none" });
      return;
    }
    selected.push(text);
    this.setData({
      selectedMood: selected,
      moodTags: this.data.moodTags.concat([text]),  // 加到 moodTags，WXML 才会渲染
      showCustomMoodInput: false,
      customMoodText: "",
    });
    this.scheduleMoodPublish();
  },

  scheduleMoodPublish() {
    if (this.moodTimer) {
      clearTimeout(this.moodTimer);
      this.moodTimer = null;
    }
    if (!this.data.selectedMood.length) return;
    this.moodTimer = setTimeout(() => {
      this.moodTimer = null;
      this.publishMood();
    }, MOOD_WAIT_MS);
  },

  async publishMood() {
    if (this.data.moodPublishing) return;
    const selected = this.data.selectedMood;
    if (!selected.length) return;
    this.setData({ moodPublishing: true });
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "appendEvent",
        spaceId: app.globalData.spaceId,
        kind: "none",
        type: "mood",
        moodTags: selected,
      },
    });
    const r = res.result || {};
    if (!r.success) {
      wx.showToast({ title: GENTLE_V1.errors.retry, icon: "none" });
    }
    this.setData({ moodPublishing: false });
  },

  goDiary() {
    wx.navigateTo({ url: "/pages/diary/diary" });
  },

  replyMood() {
    if (this.data.role !== "guide" || !this.data.otherMoodEventId) return;
    wx.navigateTo({ url: `/pages/diary/diary?mode=replyMood&moodEventId=${this.data.otherMoodEventId}` });
  },

  async onTapCallout(e) {
    const tid = e.currentTarget.dataset.tid;
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: { action: "markRead", spaceId: app.globalData.spaceId, threadId: tid },
    });
    const r = res.result || {};
    if (r.success) {
      // 先更新当前页面，避免返回首页前仍看到已经点开的旧回音。
      const hasReminder = this.data.annReminder.shown || this.data.festivalReminder.shown;
      const nextView = Object.assign({}, this.data, {
        callout: { threadId: "", text: "" },
        todayCardVisible: hasReminder,
      });
      this.setData(nextView);
      this.saveHomeCache(nextView, this._homeCacheMeta || {});
    }
    if (tid.indexOf("card_") === 0) {
      wx.navigateTo({ url: `/pages/detail/detail?threadId=${tid}` });
      return;
    }
    wx.navigateTo({ url: `/pages/detail/detail?threadId=${tid}` });
  },

  goDetail(e) {
    const tid = e.currentTarget.dataset.tid;
    if (tid && tid.indexOf("card_") === 0) {
      wx.navigateTo({ url: `/pages/detail/detail?threadId=${tid}` });
      return;
    }
    wx.navigateTo({
      url: `/pages/detail/detail?threadId=${tid}`,
    });
  },

  goPromise() {
    wx.navigateTo({ url: "/pages/promise/promise" });
  },

  goCards() {
    wx.navigateTo({ url: "/pages/cards/cards" });
  },

  onGiveup() {
    wx.showModal({
      title: "放弃邀请？",
      content: "还没被接受，可以随时放弃。之后重新创建。",
      confirmText: "放弃",
      cancelText: "再想想",
      success: (res) => {
        if (!res.confirm) return;
        app.globalData.invite = null;
        wx.reLaunch({ url: "/pages/pair/pair" });
      },
    });
  },

  onUnload() {
    if (this.moodTimer) {
      clearTimeout(this.moodTimer);
      this.moodTimer = null;
    }
  },

  onShareAppMessage() {
    const inv = app.globalData.invite;
    if (inv) {
      const q = "code=" + inv.code +
        "&g=" + encodeURIComponent(inv.guideOpenid) +
        "&n=" + encodeURIComponent(inv.spaceName) +
        "&gn=" + encodeURIComponent(inv.guideName) +
        "&rn=" + encodeURIComponent(inv.respondName) +
        "&sd=" + encodeURIComponent(inv.startDate || "");
      return {
        title: "我把我们的空间建好了，就差你了。进来，把我们的故事记下来。",
        path: `/pages/pair/pair?${q}`,
      };
    }
    return { title: "开始你们的空间", path: "/pages/pair/pair" };
  },
});
