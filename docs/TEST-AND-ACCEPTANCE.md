# 测试与验收清单

## 1. 每次上传前自动检查

```powershell
pnpm install
pnpm typecheck
pnpm build
```

通过标准：命令 Exit Code 为 0，Next.js 列出全部页面和 API Route。

## 2. 登录与权限

- [ ] 无用户的全新数据库显示首次管理员创建。
- [ ] 管理员可登录、退出。
- [ ] 错误密码显示清楚提示。
- [ ] Customer 看不到 Customers 和 Settings 管理入口。
- [ ] Admin/Operations 可切换客户。
- [ ] 普通 Customer 无法通过手工 API 请求读取其他客户资料。
- [ ] 停用用户无法继续使用系统。
- [ ] 当前登录用户不能删除自己。
- [ ] 初始化密码少于 8 位时按钮不可用或接口拒绝。

## 3. 客户管理

- [ ] 创建客户后自动建立 Deposit Account。
- [ ] Customer Code 唯一。
- [ ] 可修改加价率、最低加价、自助出单权限。
- [ ] 内部 QIANYUSHI 客户不可删除。
- [ ] 有用户、Quote、地址或交易的客户不可删除。
- [ ] 停用客户后其用户不能继续访问。

## 4. Smart Quote

- [ ] 第一行填 Sender，第二行填 Receiver。
- [ ] 中英文 Commercial/Residential 可识别。
- [ ] Liftgate/尾门可识别并选中正确方向。
- [ ] Appointment/预约可识别。
- [ ] `165×78×87cm` 正确转为 inch 并四舍五入。
- [ ] `96kg` 正确转为 lb 并四舍五入。
- [ ] 第三行以后逐行建立 Freight Line。
- [ ] Pallet/Carton/Crate/Bale/Roll/Loose 正确识别。
- [ ] Non-stackable 正确关闭 Stackable。
- [ ] 解析失败不会清空用户原始文本。

## 5. Route 与 ZIP

- [ ] ZIP 仅接受 5 位数字。
- [ ] 91710 返回 CA 并提供多个可用城市时显示下拉。
- [ ] 91765 返回 CA 并提供多个可用城市时显示下拉。
- [ ] 默认选择城市列表第一项。
- [ ] 用户可选择其他城市。
- [ ] Postal Code、State/Prov、City 同一行。
- [ ] Ship From、Ship To、Date 同高。

## 6. Freight Details

- [ ] 页面只显示 inch/lb。
- [ ] Pallets、L/W/H、Unit Weight 必须大于 0。
- [ ] Total Weight 自动等于 Pallets × Unit Weight，且不可编辑。
- [ ] Class 自动随尺寸/重量改变，且不可编辑。
- [ ] Add Freight Line 可增加多行。
- [ ] 多行时 Remove 位于 Line 下方最前面。
- [ ] Hazmat 默认 No。
- [ ] Stackable 默认 Yes。
- [ ] Declared Value 显示美元。

## 7. 报价

- [ ] WWEX 和 Priority1 同时启用时均发出请求。
- [ ] 一个 Provider 失败时，另一个仍显示报价。
- [ ] 每个 Provider 最多显示最低 5 个。
- [ ] 最终列表按 Customer Price 排序。
- [ ] Cheapest/Fastest 标签正确。
- [ ] 客户看不到成本价。
- [ ] 客户价满足百分比与最低加价的较高值。
- [ ] 两个 Provider 都禁用时 Settings 拒绝保存。

## 8. Booking Details

- [ ] Continue to Booking 有响应。
- [ ] Address 3 不存在。
- [ ] Sender/Receiver 必填项未完成时不能保存。
- [ ] Postal Code 自动填写 State/City。
- [ ] Sender/Receiver 标题旁有 Address Book。
- [ ] Save to Address Book 可保存并复用。
- [ ] Reference/PO 正确保存。
- [ ] Save Booking Details 后 Quote 状态为 Draft。
- [ ] 保存 Draft 不扣押金、不提交承运商。

## 9. Deposit

- [ ] 管理员可增加押金并填写 Reason。
- [ ] 负数调整不能使余额小于 0。
- [ ] Customer 只能看到自己余额和流水。
- [ ] Generate BOL 只扣一次。
- [ ] 安全失败会产生一次 Booking Release。
- [ ] Void 成功只退款一次。
- [ ] 每条流水 Balance After 正确。

## 10. Generate BOL 与 Pickup

- [ ] Booking Details 和 Quotes 两处均可 Generate BOL。
- [ ] 点击后出现应用内确认弹窗。
- [ ] 确认前显示将扣金额。
- [ ] 余额不足时不提交承运商。
- [ ] 成功后 Quote 状态变为 Booked。
- [ ] 保存 BOL Number、Provider Shipment ID、Pickup ID。
- [ ] Orders 页面可找到该订单。
- [ ] WWEX BOL 可下载。
- [ ] Priority1 同 Reference 重试前先查询现有记录。
- [ ] 恰好一条完整现有记录时自动恢复而不重复 Dispatch。
- [ ] 多条 Priority1 记录时停止并提示人工核对。

## 11. Void

- [ ] 只有 Booked 可 Void。
- [ ] 先取消承运商 Shipment/Pickup。
- [ ] 承运商成功后本地状态变为 Void。
- [ ] 押金全额退回并生成 `VOID_REFUND`。
- [ ] 承运商失败时状态仍为 Booked，押金不退。
- [ ] 再次点击不能重复退款。

## 12. 已执行的沙盒验收记录

### WWEX / ESTES

- Quote：`Q-20260913-6C8FCE`
- Reference：`CODEX-E2E-WWEX-20260912-02`
- BOL：`NUD34778781`
- 结果：BOL 与 Pickup 成功，押金扣款成功。

### Priority1 / ABF

- Quote：`Q-20260914-B25E24`
- Reference：`CODEX-E2E-ABF-20260913-01`
- Provider Shipment ID：`10564156`
- BOL：`60016048142`
- Pickup：`WWW0000000`
- Provider Status：`Dispatched`
- 同 Reference Provider Shipment 数量：`1`
- Customer Price/Deposit Deduction：`$530.47`
- 结果：恢复既有 Provider 运单并完成本地订单，没有重复 Dispatch。

### Priority1 / R&L 异常记录

- Reference：`CODEX-E2E-20260912-01`
- Provider 曾创建两个 R&L Shipment，但响应出现 `EBolUrl` 字段异常且无 Pickup Identifier。
- 本地预扣已释放，最终没有保留扣款。
- 当前版本已加入 Reference 查重；发现多条记录时拒绝继续提交。

## 13. 生产上线验收

生产 API 启用前必须额外完成：

- [ ] 确认所有 API Base 指向生产环境。
- [ ] 确认 Secret 只存在部署平台环境变量。
- [ ] 每个 Provider 使用一条可撤销、金额可控的真实测试。
- [ ] 核对报价成本与 Provider 后台一致。
- [ ] 核对客户加价。
- [ ] 核对 BOL 内容中的地址、Class、重量和服务。
- [ ] 核对 Pickup Date/Ready/Close Time。
- [ ] 核对 Void 后 Provider 后台确实取消。
- [ ] 核对押金扣款/退款。
- [ ] 检查服务器日志中没有密钥、Token 或完整个人资料。
- [ ] 建立数据库备份和紧急回滚流程。

## 14. Bug 报告格式

每个问题至少记录：

- 页面和操作步骤。
- 使用角色与客户。
- Quote Number、Reference、Provider 和 Carrier。
- 期望结果。
- 实际结果。
- 页面错误文字。
- 发生时间和时区。
- 是否可能已在承运商后台创建 Shipment。
- 押金是否变化。
- 截图，但必须遮挡 API Key、密码和私人资料。

涉及 Generate BOL 超时或 5xx 时，不要立即重复点击，应先按 Reference 在承运商后台或 Status API 查询。
