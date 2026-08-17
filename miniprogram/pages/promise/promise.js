const app = getApp();
let GENTLE_V1 = app.getCopy();

Page({
  data: {
    title: "",
    description: "",
    way: "文字约定",
    score: "10",
    submitting: false,
    themeClass: "",
    copy: app.getCopy(),
  },

  onLoad() {
    GENTLE_V1 = app.getCopy();
    this.setData({ themeClass: app.getThemeClass(app.globalData.role) });
    app.applyThemeChrome(app.globalData.role);
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  selectWay(e) {
    const way = e.detail.value;
    this.setData({ way });
  },

  onScoreInput(e) {
    const raw = e.detail.value;
    if (raw === "") {
      this.setData({ score: "" });   // 清空保持空，不当作 0，提交时由 !score 拦截
      return;
    }
    const score = Number(raw);
    if (score < 0 || score > 50) {
      wx.showToast({ title: GENTLE_V1.promise.scoreRange, icon: "none" });
      return;
    }
    this.setData({ score: raw });
  },

  async onSubmit() {
    if (this.data.submitting) return;  // 防重复
    const { title, description, way, score } = this.data;
    if (!title || !way || !score) {
      wx.showToast({ title: GENTLE_V1.errors.fill, icon: "none" });
      return;
    }
    this.setData({ submitting: true });  // 禁用按钮
    const text = JSON.stringify({ title, desc: description, way });
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: {
        action: "appendEvent",
        spaceId: app.globalData.spaceId,
        type: "initiate",
        text,
        score: Number(score),
      },
    });
    this.setData({ submitting: false });  // 恢复按钮
    const r = res.result || {};
    if (r.success) {
      wx.redirectTo({ url: `/pages/detail/detail?threadId=${r.threadId}` });
    } else {
      wx.showToast({ title: GENTLE_V1.errors.retry, icon: "none" });
    }
  },
});
