const cloud = require("wx-server-sdk");
const zlib = require("zlib");
const { Solar, Lunar } = require("lunar-javascript");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const SPACES = "ting_spaces";
const EVENTS = "ting_events";

const FESTIVAL_GRANT = 52;
const ANNIVERSARY_GRANT = 52;
const BACKUP_WINDOW_MS = 7 * 86400000;

const PERMISSION = {
  initiate: "guide",
  counter: "respond",
  accept: "respond",
  submit: "respond",
  confirm: "guide",
  revise: "guide",
  cancel: "guide",
  journal: null,
  mood: "respond",
  anniversaryGrant: "guide",
  remember: "guide",
  festivalGrant: null,
};

const CARD_PERMISSION = {
  create: "guide",
  request: "respond",
  initiate: "respond",
  counter: "guide",
  accept: null,
  pause: "guide",
  cancel: "respond",
  giveup: "respond",
};

const EXECUTE_PERMISSION = {
  initiate: "respond",   // 回应方发起兑换
  submit: "guide",       // 引导方执行
  pause: "guide",        // 新增：引导方暂不执行
  confirm: null,         // 双方都可：回应方确认 + 温柔终止后引导方确认
  revise: "respond",     // 回应方驳回
  cancel: null,          // 双方都可：回应方取消 + 温柔终止后引导方取消
};

const getOpenId = () => cloud.getWXContext().OPENID;

const startOfYearTs = () => {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const daysBetween = (dateStr) => {
  const parts = String(dateStr || "").split("-");
  if (parts.length !== 3) return 0;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - d.getTime();
  return Math.floor(diff / 86400000);
};

const qixiSolar = (year) => {
  const lunar = Lunar.fromYmd(year, 7, 7);
  const solar = lunar.getSolar();
  return { month: solar.getMonth(), day: solar.getDay() };
};

const isToday = (month, day) => {
  const now = new Date();
  return now.getMonth() + 1 === month && now.getDate() === day;
};

const getSpace = async (spaceId) => {
  const doc = await db.collection(SPACES).doc(spaceId).get();
  return doc.data || null;
};

const checkContent = async (content) => {
  // 敏感词检测：明确判定违规才拦截；
  // 纯接口故障（偶发超时/网络抖）重试 1 次，仍失败则放行，避免误伤正常用户发内容。
  for (let i = 0; i < 2; i++) {
    try {
      const res = await cloud.openapi.security.msgSecCheck({
        content,
      });
      if (res && res.errCode === 0) return true;
      return false;   // 明确判定违规
    } catch (err) {
      if (i === 1) return true;  // 重试仍失败 → 放行，避免偶发故障卡住用户
    }
  }
  return true;
};

const genInviteCode = async () => {
  // 尝试 3 次生成唯一码；撞号概率极低，全撞则返回空让前端重试（避免递归爆栈，不硬塞无效码）
  for (let i = 0; i < 3; i++) {
    const code = "sp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const exist = await db.collection(SPACES).doc(code).get().catch(() => null);
    if (!exist || !exist.data) return code;
  }
  return "";
};

const joinSpace = async (event) => {
  const respondOpenid = getOpenId();
  const { code, guideOpenid, spaceName, guideName, respondName, startDate } = event;
  if (!code || !guideOpenid || !spaceName || !guideName || !respondName) {
    return { success: false, msg: "参数不完整" };
  }
  if (typeof guideOpenid !== "string" || guideOpenid.length > 64) {
    return { success: false, msg: "参数不完整" };
  }
  if (guideOpenid === respondOpenid) return { success: false, msg: "不能接受自己的邀请" };
  if (!(await checkContent(spaceName)) || !(await checkContent(guideName)) || !(await checkContent(respondName))) {
    return { success: false, msg: "内容包含敏感词，请修改" };
  }

  const result = await db.runTransaction(async (transaction) => {
    const exist = await transaction.collection(SPACES).doc(code).get().catch(() => null);
    if (exist && exist.data) return { fail: "邀请已经用过了" };

    const sp = {
      _id: code,
      members: [guideOpenid, respondOpenid],
      roles: { [guideOpenid]: "guide", [respondOpenid]: "respond" },
      nicknames: { [guideOpenid]: guideName, [respondOpenid]: respondName },
      spaceName,
      startDate: startDate || "",
      anniversaries: [],
      score: 0,
      unread: {},
      pairingStatus: "paired",
    };
    await transaction.collection(SPACES).add({ data: sp });

    await transaction.collection(EVENTS).add({
      data: {
        spaceId: code,
        threadId: null,
        kind: "none",
        type: "begin",
        text: startDate || "",
        actor: "system",
        createdAt: Date.now(),
      },
    });
    return { ok: true };
  }).catch((err) => {
    const isDup = /duplicate|\bid\b/.test((err && err.message) || "");
    return { fail: isDup ? "邀请已经用过了" : "成交失败，请重试" };
  });

  if (result.fail) return { success: false, msg: result.fail };
  return { success: true, spaceId: code, role: "respond", guideOpenid };
};

const restore = async () => {
  const openid = getOpenId();
  const res = await db
    .collection(SPACES)
    .where({ members: openid })
    .limit(1)
    .get();
  if (res.data.length === 0) {
    return { success: true, hasSpace: false, openid };
  }
  const space = res.data[0];
  if (space.status === "backup") {
    const until = Date.parse(space.backupUntil || "");
    if (Number.isFinite(until) && until <= Date.now()) {
      await db.runTransaction(async (transaction) => {
        await transaction.collection(EVENTS).where({ spaceId: space._id }).remove();
        await transaction.collection(SPACES).doc(space._id).remove();
      }).catch(() => {});
      return { success: true, hasSpace: false, openid };
    }
    if (space.backupOwner === openid) {
      return { success: true, hasSpace: false, backup: true, space, role: space.roles[openid], openid };
    }
    return { success: true, hasSpace: false, openid };
  }
  return {
    success: true,
    hasSpace: true,
    space,
    role: space.roles[openid],
    openid,
  };
};

const importData = async (event) => {
  const openid = getOpenId();
  const { backup } = event;
  if (!backup || typeof backup !== "string" || backup.length > 1000000) {
    return { success: false, msg: "备份码无效" };
  }

  let envelope;
  try {
    envelope = JSON.parse(backup);
  } catch (e) {
    return { success: false, msg: "备份码无效" };
  }
  if (!envelope || envelope.header !== "TING_MEMORIES_BACKUP_V1" || envelope.version !== 1 || typeof envelope.data !== "string") {
    return { success: false, msg: "备份码无效" };
  }

  let payload;
  try {
    payload = JSON.parse(zlib.gunzipSync(Buffer.from(envelope.data, "base64")).toString("utf8"));
  } catch (e) {
    return { success: false, msg: "备份数据损坏，请重新复制" };
  }

  const sourceSpace = payload && payload.space;
  const sourceEvents = payload && payload.events;
  if (!sourceSpace || !Array.isArray(sourceEvents) || sourceEvents.length > 1000) {
    return { success: false, msg: "备份码无效" };
  }

  const members = Array.isArray(sourceSpace.members) ? sourceSpace.members : [];
  const roles = sourceSpace.roles && typeof sourceSpace.roles === "object" ? sourceSpace.roles : {};
  const nicknames = sourceSpace.nicknames && typeof sourceSpace.nicknames === "object" ? sourceSpace.nicknames : {};
  if (
    !sourceSpace._id ||
    members.length !== 2 ||
    members.some((m) => typeof m !== "string" || !m) ||
    members.indexOf(openid) === -1 ||
    (roles[members[0]] !== "guide" && roles[members[0]] !== "respond") ||
    (roles[members[1]] !== "guide" && roles[members[1]] !== "respond") ||
    new Set(members.map((member) => roles[member])).size !== 2
  ) {
    return { success: false, msg: "备份码不属于这个空间" };
  }
  const memberSet = new Set(members);
  if (sourceEvents.some((item) => !item || !item.type || typeof item.createdAt !== "number")) {
    return { success: false, msg: "备份码无效" };
  }
  if (sourceEvents.some((item) => item.actor && !["guide", "respond", "system"].includes(item.actor))) {
    return { success: false, msg: "备份码中的记录身份无效" };
  }

  const cleanEvents = [];
  for (const item of sourceEvents) {
    cleanEvents.push({
      spaceId: sourceSpace._id,
      threadId: item.threadId || null,
      kind: item.kind || "none",
      type: item.type,
      actor: item.actor || "system",
      text: item.text || "",
      score: typeof item.score === "number" ? item.score : null,
      cardType: item.cardType || null,
      moodTags: Array.isArray(item.moodTags) ? item.moodTags : null,
      createdAt: item.createdAt,
    });
  }

  const result = await db.runTransaction(async (transaction) => {
    const existingMine = await transaction.collection(SPACES).where({ members: openid }).limit(1).get();
    if (existingMine.data && existingMine.data.length) {
      const target = existingMine.data[0];
      if (target.status === "backup") return { fail: "空间已解除，仅可查看和导出" };
      const targetMembers = Array.isArray(target.members) ? target.members : [];
      const sameMembers = targetMembers.length === members.length
        && targetMembers.every((member) => memberSet.has(member));
      const targetRoles = target.roles && typeof target.roles === "object" ? target.roles : {};
      const sameRoles = sameMembers
        && targetMembers.every((member) => targetRoles[member] === "guide" || targetRoles[member] === "respond")
        && new Set(targetMembers.map((member) => targetRoles[member])).size === 2;
      if (!sameMembers || !sameRoles) return { fail: "这份备份不属于当前两人的空间，无法导入" };

      const existingEventsRes = await transaction.collection(EVENTS).where({ spaceId: target._id }).limit(1000).get();
      const existingEvents = existingEventsRes.data || [];
      const importedBackups = Array.isArray(target.importedBackups) ? target.importedBackups : [];
      const importKey = `${sourceSpace._id}:${envelope.exportedAt || ""}`;
      if (importedBackups.indexOf(importKey) >= 0) return { ok: true, spaceId: target._id, merged: true };

      const roleMap = {};
      members.forEach((member) => {
        roleMap[roles[member]] = targetRoles[member];
      });
      const eventKey = (item) => JSON.stringify([
        item.threadId || null,
        item.type || "",
        item.actor || "system",
        item.text || "",
        typeof item.score === "number" ? item.score : null,
        item.cardType || null,
        Array.isArray(item.moodTags) ? item.moodTags : null,
        item.createdAt || 0,
      ]);
      const existingKeys = new Set(existingEvents.map(eventKey));
      const hasBegin = existingEvents.some((item) => item.type === "begin");
      const targetEvents = [];
      cleanEvents.forEach((item) => {
        if (item.type === "begin" && hasBegin) return;
        const mapped = Object.assign({}, item, {
          spaceId: target._id,
          actor: roleMap[item.actor] || item.actor,
        });
        const key = eventKey(mapped);
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        targetEvents.push(mapped);
      });

      const currentAnniversaries = Array.isArray(target.anniversaries) ? target.anniversaries : [];
      const backupAnniversaries = Array.isArray(sourceSpace.anniversaries) ? sourceSpace.anniversaries : [];
      const anniversaryKeys = new Set(currentAnniversaries.map((item) => item.anniversaryId || item.id || JSON.stringify(item)));
      const anniversaries = currentAnniversaries.slice();
      backupAnniversaries.forEach((item) => {
        const key = item.anniversaryId || item.id || JSON.stringify(item);
        if (!anniversaryKeys.has(key)) {
          anniversaryKeys.add(key);
          anniversaries.push(item);
        }
      });

      await transaction.collection(SPACES).doc(target._id).update({
        data: {
          anniversaries,
          score: (typeof target.score === "number" ? target.score : 0)
            + (typeof sourceSpace.score === "number" ? sourceSpace.score : 0),
          unread: {},
          pairingStatus: "paired",
          importedBackups: importedBackups.concat([importKey]).slice(-20),
        },
      });
      for (const item of targetEvents) {
        await transaction.collection(EVENTS).add({ data: item });
      }
      return { ok: true, spaceId: target._id, merged: true };
    }
    const existing = await transaction.collection(SPACES).doc(sourceSpace._id).get().catch(() => null);
    if (existing && existing.data) return { fail: "这个备份已经存在" };

    const cleanSpace = {
      _id: sourceSpace._id,
      members,
      roles,
      nicknames,
      spaceName: String(sourceSpace.spaceName || ""),
      startDate: String(sourceSpace.startDate || ""),
      anniversaries: Array.isArray(sourceSpace.anniversaries) ? sourceSpace.anniversaries : [],
      score: typeof sourceSpace.score === "number" ? sourceSpace.score : 0,
      unread: sourceSpace.unread && typeof sourceSpace.unread === "object" ? sourceSpace.unread : {},
      pairingStatus: "paired",
      importedBackups: [],
    };
    await transaction.collection(SPACES).add({ data: cleanSpace });
    for (const item of cleanEvents) {
      await transaction.collection(EVENTS).add({ data: item });
    }
    return { ok: true, spaceId: cleanSpace._id };
  }).catch((err) => {
    const isDup = /duplicate|already exists|\bid\b/.test((err && err.message) || "");
    return { fail: isDup ? "这个备份已经存在" : "恢复失败，请重试" };
  });

  if (result.fail) return { success: false, msg: result.fail };
  return { success: true, spaceId: result.spaceId };
};

const disbandSpace = async (event) => {
  const openid = getOpenId();
  const { spaceId, spaceName } = event;
  if (!spaceId || !spaceName) return { success: false, msg: "参数不完整" };

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.collection(SPACES).doc(spaceId).get();
    const space = doc.data;
    if (!space || !Array.isArray(space.members) || space.members.indexOf(openid) === -1) {
      return { fail: "无权操作" };
    }
    if (space.spaceName !== spaceName) return { fail: "空间名不一致" };
    if (space.status === "backup") {
      if (space.backupOwner !== openid) return { fail: "只有备份保留方可以删除这份备份" };
      await transaction.collection(EVENTS).where({ spaceId }).remove();
      await transaction.collection(SPACES).doc(spaceId).remove();
      return { ok: true, deletedBackup: true };
    }
    const backupOwner = space.members.find((member) => member !== openid);
    const backupUntil = new Date(Date.now() + BACKUP_WINDOW_MS).toISOString();
    await transaction.collection(SPACES).doc(spaceId).update({
      data: {
        status: "backup",
        pairingStatus: "backup",
        backupBy: openid,
        backupOwner,
        backupAt: new Date().toISOString(),
        backupUntil,
        pairedAt: "",
      },
    });
    return { ok: true, backupUntil };
  }).catch(() => ({ fail: "解除失败，请重试" }));

  if (result.fail) return { success: false, msg: result.fail };
  return { success: true };
};

const appendEvent = async (event) => {
  const openid = getOpenId();
  const { spaceId, threadId, type, text, score, kind, cardType, moodTags } = event;

  const isCard = kind === "card_activate";
  const isExecute = kind === "card_execute";
  const isFree = type === "journal" || type === "mood" || type === "anniversaryGrant" || type === "remember" || type === "festivalGrant";
  const actorMap = isCard ? CARD_PERMISSION : (isExecute ? EXECUTE_PERMISSION : PERMISSION);
  const requiredActor = actorMap[type];
  if (requiredActor === undefined) return { success: false, msg: "不支持的事件类型" };
  if (text && !(await checkContent(text))) {
    return { success: false, msg: "内容包含敏感词，请修改" };
  }

  const yearStart = startOfYearTs();

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.collection(SPACES).doc(spaceId).get();
    const space = doc.data;
    if (!space) return { fail: "无权操作" };
    if (!space.members || space.members.indexOf(openid) === -1) {
      return { fail: "无权操作" };
    }
    const role = space.roles[openid];
    if (requiredActor && role !== requiredActor) return { fail: "无权操作" };
    if (space.status === "backup") return { fail: "空间已解除，仅可查看和导出" };
    const maxTextLength = type === "journal" ? 200 : 50;
    if (type !== "initiate" && type !== "create" && type !== "request" && text && text.length > maxTextLength) {
      return { fail: "字数超限" };
    }

    if (type === "anniversaryGrant" || type === "remember") {
      const dup = await transaction
        .collection(EVENTS)
        .where({
          spaceId,
          type: _.in(["anniversaryGrant", "remember"]),
          text,
          createdAt: _.gte(yearStart),
        })
        .count();
      if (dup.total > 0) return { fail: "今年已处理过" };
    }
    if (type === "festivalGrant") {
      const dup = await transaction
        .collection(EVENTS)
        .where({ spaceId, type: "festivalGrant", text, createdAt: _.gte(yearStart) })
        .count();
      if (dup.total > 0) return { fail: "今年已发过" };
    }

    let tid = threadId;
    if (isCard && !tid) {
      tid = `card_${cardType}`;
    }
    if (type === "initiate" && !tid) {
      tid = `${spaceId}_${Date.now()}`;
    }
    if (!tid && !isFree) return { fail: "参数不完整" };

    let evText = text || "";
    if (isCard && type === "accept") {
      const nicks = space.members
        .map((m) => (space.nicknames && space.nicknames[m]) || "")
        .filter((n) => n);
      evText = `${nicks[0] || ""} 和 ${nicks[1] || ""} 以 ${score} 分生效了一张「${cardType}」`;
    }

    const ev = {
      spaceId,
      threadId: tid,
      kind: isCard ? "card_activate" : isExecute ? "card_execute" : isFree ? "none" : "promise",
      type,
      actor: type === "festivalGrant" ? "system" : role,
      text: evText,
      score: typeof score === "number" ? score : null,
      cardType: isCard || isExecute ? cardType : null,
      moodTags: Array.isArray(moodTags) ? moodTags : null,
      createdAt: Date.now(),
    };
    const addRes = await transaction.collection(EVENTS).add({ data: ev });

    const unread = space.unread || {};
    const newUnread = Object.assign({}, unread);
    if (newUnread[openid] && newUnread[openid][tid]) {
      const mine = Object.assign({}, newUnread[openid]);
      delete mine[tid];
      newUnread[openid] = mine;
    }
    if (type !== "journal" && type !== "mood") {
      const counterpart = space.members.find((m) => m !== openid);
      if (counterpart) {
        const theirs = Object.assign({}, newUnread[counterpart]);
        theirs[tid] = true;
        newUnread[counterpart] = theirs;
      }
    }

    const updateData = {};
    // unread 仅在确实变化时才写入，避免空对象触发 $set is empty
    if (Object.keys(newUnread).length > 0) {
      updateData.unread = newUnread;
    }
    if (type === "confirm" && !isExecute) {
      // 普通约定确认按"最后谈定分"入账；卡片执行(兑换)约定确认不再加分（兑换时已永久扣分）
      const agreedEvents = await transaction
        .collection(EVENTS)
        .where({
          spaceId,
          threadId: tid,
          type: _.in(["accept", "initiate", "counter"]),
          score: _.gt(0),
        })
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      const agreedScore = agreedEvents.data && agreedEvents.data[0] ? agreedEvents.data[0].score : null;
      if (typeof agreedScore !== "number") {
        return { fail: "这次约定还没扰定分，先商量好再确认吧" };
      }
      updateData.score = (space.score || 0) + agreedScore;
    }
    if (type === "anniversaryGrant" || type === "festivalGrant") {
      updateData.score = (space.score || 0) + 52;
    }
    if (isExecute && (type === "pause" || type === "cancel")) {
      // 卡片执行约定被引导方"暂不执行"或回应方"取消"时，退回兑换时永久扣掉的分
      // 业务上一个执行约定只会终止一次，无需防重
      const priceEvents = await transaction
        .collection(EVENTS)
        .where({ spaceId, threadId: tid, kind: "card_execute", type: "initiate" })
        .limit(1)
        .get();
      const price = priceEvents.data && priceEvents.data[0] ? priceEvents.data[0].score || 0 : 0;
      if (price > 0) {
        updateData.score = (space.score || 0) + price;   // 退回分
      }
    }
    if (Object.keys(updateData).length > 0) {
      await transaction.collection(SPACES).doc(spaceId).update({
        data: updateData,
      });
    }

    return { ok: true, threadId: tid, eventId: addRes._id };
  });

  if (result.fail) return { success: false, msg: result.fail };
  return { success: true, threadId: result.threadId, eventId: result.eventId };
};

const redeemCard = async (event) => {
  const openid = getOpenId();
  const { spaceId, cardType } = event;
  if (!spaceId || !cardType) return { success: false, msg: "参数不完整" };

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.collection(SPACES).doc(spaceId).get();
    const space = doc.data;
    if (!space) return { fail: "无权操作" };
    if (!space.members || space.members.indexOf(openid) === -1) return { fail: "无权操作" };
    if (space.status === "backup") return { fail: "空间已解除，仅可查看和导出" };
    const role = space.roles[openid];
    if (role !== "respond") return { fail: "只有回应方可以兑换" };

    // 查卡价
    const cardEvents = await transaction.collection(EVENTS)
      .where({ spaceId, kind: "card_activate", cardType, type: _.in(["accept", "create"]) })
      .limit(1).get();
    if (!cardEvents.data.length) return { fail: "这张卡未生效" };
    const price = cardEvents.data[0].score || 0;

    // 校验余额
    const balance = space.score || 0;
    if (balance < price) {
      return { fail: `还差 ${price - balance} 分。先去完成几个约定，攒够了再兑换。` };
    }

    // 生成卡片约定 threadId
    const threadId = `${spaceId}_execute_${Date.now()}`;

    // 扣分
    await transaction.collection(SPACES).doc(spaceId).update({
      data: { score: balance - price },
    });

    // 生成卡片约定 initiate 事件
    const ev = {
      spaceId,
      threadId,
      kind: "card_execute",
      type: "initiate",
      actor: role,
      text: cardType,
      score: price,
      cardType,
      moodTags: null,
      createdAt: Date.now(),
    };
    const addRes = await transaction.collection(EVENTS).add({ data: ev });

    return { ok: true, threadId };
  });

  if (result.fail) return { success: false, msg: result.fail };
  return { success: true, threadId: result.threadId };
};

const markRead = async (event) => {
  const openid = getOpenId();
  const { spaceId, threadId } = event;
  if (!spaceId || !threadId) return { success: false, msg: "参数不完整" };
  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.collection(SPACES).doc(spaceId).get();
    const space = doc.data;
    if (!space) return { fail: "无权操作" };
    if (!space.members || space.members.indexOf(openid) === -1) {
      return { fail: "无权操作" };
    }
    const unread = space.unread || {};
    const mine = unread[openid] || {};
    if (mine[threadId]) {
      const newMine = Object.assign({}, mine);
      delete newMine[threadId];
      const newUnread = Object.assign({}, unread, { [openid]: newMine });
      await transaction.collection(SPACES).doc(spaceId).update({
        data: { unread: newUnread },
      });
    }
    return { ok: true };
  });
  if (result.fail) return { success: false, msg: result.fail };
  return { success: true };
};

const queryEvents = async (event) => {
  const openid = getOpenId();
  const { spaceId, threadId, limit } = event;
  if (!spaceId) return { success: false, msg: "参数不完整" };
  const space = await getSpace(spaceId);
  if (!space) return { success: false, msg: "无权查看" };
  if (!space.members || space.members.indexOf(openid) === -1) {
    return { success: false, msg: "无权查看" };
  }
  if (space.status === "backup" && space.backupOwner !== openid) {
    return { success: false, msg: "无权查看" };
  }
  const where = { spaceId };
  if (threadId) where.threadId = threadId;
  const res = await db
    .collection(EVENTS)
    .where(where)
    .orderBy("createdAt", "desc")
    .limit(limit || 50)
    .get();
  return { success: true, events: res.data };
};

const updateSpace = async (event) => {
  const openid = getOpenId();
  const { spaceId, anniversaries } = event;
  if (!spaceId) return { success: false, msg: "参数不完整" };
  if (!Array.isArray(anniversaries)) return { success: false, msg: "参数不完整" };
  for (const a of anniversaries) {
    if (!a || !a.name || !a.date || (a.remindCycle !== "month" && a.remindCycle !== "year")) {
      return { success: false, msg: "参数不完整" };
    }
    if (a.name.length > 20) return { success: false, msg: "字数超限" };
    if (!(await checkContent(a.name))) {
      return { success: false, msg: "内容包含敏感词，请修改" };
    }
  }

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.collection(SPACES).doc(spaceId).get();
    const space = doc.data;
    if (!space) return { fail: "无权操作" };
    if (!space.members || space.members.indexOf(openid) === -1) {
      return { fail: "无权操作" };
    }
    if (space.status === "backup") return { fail: "空间已解除，仅可查看和导出" };
    await transaction.collection(SPACES).doc(spaceId).update({
      data: { anniversaries },
    });
    return { ok: true };
  });
  if (result.fail) return { success: false, msg: result.fail };
  return { success: true, anniversaries };
};

const checkAnniversaries = async (event) => {
  const openid = getOpenId();
  const { spaceId } = event;
  if (!spaceId) return { success: false, msg: "参数不完整" };
  const space = await getSpace(spaceId);
  if (!space) return { success: false, msg: "无权查看" };
  if (!space.members || space.members.indexOf(openid) === -1) {
    return { success: false, msg: "无权查看" };
  }

  const yearStart = startOfYearTs();
  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  const anniversaries = [];
  const spaceIdLocal = spaceId;

  for (const a of space.anniversaries || []) {
    const parts = String(a.date || "").split("-");
    if (parts.length !== 3) continue;
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (m === todayMonth && d === todayDay) {
      const dup = await db
        .collection(EVENTS)
        .where({
          spaceId: spaceIdLocal,
          type: _.in(["anniversaryGrant", "remember"]),
          text: a.name,
          createdAt: _.gte(yearStart),
        })
        .count();
      if (dup.total === 0) {
        anniversaries.push({ name: a.name, date: a.date, remindCycle: a.remindCycle, days: daysBetween(a.date) });
      }
    }
  }

  const festivals = [];
  const year = now.getFullYear();
  const qixi = qixiSolar(year);
  if (isToday(qixi.month, qixi.day)) {
    const dup = await db
      .collection(EVENTS)
      .where({ spaceId: spaceIdLocal, type: "festivalGrant", text: "七夕", createdAt: _.gte(yearStart) })
      .count();
    if (dup.total === 0) festivals.push({ name: "七夕" });
  }
  if (isToday(2, 14)) {
    const dup = await db
      .collection(EVENTS)
      .where({ spaceId: spaceIdLocal, type: "festivalGrant", text: "情人节", createdAt: _.gte(yearStart) })
      .count();
    if (dup.total === 0) festivals.push({ name: "情人节" });
  }

  return { success: true, anniversaries, festivals };
};

exports.main = async (event) => {
  try {
    switch (event.action) {
      case "genInviteCode": {
        const code = await genInviteCode();
        if (!code) return { success: false, msg: "没成功，别急，再试一次" };
        return { success: true, code };
      }
      case "joinSpace":
        return await joinSpace(event);
      case "restore":
        return await restore(event);
      case "importData":
        return await importData(event);
      case "disbandSpace":
        return await disbandSpace(event);
      case "appendEvent":
        return await appendEvent(event);
      case "queryEvents":
        return await queryEvents(event);
      case "markRead":
        return await markRead(event);
      case "updateSpace":
        return await updateSpace(event);
      case "checkAnniversaries":
        return await checkAnniversaries(event);
      case "redeemCard":
        return await redeemCard(event);
      default:
        return { success: false, msg: "unknown action" };
    }
  } catch (e) {
    return { success: false, msg: e.message || "error" };
  }
};
