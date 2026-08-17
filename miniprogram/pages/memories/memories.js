const app = getApp();
const pako = require("../../libs/pako.min.js");
let GENTLE_V1 = app.getCopy();

const BACKUP_HEADER = "TING_MEMORIES_BACKUP_V1";

const validateCopyPack = (pack) => {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return { ok: false, msg: "语气包格式无效" };
  if (typeof pack.id !== "string" || !pack.id.trim()) return { ok: false, msg: "语气包缺少 id" };
  if (typeof pack.name !== "string" || !pack.name.trim()) return { ok: false, msg: "语气包缺少名称" };
  if (pack.schemaVersion !== 1) return { ok: false, msg: "语气包版本不支持" };
  let invalid = "";
  const walk = (value, key) => {
    if (invalid) return;
    if (typeof value === "string") {
      if (!value.trim() && key !== "empty") invalid = `${key || "文案"}不能为空`;
      else if (value.length > 1000) invalid = `${key || "文案"}过长`;
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
    else if (value && typeof value === "object") Object.keys(value).forEach((child) => walk(value[child], child));
  };
  walk(pack, "文案");
  return invalid ? { ok: false, msg: invalid } : { ok: true };
};

const textToBytes = (text) => {
  const binary = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const bytesToText = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(binary));
};

const bytesToBase64 = (bytes) => wx.arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const packBackup = (payload) => {
  const compressed = pako.gzip(textToBytes(JSON.stringify(payload)));
  const data = bytesToBase64(compressed);
  return {
    header: BACKUP_HEADER,
    version: 1,
    spaceId: payload.space && payload.space._id,
    exportedAt: new Date().toISOString(),
    sizeKB: Math.ceil(data.length / 1024),
    data,
  };
};

const unpackBackup = (text) => {
  try {
    const envelope = JSON.parse(text);
    if (envelope && envelope.type === "copy_pack" && envelope.copyPack && typeof envelope.copyPack === "object") {
      return { envelope: { exportedAt: new Date().toISOString(), sizeKB: Math.ceil(text.length / 1024) }, payload: envelope };
    }
    if (!envelope || envelope.header !== BACKUP_HEADER || envelope.version !== 1 || typeof envelope.data !== "string") return null;
    const json = bytesToText(pako.ungzip(wx.base64ToArrayBuffer(envelope.data)));
    const payload = JSON.parse(json);
    if (payload && payload.type === "copy_pack" && payload.copyPack && typeof payload.copyPack === "object") {
      return { envelope, payload };
    }
    if (!payload || !payload.space || !Array.isArray(payload.events)) return null;
    return { envelope, payload };
  } catch (e) {
    return null;
  }
};

Page({
  data: {
    exporting: false,
    importing: false,
    copied: false,
    exportSize: "",
    manualVisible: false,
    manualText: "",
    importPreview: null,
    disbandMode: false,
    backupMode: false,
    spaceName: "",
    backupUntilText: "",
    disbandName: "",
    canDisband: false,
    importTargetExisting: false,
    themeClass: "",
    copy: app.getCopy(),
  },

  onLoad(options) {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ themeClass: app.getThemeClass(app.globalData.role) });
    if (options && options.mode === "disband") {
      this.setData({ disbandMode: true });
      app.restore().then((restored) => {
        if (restored.ok && app.globalData.space) {
          this.setData({ spaceName: app.globalData.space.spaceName || "" });
        }
      });
    } else if (options && options.mode === "backup") {
      this.setData({ backupMode: true });
      app.restore().then((restored) => {
        if (restored.backup && app.globalData.space) {
          const until = app.globalData.space.backupUntil;
          this.setData({
            spaceName: app.globalData.space.spaceName || "",
            backupUntilText: until ? new Date(until).toLocaleString() : "",
          });
        }
      });
    }
  },

  async onExport() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    try {
      const restored = await app.restore();
      if ((!restored.ok && !restored.backup) || !app.globalData.spaceId) {
        wx.showToast({ title: "还没有空间", icon: "none" });
        return;
      }
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "queryEvents",
          spaceId: app.globalData.spaceId,
          limit: 1000,
        },
      });
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || GENTLE_V1.cards.retry, icon: "none" });
        return;
      }
      const payload = {
        space: app.globalData.space,
        events: result.events || [],
      };
      const packed = packBackup(payload);
      const backup = JSON.stringify(packed);
      const confirm = await new Promise((resolve) => {
        wx.showModal({
          title: GENTLE_V1.memories.backupGenerateTitle,
          content: GENTLE_V1.memories.backupGenerateText.replace("{sizeKB}", packed.sizeKB),
          confirmText: GENTLE_V1.memories.copy,
          cancelText: GENTLE_V1.memories.noCopy,
          success: resolve,
          fail: () => resolve({ confirm: false }),
        });
      });
      if (!confirm.confirm) return;
      await wx.setClipboardData({ data: backup });
      this.setData({ copied: true, exportSize: `${packed.sizeKB} KB` });
      wx.showToast({ title: GENTLE_V1.memories.copied, icon: "success" });
    } catch (e) {
      wx.showToast({ title: GENTLE_V1.cards.retry, icon: "none" });
    } finally {
      this.setData({ exporting: false });
    }
  },

  async onImport() {
    if (this.data.importing) return;
    const restored = await app.restore();
    this.setData({ importTargetExisting: !!restored.ok });
    this.setData({ importing: true });
    try {
      const clip = await wx.getClipboardData();
      const parsed = clip.data && unpackBackup(clip.data.trim());
      if (!parsed) {
        this.setData({ manualVisible: true });
        wx.showToast({ title: GENTLE_V1.memories.noBackup, icon: "none" });
        return;
      }
      if (parsed.payload.type === "copy_pack") {
        const checked = validateCopyPack(parsed.payload.copyPack);
        if (!checked.ok) {
          wx.showToast({ title: checked.msg, icon: "none" });
          return;
        }
      }
      this.setData({
        importPreview: {
          type: parsed.payload.type || "space_data",
          copyName: parsed.payload.copyPack && parsed.payload.copyPack.name || "",
          copyVocabulary: parsed.payload.copyPack && parsed.payload.copyPack.vocabulary && parsed.payload.copyPack.vocabulary.promise || "",
          copyHomeTitle: parsed.payload.copyPack && parsed.payload.copyPack.home && (parsed.payload.copyPack.home.todayTitle || parsed.payload.copyPack.home.newPromise) || "",
          copyAction: parsed.payload.copyPack && parsed.payload.copyPack.actions && parsed.payload.copyPack.actions.promise && parsed.payload.copyPack.actions.promise.accept || "",
          spaceName: parsed.payload.space && parsed.payload.space.spaceName || "",
          exportedAt: parsed.envelope.exportedAt || "",
          eventCount: parsed.payload.events ? parsed.payload.events.length : 0,
          sizeKB: parsed.envelope.sizeKB || Math.ceil(clip.data.length / 1024),
        },
        importData: clip.data.trim(),
        importCopyPack: parsed.payload.copyPack || null,
        manualVisible: false,
      });
    } catch (e) {
      wx.showToast({ title: GENTLE_V1.memories.readFail, icon: "none" });
    } finally {
      this.setData({ importing: false });
    }
  },

  onManualInput(e) {
    this.setData({ manualText: e.detail.value });
  },

  onDisbandInput(e) {
    const disbandName = e.detail.value;
    this.setData({ disbandName, canDisband: !!this.data.spaceName && disbandName === this.data.spaceName });
  },

  async confirmDisband() {
    if (!this.data.canDisband) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: GENTLE_V1.memories.finalConfirm,
        content: GENTLE_V1.memories.disbandConfirmText,
        confirmText: GENTLE_V1.memories.confirmDisband,
        cancelText: GENTLE_V1.memories.stay,
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!confirm.confirm) return;
    this.setData({ importing: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: { action: "disbandSpace", spaceId: app.globalData.spaceId, spaceName: this.data.disbandName },
      });
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || "解除失败，请重试", icon: "none" });
        return;
      }
      wx.showToast({ title: "这个空间已经解除", icon: "none" });
      setTimeout(() => wx.reLaunch({ url: "/pages/pair/pair" }), 700);
    } catch (e) {
      wx.showToast({ title: "解除失败，请重试", icon: "none" });
    } finally {
      this.setData({ importing: false });
    }
  },

  async deleteBackup() {
    if (this.data.importing || !app.globalData.spaceId) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: GENTLE_V1.memories.deleteTitle,
        content: GENTLE_V1.memories.deleteText,
        confirmText: GENTLE_V1.memories.confirmDelete,
        cancelText: GENTLE_V1.memories.noDelete,
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!confirm.confirm) return;
    this.setData({ importing: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: { action: "disbandSpace", spaceId: app.globalData.spaceId, spaceName: this.data.spaceName },
      });
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || "删除失败，请重试", icon: "none" });
        return;
      }
      wx.showToast({ title: GENTLE_V1.memories.deleted, icon: "success" });
      setTimeout(() => wx.reLaunch({ url: "/pages/pair/pair" }), 700);
    } catch (e) {
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
    } finally {
      this.setData({ importing: false });
    }
  },

  parseManual() {
    const text = (this.data.manualText || "").trim();
    const parsed = unpackBackup(text);
    if (!parsed) {
      wx.showToast({ title: GENTLE_V1.memories.invalid, icon: "none" });
      return;
    }
    if (parsed.payload.type === "copy_pack") {
      const checked = validateCopyPack(parsed.payload.copyPack);
      if (!checked.ok) {
        wx.showToast({ title: checked.msg, icon: "none" });
        return;
      }
    }
    this.setData({
      importPreview: {
        type: parsed.payload.type || "space_data",
        copyName: parsed.payload.copyPack && parsed.payload.copyPack.name || "",
        copyVocabulary: parsed.payload.copyPack && parsed.payload.copyPack.vocabulary && parsed.payload.copyPack.vocabulary.promise || "",
        copyHomeTitle: parsed.payload.copyPack && parsed.payload.copyPack.home && (parsed.payload.copyPack.home.todayTitle || parsed.payload.copyPack.home.newPromise) || "",
        copyAction: parsed.payload.copyPack && parsed.payload.copyPack.actions && parsed.payload.copyPack.actions.promise && parsed.payload.copyPack.actions.promise.accept || "",
        spaceName: parsed.payload.space && parsed.payload.space.spaceName || "",
        exportedAt: parsed.envelope.exportedAt || "",
        eventCount: parsed.payload.events ? parsed.payload.events.length : 0,
        sizeKB: parsed.envelope.sizeKB || Math.ceil(text.length / 1024),
      },
      importData: text,
      importCopyPack: parsed.payload.copyPack || null,
      importTargetExisting: !!app.globalData.spaceId,
      manualVisible: false,
      manualText: "",
    });
  },

  confirmCopyImport() {
    const copyPack = this.data.importCopyPack;
    if (!copyPack) {
      wx.showToast({ title: "没有找到语气内容", icon: "none" });
      return;
    }
    const checked = validateCopyPack(copyPack);
    if (!checked.ok) {
      wx.showToast({ title: checked.msg, icon: "none" });
      return;
    }
    if (!app.setCopyPack(copyPack)) {
      wx.showToast({ title: "语气导入失败", icon: "none" });
      return;
    }
    wx.showToast({ title: "语气已导入", icon: "success" });
    setTimeout(() => wx.reLaunch({ url: "/pages/index/index" }), 700);
  },

  async confirmImport() {
    const backup = this.data.importData;
    if (!backup) return;
    // 语气包只保存在本机，绝不能进入空间备份恢复接口。
    if (this.data.importPreview && this.data.importPreview.type === "copy_pack") {
      this.confirmCopyImport();
      return;
    }
    const hasCurrentSpace = this.data.importTargetExisting || !!app.globalData.spaceId;
    const confirm = await new Promise((resolve) => {
        wx.showModal({
          title: GENTLE_V1.memories.confirmRestore,
          content: hasCurrentSpace
            ? `备份空间：${this.data.importPreview.spaceName || "未知空间"}\n备份大小：${this.data.importPreview.sizeKB} KB\n\n将合并到当前空间，已有记录会保留，重复记录不会再次导入。`
            : `备份空间：${this.data.importPreview.spaceName || "未知空间"}\n备份大小：${this.data.importPreview.sizeKB} KB\n\n将恢复这份空间备份，确定要继续吗？`,
          confirmText: "确认导入",
          cancelText: "先不恢复",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        });
    });
    if (!confirm.confirm) return;
    this.setData({ importing: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "loveApi",
        data: { action: "importData", backup },
      });
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || GENTLE_V1.memories.restoreFail, icon: "none" });
        return;
      }
      wx.showToast({ title: GENTLE_V1.memories.recovered, icon: "success" });
      setTimeout(() => wx.reLaunch({ url: "/pages/index/index" }), 700);
    } catch (e) {
      wx.showToast({ title: GENTLE_V1.memories.restoreFail, icon: "none" });
    } finally {
      this.setData({ importing: false });
    }
  },

  cancelImport() {
    this.setData({ importPreview: null, importData: null, importCopyPack: null, manualVisible: false, manualText: "" });
  },

  cancelDisband() {
    wx.navigateBack();
  },
});
