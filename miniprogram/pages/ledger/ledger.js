const app = getApp();
let GENTLE_V1 = app.getCopy();

const TYPE_LABEL = GENTLE_V1.ledger;

Page({
  data: {
    rows: [],
    themeClass: "",
    copy: app.getCopy(),
  },

  onShow() {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ themeClass: app.getThemeClass(app.globalData.role) });
    this.loadLedger();
  },

  async loadLedger() {
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

    const byThread = {};
    (r.events || []).forEach((e) => {
      if (!e.threadId) return;
      if (!byThread[e.threadId]) byThread[e.threadId] = [];
      byThread[e.threadId].push(e);
    });

    const rows = [];
    (r.events || []).forEach((e) => {
      let label = TYPE_LABEL[e.type];
      let amount = e.score;
      if (e.kind === "card_execute") {
        const executeEvents = byThread[e.threadId] || [];
        const initiate = executeEvents.find((x) => x.type === "initiate" && typeof x.score === "number");
        if (e.type === "initiate" && initiate) {
          label = TYPE_LABEL.redeem;
          amount = -Math.abs(initiate.score);
        } else if ((e.type === "pause" || e.type === "cancel") && initiate) {
          label = TYPE_LABEL.refund;
          amount = Math.abs(initiate.score);
        } else {
          return;
        }
      }
      if (!label || typeof amount !== "number") return;
      let title = "";
      if (e.type === "anniversaryGrant" || e.type === "festivalGrant") {
        title = e.text || "";
      } else if (e.kind === "card_execute") {
        title = e.text || "";
      } else {
        const sorted = (byThread[e.threadId] || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const latestInitiate = sorted.slice().reverse().find((x) => x.type === "initiate");
        if (latestInitiate) {
          try {
            title = JSON.parse(latestInitiate.text).title;
          } catch (err) {
            title = latestInitiate.text;
          }
        }
      }
      rows.push({
        label,
        title: title || "",
        amount,
        amountText: Math.abs(amount),
        date: this.formatTime(e.createdAt),
        ts: e.createdAt || 0,
      });
    });

    rows.sort((a, b) => b.ts - a.ts);
    this.setData({ rows });
  },

  formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
});
