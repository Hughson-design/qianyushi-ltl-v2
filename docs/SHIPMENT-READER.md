# 资料识别 / Shipment reader

入口：侧栏 **资料识别 / Shipment reader**，或 `/shipment-reader`。沿用平台登录权限。

1. 粘贴文字，或在页面按 Ctrl+V 粘贴截图；也可点击「上传文件」或拖入文件。
2. 每次处理一票货，最多 5 个文件，文字与文件合计最多 2.5 MB。文字最多 25,000 字符。
3. 图片、PDF、Excel（xls/xlsx）、Word（doc/docx）需勾选「AI识别」。普通文字和 TXT/CSV/TSV 可使用普通解析，不调用 OpenAI。
4. 点击「开始识别」，查看可编辑的标准文字、路线、数量、尺寸、重量和提醒。
5. 核对托数与件数、单托与总重量、单位、地址及附加服务。缺失资料需要补充，不能凭空确定。
6. 勾选已核对后，点击「确认并带入询价」。这里只填入询价表单；仍需手动点击 Get rates 才会调用承运商。

## 管理员配置

在 Vercel 项目的 Environment Variables 中，添加服务器变量 `OPENAI_API_KEY`，只选择所需部署环境。不要使用 `NEXT_PUBLIC_` 前缀，不要把密钥提交 GitHub。保存后重新部署。

资料识别固定使用 `gpt-6-luna`，不再接受旧的模型环境变量覆盖，不会在失败后自动切换付费模型。

## 限制与数据处理

Excel `.xlsx` 先由服务器读取真实单元格和表头单位，再发送文字给 AI，保留合并区域下的续行。单件重量与整票总重量分开处理，不把汇总行作为新货物；同尺寸但不同重量不能合并。每个工作表最多 1,000 行，超过时要求拆分文件。嵌入图片仍需另传截图。

识别后可在“在这里补全或修改货物”中逐行编辑包装数量、件数、长宽高、尺寸单位、每包装重量及重量单位。点击“应用货物修改”后，预览和询价文字同步更新，再勾选核对确认。未应用修改、非正尺寸/重量或不完整地址会阻止带入询价。地址和服务要求可在“可编辑的询价文字”中修改。

- AI模式会将所提交的文字及文件发送给 OpenAI。请求使用 `store: false`；这不等于供应商没有适用的数据保留政策。本站不把原文件写入数据库或文件存储。
- 核对后带入的询价文字，只有用户点击 Get rates 时才沿用现有 Quote input 记录流程保存。
- Excel 每个工作表最多处理前 1,000 行。请只上传这一票的内容，不用于批量处理多票或完整工作簿统计。
- Word/Excel 只提取可读文本；嵌入图片和图表请另传截图，或转成 PDF。加密、损坏、过大的文件应先整理。
- 家庭/商业地址、尾门和预约只从明确文字提取，不凭照片或地址外观推断。收货地址验证继续使用现有 Google 流程。
- 资料有歧义时，识别结果仅作草稿，必须人工核对。一次包含多条路线时要求拆分，不合并成一票。
- 服务端检查登录、来源、文件类型、数量、大小和输出结构；AI 请求有 50 秒超时，以及每进程每用户每分钟 6 次的节流。该节流不是跨实例全局费用上限，生产预算应在 OpenAI 设置。

官方接口说明：[File inputs](https://developers.openai.com/api/docs/guides/file-inputs)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

验证：`node --test tests/shipment-reader.test.cjs`，`pnpm build`。自动测试使用模拟服务，不向 OpenAI 或承运商发送真实请求。

## GPT-6 Luna 用量保护（2026-11-20）

先运行 `outputs/supabase-enable-ai-budget.sql`，再部署代码。已在生产库安装，并用 `outputs/verify-ai-budget.sql` 的临时表和回滚验证。

本站所有客户/服务器共享每日 200,000 token 保护额度。先调用 OpenAI 免费输入计数接口，计数包含同一份 instructions、图片/文件及 JSON schema，再预留输入量 + 6,000 最大输出 + 512 安全余量。余额不足不发起推理；失败不自动更换模型。完整响应按 usage.total_tokens 结算，超时或无法确认时保守记录完整预留；重复结算不能减回额度。数据库不可用则停止 AI，普通文字解析仍可使用。

页面显示模型、保护用量、预留和余量；保护额度不足、服务商账单/余额不足、临时限流分别提示。每日 UTC 00:00 重置，计数器不因部署、重启、切换设备而清零。

这是本站保护计数，不是 OpenAI 组织账单。GPT-6 Luna 的 Build 共享免费组为每日 250,000 tokens，本站预留了 50,000 余量，但其他应用/模型使用同组、资格或共享设置改变仍可能造成计费，不能承诺跨应用零费用。不要把平台的普通 429 限流当成免费额度耗尽。

参考：https://developers.openai.com/api/docs/guides/token-counting ，https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai
