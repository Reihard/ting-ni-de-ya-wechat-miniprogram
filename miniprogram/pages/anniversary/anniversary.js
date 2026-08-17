const app = getApp();
let GENTLE_V1 = app.getCopy();

Page({
  data: {
    anniversaries: [],
    name: "",
    date: "",
    remindCycle: "year",
    showAdd: false,
    themeClass: "",
    copy: app.getCopy(),
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ themeClass: app.getThemeClass(app.globalData.role), copy: GENTLE_V1 });
    this.loadAnniversaries();
  },

  async loadAnniversaries() {
    const rr = await app.restore();
    if (!rr.ok) return;
    const space = app.globalData.space;
    const list = (space.anniversaries || []).slice();
    this._raw = list;
    this.setData({
      anniversaries: list.map((a) => this.withComputed(a)),
    });
  },

  withComputed(a) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = String(a.date).split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86400000);

    let next = new Date(today.getFullYear(), m - 1, d);
    if (next.getTime() < today.getTime()) {
      if (a.remindCycle === "month") {
        next = new Date(today.getFullYear(), today.getMonth() + 1, d);
      } else {
        next = new Date(today.getFullYear() + 1, m - 1, d);
      }
    }
    const daysToNext = Math.floor((next.getTime() - today.getTime()) / 86400000);

    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    const nextText = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())} · 还有 ${daysToNext} 天`;

    return {
      ...a,
      nextText: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())} · ${GENTLE_V1.anniversary.next.replace("{days}", daysToNext)}`,
      elapsedText: elapsedDays >= 0 ? GENTLE_V1.anniversary.elapsed.replace("{days}", elapsedDays) : "",
    };
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onCycleChange(e) {
    this.setData({ remindCycle: e.detail.value });
  },

  onToggleAdd() {
    this.setData({ showAdd: !this.data.showAdd });
  },

  async onAdd() {
    const { name, date, remindCycle } = this.data;
    if (!name || !date) {
      wx.showToast({ title: GENTLE_V1.anniversary.fill, icon: "none" });
      return;
    }
    const list = (this._raw || []).slice();
    list.push({ name, date, remindCycle });
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: { action: "updateSpace", spaceId: app.globalData.spaceId, anniversaries: list },
    });
    const r = res.result || {};
    if (r.success) {
      this.setData({ showAdd: false, name: "", date: "", remindCycle: "year" });
      this.loadAnniversaries();
    } else {
      wx.showToast({ title: GENTLE_V1.anniversary.retry, icon: "none" });
    }
  },

  async onDelete(e) {
    const idx = e.currentTarget.dataset.index;
    const list = (this._raw || []).slice();
    list.splice(idx, 1);
    const res = await wx.cloud.callFunction({
      name: "loveApi",
      data: { action: "updateSpace", spaceId: app.globalData.spaceId, anniversaries: list },
    });
    const r = res.result || {};
    if (r.success) {
      this.loadAnniversaries();
    } else {
      wx.showToast({ title: GENTLE_V1.anniversary.retry, icon: "none" });
    }
  },
});
