# Vercel 环境变量配置清单

登入 Vercel Dashboard，找到你的 maocamera-ltd 项目，进入 **Settings > Environment Variables**，按下列内容逐一添加：

## 生产环境（Production）和 Staging 都要配置

| 变量名 | 说明 | 示例值 |
|--------|-----|--------|
| `AUTHORIZE_ENVIRONMENT` | 支付网关环境 | `sandbox` 或 `production` |
| `AUTHORIZE_API_LOGIN_ID` | Authorize.net API 账号 | `479YRjy45yHL` |
| `AUTHORIZE_TRANSACTION_KEY` | Authorize.net 交易密钥 | `4mk36GKC526W7jM5` |
| `AUTHORIZE_SIGNATURE_KEY` | Authorize.net 签名密钥（用于 webhook 验签） | `12BA4A90EC4EF8805744A0C8CE29044125E2DF9F4D...（完整 hex 字符串）` |
| `AUTHORIZE_CLIENT_KEY` | Authorize.net 前端加密密钥（可选，目前未使用） | `523P73884w5zntYjfDCsV627CejBvsVCLZMPcQq4RN...` |
| `REDIS_URL` | Redis/KV 存储连接串 | `redis://default:密码@主机:端口` |
| `AUTHORIZE_RETURN_BASE_URL` | 支付成功/取消后回跳域名（必须是 https） | `https://maocamera-ltd.vercel.app` 或你的正式域名 |
| `AUTHORIZE_WEBHOOK_DEBUG` | Debug 日志开关 | `false` （生产环境）或 `true`（开发/测试） |

## Webhook 配置（在 Authorize.net 后台）

1. 登入 Authorize.net 账号 → **Account > Webhooks**
2. 添加新的 Webhook Endpoint：
   - **URL**: `https://maocamera-ltd.vercel.app/api/webhook` （改成你的域名）
   - **Events**: 至少选择 `net.authorize.payment.authcapture.created` 和 `net.authorize.payment.capture.created`
3. 保存后，Authorize.net 会生成和显示 **Webhook ID** — 记住这个，验签要用

## 库存初始化

部署成功后，访问以下 URL 一次，把商品库存从 `data/products.json` 同步到 Redis：

```
https://maocamera-ltd.vercel.app/api/init-kv
```

预期响应：
```json
{
  "success": true,
  "message": "maocamera ltd 数据库已与 JSON 完成同步！",
  "syncedItems": [...]
}
```

## 健康检查

部署完毕后可访问以下两个端点校验就绪状态：

- `https://maocamera-ltd.vercel.app/api/webhook-health` — 检查所有必需的环境变量
- `https://maocamera-ltd.vercel.app/api/webhook-health?deep=1` — 额外执行 Redis PING 测试

## 付款流程验证

1. 打开你的线上网站
2. 在商店里添加商品到购物车
3. 进入购物车页，点 **CHECKOUT**
4. 应该被引导到 Authorize.net Accept Hosted 支付页
5. 在 Sandbox 环境下可以用测试卡号：
   - **卡号**: 4111111111111111
   - **有效月/年**: 任意未来日期（如 12/30）
   - **CVV**: 任意 3 位数字（如 123）
6. 支付完成后应该跳回成功页，库存自动扣减

## 注意事项

- `AUTHORIZE_SIGNATURE_KEY` 是 webhook 签名校验的关键，不要泄露
- `AUTHORIZE_RETURN_BASE_URL` 必须是公网 HTTPS URL，不能是 localhost
- 如后期想换成生产环境，需要在 Authorize.net 后台申请生产账号，更新所有凭据并改 `AUTHORIZE_ENVIRONMENT=production`
