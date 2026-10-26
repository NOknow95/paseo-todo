---
name: publish-to-npm
description: 发布 paseo-todo（pi 包）到 npm 并核对 pi.dev 包目录收录。当用户说发 npm、npm publish、发个版、升版本号重发、改完 README 要更新、包怎么还没出现在 pi.dev/packages、staged release 卡住、npm 登录/验证码报错时使用。
---

# 发布 paseo-todo 到 npm

> 本仓库是**单包仓库**：仓库根就是 npm 包根。发布成功的唯一标准不是 `npm publish` 打印 `+ paseo-todo@x.y.z`，而是**registry 的 `dist-tags.latest` 等于目标版本**，且 pi.dev 目录页可访问。

## 0. 本字段清单（package.json 里任何一个丢了都会导致「能装但不被 pi 目录识别」或「装了冲突」）

| 字段 | 值 / 作用 |
|---|---|
| `name` | `paseo-todo`，已被本仓库占用；不要再改名（改名等于新包，需重新起 repo 与收录） |
| `keywords` | **必须含 `pi-package`** —— pi 目录页唯一发现依据，缺了发布成功也不会收录 |
| `pi.extensions` | `["./index.ts"]`，pi 加载入口；无它则包被装下但扩展不加载 |
| `peerDependencies` | `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui`、`typebox` 全部用 `"*"`。**禁止**放进 `dependencies`（会在编译后的 ESM 里造成宿主包重复实例） |
| `files` | 白名单：`index.ts`、`state.ts`、`README.md`、`LICENSE` |
| `publishConfig.access` | `public`，缺了某些配置下会被当私有包 |
| `repository` | `git+https://github.com/NOknow95/paseo-todo.git`，npm 页面与 pi 目录页的 repo 链接来源 |

改动这些字段后先跑 `npm pack --dry-run`，确认 tarball 里**没有**多余文件（当前应为 5 个文件、约 18.8 kB）。

## 1. 正常发版流程

```sh
cd ~/develop/projects/js/paseo-todo
npm pack --dry-run            # 目视确认 tarball 内容
npm version patch             # 或 minor/major；会改 package.json 并打 tag
git push --follow-tags        # 先把改动推上去，避免 registry 里 repository 指向旧代码
npm publish
bash .agents/skills/publish-to-npm/scripts/verify-publish.sh
```

`verify-publish.sh` 会核对：`dist-tags.latest` == package.json 的 version、`keywords` 含 `pi-package`、`pi.extensions` 存在、tarball 可下载、pi.dev 目录页可访问。**任一项失败就继续排查，不要凭 publish 输出宣布成功。**

## 2. 账号与登录

- 账号：`noknow951`（`noknow` 是别人的账号，别用）
- 检查：`npm whoami`，输出用户名才表示已登录；`ENEEDAUTH` 表示本机没有 token
- 登录：`npm login --auth-type=web`（打印 `https://www.npmjs.com/auth/cli/<uuid>`，浏览器里用 `noknow951` 登录并授权，CLI 轮询完成）
- 该账号开了 2FA：`npm publish` 大概率抛 `EOTP`，见 Gotchas

## 3. Gotchas（都是实际踩过的，按遇到概率排序）

**① 发布后 registry 里只有 `0.0.0-stage`，没有你的版本**
npm 的 staged publishing（暂存发布）：新包/新版本先进暂存区，registry 先放一个占位版 `0.0.0-stage`，其 readme 写着 "Temporary package placeholder for staged publishing"。表现是 `npm view paseo-todo version` → `0.0.0-stage`，但 `npm view paseo-todo@<version>` 能查到。实测约 2 分钟后自动变成 `latest: <version>`。
处理顺序：先等 2–3 分钟重查 `npm view paseo-todo dist-tags`；仍不动再走人工批准：

```sh
npx --yes npm@11 stage list paseo-todo          # 取 stage-id
npx --yes npm@11 stage approve <stage-id>       # 要 2FA 码
```

也可在 npmjs.com 包页 **Staged Packages** 标签点 Approve。注意本机 `npm` 是 10.9.3，**没有** `stage` 子命令（报 `Unknown command: "stage"`），所以用 `npx npm@11`；想省事就 `npm i -g npm@latest`（需 ≥11.15.0，Node ≥22.14）。

**② `npm publish` 抛 `EOTP ... requires a one-time password`**
让用户自己跑 `npm publish --otp=<6位码>`。验证码 30 秒过期，agent 代跑要一次消息往返，很容易刚好过期；用户自己跑更稳。另一种走法是交互式 web 授权（不用 OTP）：`npm publish` 时看到 `Authenticate your account at: ...` 后按回车，浏览器里完成即可。

**③ `npm adduser --auth-type=legacy` 报 403**
npm 已关闭 API 建号，报错原文：`Account creation via legacy auth is unavailable. Please set your auth-type to "web" or visit https://www.npmjs.com/signup`。这条路永久不要试。

**④ 用自动化浏览器打开 `npmjs.com/signup` 被 DataDome 拦**
页面只渲染 `geo.captcha-delivery.com` 的 iframe，内容为「访问暂时受限 / IP 与网路机器人相同」，**没有可解的验证码控件**，`/login` 却能正常打开。注册必须由用户在自己浏览器或手机网络完成，agent 不要在这上面反复重试。

**⑤ 本机残留同名扩展目录 → `todowrite` 注册两次**
`~/.pi/agent/extensions/paseo-todo/` 曾作为本地开发副本存在。已切到 npm 源后它被移到 `~/.pi/agent/backups/paseo-todo-20261026/`。发新版后排障时**不要**把目录再拷回 `~/.pi/agent/extensions/`，否则同一扩展被加载两次、工具名冲突。

**⑥ `curl https://www.npmjs.com/package/paseo-todo` 返回 403**
npm 拦非浏览器 UA，不代表包没发成功。判断成功以 registry API 与 `npm view` 为准。

**⑦ 包名占用只能用 registry 查**
`https://registry.npmjs.org/<name>` 返回 404 才是可用的；用户名是否被占用查不了（用户查询接口需鉴权），别在这上面下结论。

## 4. 本机安装源

发布后的安装/升级（用户侧同理）：

```sh
pi install npm:paseo-todo     # 首次
pi update npm:paseo-todo      # 发新版后
pi list                       # 确认走的是 ~/.pi/agent/npm/node_modules/paseo-todo
```

无 npm 账号时的降级路径（不进 pi 目录页，但可用）：`pi install git:github.com/NOknow95/paseo-todo`，已实测可加载并调用工具。

## 5. 命名与政策背景

- 目录页 https://pi.dev/packages 收录规则：**只索引 npm 包**，靠 `pi-package` keyword 自动发现。页面副标题原文 "published to npm"，50 个条目里 `pi install npm:` 出现 101 次、git 源 0 次。没有申请/PR/推荐旁路。
- npm 政策：*"tokens that bypass 2FA are being restricted — account changes (Aug 2026) and direct publishing (Jan 2027)"*。本账号已开 2FA，2027-01 后纯 token 免 2FA 发布会被拦，CI 发布届时需要改用 web/OTP 或 OIDC trusted publishing。
