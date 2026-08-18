const { GENTLE_V1, COPY_PACKS } = require("./utils/copy");

const mergeCopy = (base, override) => {
  if (!override || typeof override !== "object") return base;
  const result = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  Object.keys(override).forEach((key) => {
    const value = override[key];
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeCopy(result[key] || {}, value)
      : value;
  });
  return result;
};

App({
  onLaunch: function () {
    if (!wx.cloud) {
      return;
    }
    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });
  },
  globalData: {
    // 公开仓库占位值；部署者需在本地替换为自己的云环境 ID。
    env: "YOUR_CLOUD_ENV_ID",
    spaceId: "",
    role: "",
    openid: "",
    space: null,
    copyPackId: "gentle_v1",
  },
  getCopy: function () {
    const id = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
    this.globalData.copyPackId = id;
    if (id === "imported_v1") {
      const imported = wx.getStorageSync("ting_copy_pack_imported");
      if (imported && typeof imported === "object") return mergeCopy(GENTLE_V1, imported);
    }
    // 内置语气也走同一层回退，未来删减字段时不会出现页面空白。
    return mergeCopy(GENTLE_V1, COPY_PACKS[id] || GENTLE_V1);
  },
  getCopyOptions: function () {
    const options = [
      { id: "gentle_v1", name: "温柔", desc: "更有陪伴感的记录方式" },
      { id: "calm_v1", name: "冷静", desc: "更清晰克制的记录方式" },
    ];
    const imported = wx.getStorageSync("ting_copy_pack_imported");
    if (imported && imported.name) options.push({ id: "imported_v1", name: imported.name, desc: "从恢复入口导入的本机语气" });
    return options;
  },
  setCopyPack: function (id) {
    if (id && typeof id === "object") {
      wx.setStorageSync("ting_copy_pack_imported", id);
      wx.setStorageSync("ting_copy_pack_id", "imported_v1");
      this.globalData.copyPackId = "imported_v1";
      return true;
    }
    if (id === "imported_v1" && wx.getStorageSync("ting_copy_pack_imported")) {
      wx.setStorageSync("ting_copy_pack_id", id);
      this.globalData.copyPackId = id;
      return true;
    }
    if (!COPY_PACKS[id]) return false;
    wx.setStorageSync("ting_copy_pack_id", id);
    this.globalData.copyPackId = id;
    return true;
  },
  getThemeClass: function (role) {
    const currentRole = role || this.globalData.role;
    const key = wx.getStorageSync(`ting_theme_${currentRole}`);
    const allowed = currentRole === "guide"
      ? ["theme-guide", "theme-guide-forest", "theme-guide-umber"]
      : ["theme-respond", "theme-respond-lilac", "theme-respond-apricot"];
    return allowed.indexOf(key) >= 0 ? key : (currentRole === "guide" ? "theme-guide" : "theme-respond");
  },
  getThemeOptions: function (role) {
    return role === "guide"
      ? [
          { key: "theme-guide", name: "Anchor · Slate" },
          { key: "theme-guide-forest", name: "Tide · Forest" },
          { key: "theme-guide-umber", name: "Hearth · Umber" },
        ]
      : [
          { key: "theme-respond", name: "Kitten · Warm" },
          { key: "theme-respond-lilac", name: "Puppy · Lilac" },
          { key: "theme-respond-apricot", name: "Petal · Apricot" },
        ];
  },
  applyThemeChrome: function (role) {
    const theme = this.getThemeClass(role);
    const colors = {
      "theme-guide": { nav: "#D7E0E8", bg: "#F2F4F7", tab: "#8793A2", accent: "#52687D", card: "#FFFFFF" },
      "theme-guide-forest": { nav: "#D7E5DC", bg: "#F1F5F2", tab: "#879991", accent: "#668878", card: "#FFFFFF" },
      "theme-guide-umber": { nav: "#EADBD1", bg: "#F6F3F0", tab: "#9A8780", accent: "#A87868", card: "#FFFFFF" },
      "theme-respond-lilac": { nav: "#EADCF0", bg: "#FAF7FB", tab: "#9B8AA1", accent: "#B981C0", card: "#FFFFFF" },
      "theme-respond-apricot": { nav: "#F5DFCC", bg: "#FFF8F1", tab: "#A28C7E", accent: "#D9955F", card: "#FFFFFF" },
      "theme-respond": { nav: "#FFD7DD", bg: "#FFF7F3", tab: "#9B858B", accent: "#E46784", card: "#FFFFFF" },
    };
    const current = colors[theme] || colors["theme-respond"];
    wx.setNavigationBarColor({
      frontColor: "#000000",
      backgroundColor: current.nav,
    });
    wx.setBackgroundColor({
      backgroundColor: current.bg,
      backgroundColorTop: current.bg,
      backgroundColorBottom: current.bg,
    });
    wx.setTabBarStyle({
      color: current.tab || "#9b858b",
      selectedColor: current.accent || "#e46784",
      backgroundColor: current.card || "#ffffff",
      borderStyle: "black",
    });
  },
  restore: function () {
    const app = this;
    return wx.cloud
      .callFunction({
        name: "loveApi",
        data: { action: "restore" },
      })
      .then((res) => {
        const r = res.result || {};
        if (r.openid) app.globalData.openid = r.openid;
        if (r.success && r.backup && r.space) {
          app.globalData.spaceId = r.space._id;
          app.globalData.role = r.role;
          app.globalData.openid = r.openid;
          app.globalData.space = r.space;
          app.applyThemeChrome(r.role);
          return { ok: false, hasSpace: false, backup: true };
        }
        if (r.success && r.hasSpace) {
          app.globalData.spaceId = r.space._id;
          app.globalData.role = r.role;
          app.globalData.openid = r.openid;
          app.globalData.space = r.space;
          app.applyThemeChrome(r.role);
          return { ok: true, hasSpace: true };
        }
        app.globalData.spaceId = "";
        app.globalData.role = "";
        app.globalData.space = null;
        return { ok: false, hasSpace: false };
      })
      .catch(() => ({ ok: false }));
  },
});
