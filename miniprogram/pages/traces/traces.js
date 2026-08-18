const app = getApp();
let GENTLE_V1 = app.getCopy();

const TYPE_ICON = {
  initiate: "✦",
  counter: "✧",
  accept: "♡",
  submit: "✓",
  confirm: "♡",
  revise: "✎",
  cancel: "◦",
  pause: "◦",
  journal: "✎",
  mood: "❀",
  anniversaryGrant: "❁",
  festivalGrant: "❁",
  remember: "✧",
};

Page({
  data: {
    filter: "all",
    items: [],
    groups: [],
    themeClass: "",
    copy: app.getCopy(),
    emptyTitle: "",
    emptyText: "",
  },

  async onShow() {
    GENTLE_V1 = app.getCopy();
    app.applyThemeChrome(app.globalData.role);
    this.setData({ themeClass: app.getThemeClass(app.globalData.role), copy: GENTLE_V1 });
    if (app.globalData.spaceId) {
      const cache = wx.getStorageSync("ting_traces_cache_" + app.globalData.spaceId);
      const copyPackId = wx.getStorageSync("ting_copy_pack_id") || "gentle_v1";
      if (cache && cache.cacheVersion === 1 && cache.copyPackId === copyPackId && cache.filter === this.data.filter) {
        this.setData({ items: cache.items || [], groups: cache.groups || [], emptyTitle: cache.emptyTitle || "", emptyText: cache.emptyText || "" });
      }
    }
    // 每次进入都重新确认当前空间，避免沿用旧 spaceId 导致印记查询到错误空间。
    const restored = await app.restore();
    if (restored.backup) {
      wx.reLaunch({ url: "/pages/memories/memories?mode=backup" });
      return;
    }
    if (restored.ok && app.globalData.spaceId) this.loadTraces().catch((err) => {
      console.error("[traces] render error", err);
      wx.showToast({ title: "印记处理失败，请重试", icon: "none" });
    });
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    this.loadTraces();
  },

  async loadTraces() {
    let res;
    try {
      res = await wx.cloud.callFunction({
        name: "loveApi",
        data: {
          action: "queryEvents",
          spaceId: app.globalData.spaceId,
          limit: 1000,
        },
      });
    } catch (err) {
      wx.showToast({ title: "印记读取失败，请稍后重试", icon: "none" });
      return;
    }
    const r = res.result || {};
    if (!r.success || !Array.isArray(r.events)) {
      wx.showToast({ title: r.msg || "印记读取失败，请稍后重试", icon: "none" });
      return;
    }

    const space = app.globalData.space;
    const nicknames = (space && space.nicknames) || {};
    const roles = (space && space.roles) || {};
    const nicknameByRole = {};
    Object.keys(roles).forEach((openid) => {
      nicknameByRole[roles[openid]] = nicknames[openid] || "";
    });

    const byThread = {};
    (r.events || []).forEach((e) => {
      if (!e.threadId) return;
      if (!byThread[e.threadId]) byThread[e.threadId] = [];
      byThread[e.threadId].push(e);
    });
    const threadTitles = {};
    const cardTitles = {};
    Object.keys(byThread).forEach((tid) => {
      const sorted = byThread[tid].slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const cardDefinition = sorted.find((e) => e.kind === "card_activate" && (e.type === "create" || e.type === "request"));
      if (cardDefinition && cardDefinition.cardType) {
        try {
          const parsed = JSON.parse(cardDefinition.text || "{}");
          cardTitles[cardDefinition.cardType] = parsed.name || cardDefinition.cardType;
        } catch (err) {}
      }
      const latestInitiate = sorted.slice().reverse().find((e) => e.type === "initiate");
      if (latestInitiate) {
        try {
          const parsed = JSON.parse(latestInitiate.text);
          threadTitles[tid] = (parsed && typeof parsed === "object" && parsed.title) || latestInitiate.text;
        } catch (err) {
          threadTitles[tid] = latestInitiate.text;
        }
      }
    });

    const filter = this.data.filter;
    const mappedItems = (r.events || [])
      .filter((e) => {
        if (filter === "all") return true;
        if (filter === "promise") return e.kind === "promise";
        if (filter === "card") return e.kind === "card_activate";
        if (filter === "journal") return e.type === "journal";
        if (filter === "mood") return e.type === "mood";
        return true;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((e) => {
        const actorName = e.actor === "system" ? GENTLE_V1.traces.systemActor : nicknameByRole[e.actor] || "";
        let typeLabel = GENTLE_V1.eventLabels[e.type] || e.type;
        if (e.type === "journal" && e.threadId && e.threadId.indexOf("mood_") === 0) {
          typeLabel = e.actor === app.globalData.role ? "回应了 TA 的心情" : "回应了你的心情";
        }
        // 自定义心意卡的两个入口语义不同：引导方是在准备奖励，回应方是在提出请求。
        if (e.kind === "card_activate" && e.type === "create") typeLabel = GENTLE_V1.traces.customCardCreateLabel;
        if (e.kind === "card_activate" && e.type === "request") typeLabel = GENTLE_V1.traces.customCardRequestLabel;

        let content = "";
        if (e.type === "mood") {
          content = (e.moodTags || []).join(" ");
        } else if (e.type === "cancel" && e.kind === "promise") {
          content = GENTLE_V1.traces.cancelContent;
        } else if (e.type === "remember") {
          content = GENTLE_V1.traces.rememberedContent;
        } else if (e.type === "begin") {
          content = GENTLE_V1.traces.beginContent;
        } else if (e.kind === "card_activate" && (e.type === "initiate" || e.type === "counter")) {
          // 报价事件存的是 JSON(reason)，取 reason，避免把 JSON 当文案显示
          try {
            const parsed = JSON.parse(e.text);
            content = parsed.reason || e.text;
          } catch (err) {
            content = e.text;
          }
        } else if (e.kind === "card_activate" && e.type === "accept") {
          content = e.text;
        } else if (e.kind === "card_activate" && (e.type === "create" || e.type === "request")) {
          try {
            const parsed = JSON.parse(e.text || "{}");
            content = parsed.desc || "";
          } catch (err) {
            content = e.text || "";
          }
        } else if (e.kind === "card_execute") {
          content = e.text || "";
        } else {
          try {
            const parsed = JSON.parse(e.text);
            content = (parsed && typeof parsed === "object" && parsed.desc) || e.text;
          } catch (err) {
            content = e.text;
          }
        }

        // 计算类别：只保留四种视觉主色，动作仍由步骤文字区分。
        let category = "";
        let categoryClass = "promise";
        if (e.kind === "promise") category = GENTLE_V1.vocabulary.promise;
        else if (e.kind === "card_activate") { category = GENTLE_V1.vocabulary.card; categoryClass = "card"; }
        else if (e.kind === "card_execute") { category = GENTLE_V1.vocabulary.card + GENTLE_V1.traces.cardExecuteCategorySuffix; categoryClass = "card"; }
        else if (e.type === "journal") { category = GENTLE_V1.vocabulary.diary; categoryClass = "journal"; }
        else if (e.type === "mood") { category = GENTLE_V1.vocabulary.mood; categoryClass = "mood"; }
        else if (e.type === "anniversaryGrant" || e.type === "festivalGrant" || e.type === "remember") { category = e.type === "festivalGrant" ? GENTLE_V1.traces.festivalCategory : GENTLE_V1.traces.anniversaryCategory; categoryClass = "card"; }
        else if (e.type === "begin") { category = GENTLE_V1.traces.storyStartCategory; categoryClass = "promise"; }

        // 计算具体名
        let title = "";
        if (e.kind === "promise" && e.threadId) {
          title = threadTitles[e.threadId] || "";
        } else if (e.kind === "card_activate" || e.kind === "card_execute") {
          title = cardTitles[e.cardType] || e.cardType || "";
        } else if (e.type === "anniversaryGrant" || e.type === "festivalGrant") {
          title = e.text || "";
        } else if (e.type === "mood") {
          title = (e.moodTags || []).join(" ");
        } else if (e.type === "journal") {
          title = e.threadId && e.threadId.indexOf("mood_") === 0 ? GENTLE_V1.traces.moodReplyTitle : GENTLE_V1.traces.journalTitle;
        } else if (e.type === "begin") {
          title = GENTLE_V1.traces.storyStartTitle;
        }

        const eventDate = new Date(e.createdAt || Date.now());
        const dateKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, "0")}-${String(eventDate.getDate()).padStart(2, "0")}`;

        return {
          eventId: e._id,
          threadId: e.threadId || "",
          // 同一条心情的多次回复共用 mood_<eventId>，合并为一张回忆卡；
          // 不同心情拥有不同的事件 ID，因此自然分开显示。
          groupKey: e.threadId || `event_${e._id}`,
          dateKey,
          dateLabel: `${eventDate.getMonth() + 1} 月 ${eventDate.getDate()} 日`,
          title,
          content,
          replyMoodTags: e.type === "journal" && e.threadId && e.threadId.indexOf("mood_") === 0 && Array.isArray(e.moodTags) ? e.moodTags : [],
          replyMoodText: e.type === "journal" && e.threadId && e.threadId.indexOf("mood_") === 0 && Array.isArray(e.moodTags) ? e.moodTags.join(" · ") : "",
          typeLabel,
          categoryLabel: category || GENTLE_V1.vocabulary.traces,
          categoryClass,
          icon: TYPE_ICON[e.type] || "◦",
          actorName,
          createdAt: e.createdAt || 0,
          time: this.formatTime(e.createdAt),
          timeOnly: this.formatTime(e.createdAt).split(" ").slice(-1)[0],
        };
      });

    const allGroups = {};
    mappedItems.forEach((item) => {
      if (!allGroups[item.groupKey]) {
        allGroups[item.groupKey] = {
          groupKey: item.groupKey,
          categoryLabel: item.categoryLabel,
          categoryClass: item.categoryClass,
          title: item.title,
          steps: [],
          lastTime: item.timeOnly,
          latestAt: item.createdAt || 0,
          dateKey: item.dateKey,
          dateLabel: item.dateLabel,
        };
      }
      const group = allGroups[item.groupKey];
      group.steps.push(item);
      if (!group.title && item.title) group.title = item.title;
      if ((item.createdAt || 0) > group.latestAt) {
        group.latestAt = item.createdAt || 0;
        group.lastTime = item.timeOnly;
        group.result = item.typeLabel;
        group.dateKey = item.dateKey;
        group.dateLabel = item.dateLabel;
      }
      if (!group.result) group.result = item.typeLabel;
    });

    const dateMap = {};
    Object.keys(allGroups).forEach((key) => {
      const group = allGroups[key];
      if (!dateMap[group.dateKey]) dateMap[group.dateKey] = { dateKey: group.dateKey, dateLabel: group.dateLabel, groups: [] };
      group.steps.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      dateMap[group.dateKey].groups.push(group);
    });
    const groups = Object.keys(dateMap)
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => {
        const day = dateMap[dateKey];
        day.groups.sort((a, b) => b.latestAt - a.latestAt);
        return day;
      });

    let emptyTitle = "";
    let emptyText = "";
    const allEvents = r.events || [];
    if (!mappedItems.length) {
      if (!allEvents.length) {
        emptyTitle = GENTLE_V1.traces.emptyTitle || GENTLE_V1.traces.empty;
        emptyText = GENTLE_V1.traces.emptyText || "";
      } else if (filter !== "all") {
        emptyTitle = GENTLE_V1.traces.emptyFilterTitle || "这里暂时没有这类印记";
        emptyText = GENTLE_V1.traces.emptyFilterText || "换一个筛选看看";
      } else if (allEvents.every((e) => e.type === "begin")) {
        emptyTitle = GENTLE_V1.traces.emptyStartedTitle || "故事已经开始了";
        emptyText = GENTLE_V1.traces.emptyStartedText || "等下一笔印记留下来";
      } else {
        emptyTitle = GENTLE_V1.traces.emptyTitle || GENTLE_V1.traces.empty;
        emptyText = GENTLE_V1.traces.emptyText || "";
      }
    }
    this.setData({ items: mappedItems, groups, emptyTitle, emptyText });
    wx.setStorageSync("ting_traces_cache_" + app.globalData.spaceId, {
      cacheVersion: 1,
      copyPackId: wx.getStorageSync("ting_copy_pack_id") || "gentle_v1",
      filter,
      items: mappedItems,
      groups,
      emptyTitle,
      emptyText,
    });
  },

  formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
});
