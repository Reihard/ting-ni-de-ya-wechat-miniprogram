const app = getApp();
let GENTLE_V1 = app.getCopy();
const { version } = require("../../config/app-meta");

Page({
  data: {
    version,
    score: 0,
    role: "",
    themeClass: "",
    copy: app.getCopy(),
    themeName: "",
    copyPackName: "",
    themeOptions: [],
    copyOptions: [],
    themePickerVisible: false,
    copyPickerVisible: false,
    hasImportedCopy: false,
    versionMenuVisible: false,
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    this.setData({
      copy: app.getCopy(),
      copyPackName: app.getCopy().name,
      themeOptions: app.getThemeOptions(app.globalData.role),
      copyOptions: app.getCopyOptions(),
      hasImportedCopy: !!wx.getStorageSync("ting_copy_pack_imported"),
    });
    app.restore().then((r) => {
      if (!r.ok) return;
      const space = app.globalData.space;
      this.setData({
        score: space.score || 0,
        role: app.globalData.role,
        themeClass: app.getThemeClass(app.globalData.role),
        themeName: (app.getThemeOptions(app.globalData.role).find((item) => item.key === app.getThemeClass(app.globalData.role)) || {}).name || (app.globalData.role === "guide" ? "Anchor · Slate" : "Kitten · Warm"),
        copyPackName: app.getCopy().name,
        themeOptions: app.getThemeOptions(app.globalData.role),
        copyOptions: app.getCopyOptions(),
      });
      app.applyThemeChrome(app.globalData.role);
    });
  },

  onVersionTap() {
    if (!this._track5Tap()) return;
    this.setData({ versionMenuVisible: true });
  },

  chooseVersionAction(e) {
    const action = e.currentTarget.dataset.action;
    this.setData({ versionMenuVisible: false });
    if (action === "backup") {
      wx.navigateTo({ url: "/pages/memories/memories" });
    } else if (action === "disband") {
      wx.navigateTo({ url: "/pages/memories/memories?mode=disband" });
    }
  },

  _track5Tap() {
    const now = Date.now();
    if (!this._tapWindow) this._tapWindow = [];
    this._tapWindow.push(now);
    while (this._tapWindow.length && now - this._tapWindow[0] > 3000) {
      this._tapWindow.shift();
    }
    if (this._tapWindow.length >= 5) {
      this._tapWindow = [];
      return true;
    }
    return false;
  },

  goLedger() {
    wx.navigateTo({ url: "/pages/ledger/ledger" });
  },

  goAnniversary() {
    wx.navigateTo({ url: "/pages/anniversary/anniversary" });
  },

  goCards() {
    wx.navigateTo({ url: "/pages/cards/cards" });
  },

  goMemories() {
    wx.navigateTo({ url: "/pages/memories/memories" });
  },

  onThemeTap() {
    this.setData({ themePickerVisible: !this.data.themePickerVisible, copyPickerVisible: false });
  },

  onCopyTap() {
    this.setData({ copyPickerVisible: !this.data.copyPickerVisible, themePickerVisible: false });
  },

  selectTheme(e) {
    const selected = this.data.themeOptions[e.currentTarget.dataset.index];
    if (!selected) return;
    wx.setStorageSync("ting_theme_" + this.data.role, selected.key);
    this.setData({ themeClass: selected.key, themeName: selected.name, themePickerVisible: false });
    app.applyThemeChrome(this.data.role);
    wx.showToast({ title: "主题已切换", icon: "success" });
  },

  selectCopy(e) {
    const selected = this.data.copyOptions[e.currentTarget.dataset.index];
    if (!selected || !app.setCopyPack(selected.id)) return;
    this.setData({ copy: app.getCopy(), copyPackName: selected.name, copyPickerVisible: false });
    wx.showToast({ title: "已使用" + selected.name, icon: "success" });
  },

  restoreGentle() {
    if (!app.setCopyPack("gentle_v1")) return;
    this.setData({ copy: app.getCopy(), copyPackName: app.getCopy().name, copyPickerVisible: false });
    wx.showToast({ title: this.data.copy.profile.restoreGentle, icon: "success" });
  },

});
