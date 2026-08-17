const app = getApp();
let GENTLE_V1 = app.getCopy();

Page({
  data: {
    role: "guide", // 默认引导方
    themeClass: "theme-guide",
    stage: "", // "" 或 "join"（分享进入）
    guideName: "",
    respondName: "",
    spaceName: "",
    spaceId: "",
    startDateMode: "today",
    startDate: "",
    todayDate: "",
    startDateText: "",
    copy: app.getCopy(),
  },

  async onLoad(options) {
    GENTLE_V1 = app.getCopy();
    this.setData({ themeClass: app.getThemeClass(this.data.role) });
    if (options && options.code) {
      const openid = app.globalData.openid;
      if (options.g === openid) {
        wx.showToast({ title: "不能接受自己的邀请", icon: "none" });
        return;
      }
      const rr = await app.restore();
      if (rr.backup) {
        wx.reLaunch({ url: "/pages/memories/memories?mode=backup" });
        return;
      }
      if (rr.ok && rr.hasSpace) {
        wx.switchTab({ url: "/pages/index/index" });   // 已结对，直接进首页
        return;
      }
      this.setData({
        stage: "join",
        spaceId: options.code,
        guideOpenid: options.g,
        guideName: decodeURIComponent(options.gn || ""),
        respondName: decodeURIComponent(options.rn || ""),
        spaceName: decodeURIComponent(options.n || ""),
        startDateText: decodeURIComponent(options.sd || ""),
      });
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    this.setData({ todayDate: todayStr, startDate: todayStr });
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role;
    this.setData({ role, themeClass: app.getThemeClass(role) });
    app.applyThemeChrome(role);
  },

  onSpaceNameInput(e) {
    this.setData({ spaceName: e.detail.value });
  },
  onGuideNameInput(e) {
    this.setData({ guideName: e.detail.value });
  },
  onRespondNameInput(e) {
    this.setData({ respondName: e.detail.value });
  },

  onStartDateModeChange(e) {
    this.setData({ startDateMode: e.detail.value });
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value });
  },

  onCreate() {
    const { spaceName, guideName, respondName } = this.data;
    if (!spaceName || !guideName || !respondName) {
      wx.showToast({ title: GENTLE_V1.errors.fill, icon: "none" });
      return;
    }
    wx.showModal({
      title: "最后确认一次",
      content: `空间：${spaceName}\n引导方称呼：${guideName}\n回应方称呼：${respondName}\n我们开始的时间：${this.data.startDate}\n\n⚠️ 分享给对方确认后才生效，确认前随时可以放弃`,
      confirmText: "生成邀请",
      cancelText: "再想想",
      success: async (res) => {
        if (!res.confirm) return;
        if (!app.globalData.openid) {
          await app.restore();
          if (!app.globalData.openid) {
            wx.showToast({ title: GENTLE_V1.errors.retry, icon: "none" });
            return;
          }
        }
        const code = await wx.cloud.callFunction({
          name: "loveApi",
          data: { action: "genInviteCode" },
        });
        const c = code.result || {};
        if (!c.success) {
      wx.showToast({ title: GENTLE_V1.errors.retry, icon: "none" });
          return;
        }
        app.globalData.invite = {
          code: c.code,
          spaceName,
          guideName,
          respondName,
          startDate: this.data.startDate,
          guideOpenid: app.globalData.openid,
        };
        wx.setStorageSync(`ting_onboarding_pending_${c.code}`, true);
        wx.switchTab({ url: "/pages/index/index" });
      }
    });
  },

  async onJoin() {
    const { spaceId, guideOpenid, guideName, respondName, spaceName, startDateText } = this.data;
    if (this._joining) return;
    this._joining = true;
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "joinSpace",
        code: spaceId,
        guideOpenid,
        spaceName,
        guideName,
        respondName,
        startDate: startDateText,
      },
    });
    const r = res.result || {};
    if (r.success) {
      app.globalData.spaceId = r.spaceId;
      app.globalData.role = r.role;
      app.globalData.invite = null;
      wx.setStorageSync(`ting_onboarding_pending_${r.spaceId}`, true);
      wx.switchTab({ url: "/pages/index/index" });
    } else {
      wx.showToast({ title: r.msg || GENTLE_V1.errors.retry, icon: "none" });
    }
    this._joining = false;
  },
});
