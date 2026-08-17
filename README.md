# 听你的呀

版本：`3.0.0`

一个面向两个人的关系记录小程序：把约定、心情、随手记和重要时刻，留在只属于你们的空间里。它适用于各种双方自愿的上下位关系（例如 BDSM 语境中的 dominant/submissive，也包括猫奴、犬奴等宠物角色扮演语境），但不限定关系类型，也不替任何一方评价关系。

当前公开版本为了适应应用审核，内置文案采用极为克制、中性的“温柔”和“冷静”语气，不直接呈现特定圈层称谓。使用者可以在本地导入或开发自己的语气包，在不改变数据结构和事件类型的前提下替换页面词汇、按钮名和事件文案。

## 功能概览

- 双人空间与角色配对
- 今天的约定、最近的小事、心情和随手记
- 自定义心意卡与心意分
- 「印记」历史事件流：保留输入、协商、回应等过程痕迹
- 「拾光之旅」：通过微信收藏备份与恢复空间数据
- 温柔、冷静两套内置语气，以及本地导入语气包
- 温柔主题与角色主题；颜色、字号统一从视觉规范取值

## 语气包与适用关系

语气包只改变用户可见文字，不改变事件类型、角色字段、权限和数据结构。这样可以让同一套程序适配不同的上下位关系：默认版本保持克制，用户可以自行添加更明确的角色语境。

仓库提供两套非默认示例，供本地测试和二次开发：

- `examples/copy-pack-cat_v1.json`：猫奴语境示例，使用“猫主 / 猫奴”“主人的指令 / 服从完成”等角色化表达。
- `examples/copy-pack-dog_v1.json`：犬奴语境示例，使用“训导者 / 犬奴”“训练任务 / 做到”等角色化表达。

示例语气包仅用于开发和本地导入，不代表平台默认立场，也不包含任何成人内容。使用者应自行判断所在平台、地区和应用商店的审核要求。

## 技术结构

项目由微信小程序前端、一个云函数 `loveApi` 和云数据库组成。云函数通过 `action` 分流，不依赖独立服务器或第三方 API；事件流以事件记录为事实来源，首页只读取当前流程所需的数据。

主要目录：

```
miniprogram/             小程序页面、状态、语气包与主题
cloudfunctions/loveApi/  云端业务入口
tests/                   本地状态推导测试
软件设计架构说明.md      代码对应的架构说明
交互说明文档.md          页面与流程说明
视觉规范文档.md          颜色、字号和布局规范
接口文档.md              云函数 action 与数据约定
用户手册.md              面向使用者的操作说明
```

## 安装教程

### 开发者安装

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 和 Node.js 18 或更高版本。
2. 克隆仓库并进入目录：

   ```bash
   git clone https://github.com/Reihard/ting-ni-de-ya-wechat-miniprogram.git
   cd ting-ni-de-ya-wechat-miniprogram
   ```

3. 用微信开发者工具导入项目根目录；公开配置没有真实 AppID，请在工具中填写自己的 AppID。
4. 在 `miniprogram/app.js` 的 `globalData.env` 填入自己的云环境 ID（建议只在本地修改，不要提交）。
5. 在云开发控制台创建数据库集合 `ting_spaces`、`ting_events`，并部署 `cloudfunctions/loveApi`：

   ```bash
   cd cloudfunctions/loveApi
   npm install
   ```

   然后在微信开发者工具中右键云函数目录，选择“上传并部署：云端安装依赖”。
6. 回到项目根目录，在开发者工具中编译、预览或真机调试。

### 本地语气包安装

1. 复制 `examples/copy-pack-cat_v1.json` 或 `examples/copy-pack-dog_v1.json`。
2. 按 `接口文档.md` 中的 `copy_pack` 格式导入；也可以把示例内容作为 `COPY_PACKS` 的新成员加入 `miniprogram/utils/copy.js`。
3. 语气包只保存在本地设备，不会自动同步给另一方；双方需要分别导入，或由开发者实现更高层的同步策略。

公开仓库不包含任何真实凭据；`project.private.config.json` 已被忽略。不要把 AppID、云环境 ID、备份码或用户数据提交到公开仓库。

代码中的环境 ID 是占位配置，发布前必须替换为你自己的环境。所有上下位关系语气都应建立在双方知情、自愿、可随时暂停或退出的前提下；本项目不鼓励胁迫、骚扰或伤害性行为。

## 检查与测试

```bash
node tests/state.test.js
node --check miniprogram/pages/index/index.js
node --check miniprogram/pages/traces/traces.js
node --check cloudfunctions/loveApi/index.js
```

## 创意来源与独立实现

本项目的早期创意受到 `rainbow-cats` 项目启发，尤其是“为两个人保存共同记录”的方向。但本仓库不是其 fork，也不复制其代码、数据或界面：当前的事件模型、角色与配对逻辑、备份/恢复、语气包、主题系统、页面结构和交互均经过重新设计并独立实现。引用该项目仅用于说明创意脉络。

## 隐私与发布边界

仓库只发布通用源码和说明文档，不发布真实 AppID、云环境 ID、微信用户标识、空间数据或备份文件。个人备份文件请保存在本地，并通过 `.gitignore` 排除。

## 参考

- [微信云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
