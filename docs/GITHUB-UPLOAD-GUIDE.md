# GitHub 上传与部署指南

## 1. 已准备好的文件

项目会同时提供：

- 原始项目目录。
- `QIANYUSHI-LTL-V2-GITHUB.zip` 安全压缩包。

安全压缩包不包含：

- `.env.local`
- `API/`
- `node_modules/`
- `.next/`
- `tsconfig.tsbuildinfo`
- 其他 ZIP 或日志

压缩包包含 `.env.example`，但里面只有变量名称和占位符，没有真实密钥。

## 2. 上传前的安全检查

在任何上传方法中都必须确认：

- GitHub 仓库设置为 Private。
- 上传列表中没有 `.env.local`。
- 上传列表中没有 `API` 文件夹。
- 没有 Supabase Secret Key、Priority1 API Key 或 WWEX Client Secret。
- 没有 `node_modules` 和 `.next`。

如果 GitHub 发现 Secret Scanning 警告，不要选择忽略，先停止上传并轮换相关密钥。

## 3. 推荐方法：GitHub Desktop

这种方式对包含多个目录的 Next.js 项目最稳妥。

### 3.1 解压

1. 找到 `QIANYUSHI-LTL-V2-GITHUB.zip`。
2. 右键 → Extract All/全部解压。
3. 建议解压到 `C:\Users\huang\projects\qianyushi-ltl-v2`。

### 3.2 建立本地 Repository

1. 打开 GitHub Desktop。
2. 登录 GitHub。
3. File → Add Local Repository。
4. 选择刚才解压的项目目录。
5. 如果提示不是 Git Repository，点击 Create a Repository。
6. Name 填 `qianyushi-ltl-v2`。
7. Git Ignore 不需要另外选择，因为项目已经有 `.gitignore`。
8. 点击 Create Repository。

### 3.3 首次 Commit

1. 左下角 Summary 填：`Initial QIANYUSHI LTL V2 MVP`。
2. 检查 Changes，确认没有 `.env.local` 和 `API/`。
3. 点击 Commit to main。

### 3.4 发布到 GitHub

1. 点击 Publish repository。
2. Name 保持 `qianyushi-ltl-v2`。
3. Description 可填 `QIANYUSHI LTL quoting, BOL, pickup and deposit portal`。
4. 保持 Keep this code private 被选中。
5. 点击 Publish Repository。

完成后 GitHub 会显示整个项目文件，不需要把 ZIP 本身上传到仓库。

## 4. 方法二：GitHub 网页上传

适合不安装 GitHub Desktop，但文件较多时可能比 Desktop 慢。

1. 登录 GitHub。
2. 点击右上角 `+` → New repository。
3. Repository name 填 `qianyushi-ltl-v2`。
4. 选择 Private。
5. 不要勾选 Add README、`.gitignore` 或 License，因为项目已经包含。
6. 点击 Create repository。
7. 解压 ZIP。
8. 在空仓库页面点击 uploading an existing file。
9. 把解压目录中的所有文件和文件夹拖入上传区域；拖的是内容，不是最外层目录，也不是 ZIP。
10. 等待文件清单加载完毕。
11. 再次检查没有 `.env.local` 和 `API/`。
12. Commit message 填 `Initial QIANYUSHI LTL V2 MVP`。
13. 点击 Commit changes。

GitHub 网页单次上传可能受文件数量限制。如果失败，请改用 GitHub Desktop。

## 5. 方法三：命令行

在解压后的项目目录运行：

```powershell
git init
git add .
git status
git commit -m "Initial QIANYUSHI LTL V2 MVP"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/qianyushi-ltl-v2.git
git push -u origin main
```

执行 `git add .` 后一定先看 `git status`，确认没有敏感文件，再 Commit。

如果提示需要登录，按照 GitHub 浏览器登录或 Personal Access Token 提示完成。不要把 Token 写入项目文件。

## 6. 上传后检查

打开 GitHub 仓库并检查：

- README 在首页正确显示。
- `src/`、`public/`、`outputs/`、`docs/` 都存在。
- `.env.example` 存在。
- `.env.local` 不存在。
- `API/` 不存在。
- `node_modules/` 和 `.next/` 不存在。
- Repository 右上方标记为 Private。

## 7. 后续更新代码

GitHub Desktop：

1. 查看 Changes。
2. 填写简短 Commit Summary。
3. Commit to main。
4. Push origin。

建议每次 Commit 只包含一个清楚的主题，例如：

```text
Fix Priority1 duplicate booking recovery
Add customer deposit ledger
Improve ZIP city selection
Update bilingual help text
```

## 8. 建议的 Branch 流程

当前只有一位开发者时可以直接使用 `main`。准备生产上线后建议：

- `main`：已验收、可部署版本。
- `develop`：日常集成。
- `feature/...`：单个功能。
- `fix/...`：问题修复。

重大修改通过 Pull Request 合并到 `main`，并在 PR 中写清数据库变化、测试结果和回滚方法。

## 9. 可选：部署到 Vercel

代码上传 GitHub 后：

1. 登录 Vercel。
2. Add New → Project。
3. Import `qianyushi-ltl-v2`。
4. Framework 自动识别为 Next.js。
5. 在 Environment Variables 中逐项添加 `.env.local` 的变量。
6. 不要上传 `.env.local` 文件。
7. 第一次只配置沙盒 Carrier API。
8. 点击 Deploy。

必须配置的变量见 `.env.example`。

部署完成后：

- 把 Vercel 正式 URL 添加到 Supabase Auth 的 Site URL/Redirect URLs。
- 用测试客户完成登录、报价、保存 Quote。
- Generate BOL 会产生承运商沙盒记录和押金扣款，必须在明确的测试单上执行。

## 10. 从 GitHub 恢复到新电脑

```powershell
git clone https://github.com/YOUR_GITHUB_NAME/qianyushi-ltl-v2.git
cd qianyushi-ltl-v2
pnpm install
Copy-Item .env.example .env.local
pnpm typecheck
pnpm build
pnpm dev
```

然后把真实环境变量重新填入 `.env.local`。真实密钥应从密码管理器或平台后台获取，不能从 GitHub 获取。

## 11. 误传密钥后的处理

如果误上传 `.env.local` 或 API 凭据：

1. 立即把 Repository 改为 Private，但这一步不能代替密钥轮换。
2. 在 Supabase、Priority1、WWEX 后台吊销旧密钥并生成新密钥。
3. 更新本地和部署平台的环境变量。
4. 从 Git 历史彻底移除敏感文件。
5. 检查是否出现未授权访问或异常承运商请求。
6. 不要继续使用旧密钥。

删除 GitHub 当前页面上的文件并不等于从 Git 历史删除，也不等于密钥安全。
