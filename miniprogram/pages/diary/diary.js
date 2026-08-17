const app = getApp();
let GENTLE_V1 = app.getCopy();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

Page({
  data: {
    myEntries: [],
    oppositeEntries: [],
    input: "",
    mySectionTitle: "",
    oppositeSectionTitle: "",
    myEmptyText: "",
    oppositeEmptyText: "",
    themeClass: "",
    copy: app.getCopy(),
    replyMood: false,
    replyMoodTags: [],
    replyMoodEventId: "",
  },

  onLoad(options) {
    if (options && options.mode === "replyMood" && options.moodEventId) {
      this.setData({ replyMood: true, replyMoodEventId: options.moodEventId });
    }
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ themeClass: app.getThemeClass(app.globalData.role) });
    const cache = wx.getStorageSync("ting_diary_cache_" + app.globalData.spaceId);
    const copyPackId = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
    if (cache && cache.cacheVersion === 1 && cache.copyPackId === copyPackId && cache.role === app.globalData.role && cache.dateKey === new Date().toISOString().slice(0, 10)) {
      this.setData({ myEntries: cache.myEntries || [], oppositeEntries: cache.oppositeEntries || [], mySectionTitle: cache.mySectionTitle || "", oppositeSectionTitle: cache.oppositeSectionTitle || "", myEmptyText: cache.myEmptyText || "", oppositeEmptyText: cache.oppositeEmptyText || "" });
    }
    this.loadDiary();
  },

  async loadDiary() {
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

    const today = startOfToday();
    const myRole = app.globalData.role;
    const oppositeRole = myRole === "guide" ? "respond" : "guide";

    const space = app.globalData.space;
    const nicknames = (space && space.nicknames) || {};
    const roles = (space && space.roles) || {};
    const nicknameByRole = {};
    Object.keys(roles).forEach((openid) => {
      nicknameByRole[roles[openid]] = nicknames[openid] || "";
    });
    const oppositeNickname = nicknameByRole[oppositeRole] || "TA";

    const todayEntries = (r.events || [])
      .filter((e) => e.type === "journal" && e.createdAt >= today)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const buildEntry = (e) => ({
      text: e.text,
      time: this.formatTime(e.createdAt),
    });

    const myEntries = todayEntries.filter((e) => e.actor === myRole).map(buildEntry);
    const oppositeEntries = todayEntries.filter((e) => e.actor === oppositeRole).map(buildEntry);

    const isRespond = myRole === "respond";

    this.setData({
      myEntries,
      oppositeEntries,
      mySectionTitle: isRespond ? "我的今天" : "我今天的回应",
      oppositeSectionTitle: isRespond ? `${oppositeNickname} 的回应` : `${oppositeNickname} 今天写了什么`,
      myEmptyText: "今天还没写下此刻",
      oppositeEmptyText: `${oppositeNickname} 今天还没留下只言片语`,
    });
    wx.setStorageSync("ting_diary_cache_" + app.globalData.spaceId, {
      cacheVersion: 1,
      copyPackId: wx.getStorageSync("ting_copy_pack_id") || "gentle_v1",
      role: myRole,
      dateKey: new Date().toISOString().slice(0, 10),
      myEntries,
      oppositeEntries,
      mySectionTitle: isRespond ? "我的今天" : "我今天的回应",
      oppositeSectionTitle: isRespond ? `${oppositeNickname} 的回应` : `${oppositeNickname} 今天写了什么`,
      myEmptyText: "今天还没写下此刻",
      oppositeEmptyText: `${oppositeNickname} 今天还没留下只言片语`,
    });
    if (this.data.replyMood && this.data.replyMoodEventId) {
      const mood = (r.events || []).find((e) => e._id === this.data.replyMoodEventId && e.type === "mood");
      this.setData({ replyMoodTags: mood && mood.moodTags ? mood.moodTags : [] });
    }
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async onSubmit() {
    const text = this.data.input;
    if (!text) {
      wx.showToast({ title: "先写一句话", icon: "none" });
      return;
    }
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "appendEvent",
        spaceId: app.globalData.spaceId,
        kind: "none",
        type: "journal",
        text,
        threadId: this.data.replyMood ? `mood_${this.data.replyMoodEventId}` : "",
        moodTags: this.data.replyMood ? this.data.replyMoodTags : [],
      },
    });
    const r = res.result || {};
    if (r.success) {
      this.setData({ input: "" });
      this.loadDiary();
    } else {
      wx.showToast({ title: GENTLE_V1.errors.retry, icon: "none" });
    }
  },

  formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
});
