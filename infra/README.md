# 部署到阿里云

一台香港 ECS 同时跑三个容器：Nginx（网页和反向代理）、API、带 pgvector 的 Postgres。数据库和 API 端口不对公网开放。网页和接口都用同一个 `http://<公网 IP>`，所以不需要域名，也不需要备案。

SSE 缓冲在这一个 API 进程里。不要再加第二台机器分担流量。

密钥在本机 `infra/.deploy-secrets`，SSH 私钥在 `infra/.ssh-key`。这两个文件和 `terraform.tfstate` 已忽略，不要提交，也不要贴到聊天里。状态文件里有 SSH 私钥。

## 1. 准备账号

阿里云账号需要完成实名认证。在访问控制 RAM 里创建一个用户，授予 ECS 和 VPC 权限，然后创建 AccessKey。在本机终端配置，不要把密钥贴到聊天里：

```bash
export ALICLOUD_ACCESS_KEY="你的 AccessKey ID"
export ALICLOUD_SECRET_KEY="你的 AccessKey Secret"
export ALICLOUD_REGION="cn-hongkong"
```

百炼 Key 放在 `servers/my-llm-server/.env` 的 `DASHSCOPE_API_KEY`。`infra/deploy.sh` 第一次运行时会读取它，并生成数据库密码和登录签名密钥。

## 2. 创建云服务器

```bash
cd infra
terraform init
terraform apply
```

默认规格是 `ecs.e-c1m2.large`（2 核 4 GB）。如果报规格在香港不存在，改 `terraform.tfvars` 里的 `instance_type` 后重新 apply。按量付费，不用时在 `infra` 目录执行 `terraform destroy`。销毁会删掉这台机器上的数据库。

## 3. 发布应用

回到仓库根目录：

```bash
./infra/deploy.sh
```

脚本会在本机构建网页，把源码上传到服务器再构建 API 镜像，然后启动。完成后终端会打印 `http://<公网 IP>`。用坐席账号登录，在知识库上传 FAQ 并入库后，客户才能正常提问。

服务器第一次开机要安装 Docker，可能要几分钟。如果脚本提示 Docker 还没装好，等一会儿再运行一次。

## 网络

- 安全组只放行 80 和 SSH 22。Postgres 5432 和 API 3000 只在机器内的 Docker 网络里。
- 已知自己的公网 IP 时，把 `ssh_cidr` 改成 `x.x.x.x/32`。
- 大陆地域如果要用域名提供网站，需要先做 ICP 备案。当前默认地域是香港，用 IP 访问即可。
