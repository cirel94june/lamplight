# Lamplight VPS 部署方案

> 时机：等居住闭环（#26-#31）大致完工后执行。现在写好方案备用。
> 目标：小猫从手机、公司电脑、家里电脑都能访问同一个 Lamplight。

---

## 部署环境

**VPS**：`172.245.180.158`（RackNerd Ubuntu 24.04，跟 Memory Hub 同一台）

**现有基建**（可直接复用）：
- Caddy（自动 HTTPS）
- Cloudflared（Cloudflare tunnel）
- systemd（进程管理）
- Memory Hub 已跑在 `xiaokememory.camdvr.org`

---

## 部署布局

| 项 | 值 |
|---|---|
| 域名 | `lamplight.xiaokememory.camdvr.org`（子域名前缀，跟 Memory Hub 同域） |
| 代码位置 | `/opt/lamplight/`（与 `/opt/memory-hub/` 平级） |
| 服务名 | `lamplight.service`（systemd） |
| 内部端口 | 8787（不裸露公网，Caddy 反代） |
| 数据库 | `/opt/lamplight/data/lamplight.db`（SQLite） |
| 静态资源 | `/opt/lamplight/apps/web/dist/`（Vite build 产物） |
| 备份 | `/opt/lamplight/backups/`（每日 3:00 UTC，保留 30 天） |
| 环境变量 | systemd `Environment=` 或 `/etc/lamplight/env`（不进 git） |

---

## Caddy 配置追加

在 `/etc/caddy/Caddyfile` 末尾追加：

```caddy
lamplight.xiaokememory.camdvr.org {
    # 静态前端资源
    handle_path /* {
        root * /opt/lamplight/apps/web/dist
        try_files {path} /index.html
        file_server
    }

    # API 请求反代到后端
    handle /api/* {
        reverse_proxy localhost:8787
    }

    # WebSocket
    handle /ws {
        reverse_proxy localhost:8787
    }

    # 素材 / assets
    handle /assets/* {
        reverse_proxy localhost:8787
    }
}
```

*具体路径匹配根据 apps/api 实际路由结构调整。*

---

## systemd 服务文件

`/etc/systemd/system/lamplight.service`：

```ini
[Unit]
Description=Lamplight
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lamplight/apps/api
EnvironmentFile=/etc/lamplight/env
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

*具体 ExecStart 命令按 apps/api 的启动方式定。也可以 build 成 JS 然后 `node dist/index.js`。*

---

## 环境变量文件

`/etc/lamplight/env`（chmod 600）：

```
PORT=8787
OWNER_TOKEN=<小猫的登录密码，部署时生成 32 字符随机串>
DATABASE_URL=file:/opt/lamplight/data/lamplight.db
NODE_ENV=production
# API keys 不进这里，走 Settings 页面 + api_providers 表（Phase 1 之后）
```

---

## 备份脚本

`/opt/lamplight/backups/backup.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%d-%H%M%S)
DEST="/opt/lamplight/backups/lamplight-$STAMP.db"
cp /opt/lamplight/data/lamplight.db "$DEST"
# 保留 30 天
find /opt/lamplight/backups -name 'lamplight-*.db' -mtime +30 -delete
```

cron（`crontab -e`）：

```
0 3 * * * /opt/lamplight/backups/backup.sh >> /var/log/lamplight-backup.log 2>&1
```

---

## 部署脚本 auto-deploy.sh（参照 memory-hub 现有的）

`/opt/lamplight/auto-deploy.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/lamplight
git fetch origin main
git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm --filter @lamplight/contracts build
pnpm --filter @lamplight/domain build
pnpm --filter @lamplight/api-client build
pnpm --filter @lamplight/web build
pnpm --filter @lamplight/api build   # 如果 API 需要 build
systemctl restart lamplight
echo "Deployed at $(date -u +%FT%TZ)"
```

未来可以配 GitHub webhook 触发自动部署，也可以纯手动 SSH 上去跑。

---

## 部署首次上线 checklist

1. `ssh root@172.245.180.158`
2. `git clone https://github.com/cirel94june/lamplight.git /opt/lamplight`
3. 安装 Node 22+（VPS 上大概率已有）+ pnpm
4. 建 `/opt/lamplight/data/` 和 `/opt/lamplight/backups/` 目录
5. 生成 OWNER_TOKEN 随机串，写入 `/etc/lamplight/env`
6. `pnpm install` + 各 package build
7. 初始化数据库（跑 migrations）
8. seed 三位居民数据（agent_profiles + agent_model_bindings + api_providers）
9. 写 systemd service，`systemctl enable --now lamplight`
10. 追加 Caddy 配置，`systemctl reload caddy`
11. 配 DNS：`lamplight.xiaokememory.camdvr.org` 指向 VPS
12. 部署备份 cron
13. 手机浏览器打开测试

---

## 小猫在部署过程中要做什么

**理想情况：只需要说三次 ok**：

1. 部署方案 ok（本文档）
2. OWNER_TOKEN 生成好告诉你，你在设备上登录时输一次
3. 部署完了测试三个设备能不能连上，能就 ok

**其他所有技术操作 Claude / 施工方代劳**。

---

## 后续演进

- **多用户支持**：现在假设只有小猫一个人用（OWNER_TOKEN 单密钥）。将来如果 Ceci 妈妈也要用，改成多账号系统
- **多实例扩展**：现在单进程内存锁够用；如果流量涨到一台机器扛不住，需要把 `conversationLocks` 迁移到 Redis 或 DB 锁
- **数据库升级**：SQLite 单文件很稳，如果将来数据量 > 10GB 或需要多实例并发写，考虑迁到 Postgres

暂时都不用管。
