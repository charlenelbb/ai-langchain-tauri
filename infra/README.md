# 部署到阿里云

一台香港 ECS 跑 k3s。里面只有一个 Nginx、一个 API、一个带 pgvector 的 Postgres。数据库和 API 不对公网开放，网页入口是 `http://charlenecloud.com`。服务器在香港，这个域名不需要备案。

客服的 SSE 缓冲在这一个 API 进程的内存里。API 固定 1 个副本，更新时先停旧进程再起新进程。不要把副本数改成大于 1，也不要再加第二台机器分担流量。

密钥在本机 `infra/.deploy-secrets` 和服务器 `/opt/ai-langchain/.env`。SSH 私钥在 `infra/.ssh-key`。这些文件和 `terraform.tfstate` 已忽略，不要提交，也不要贴到聊天里。状态文件里有 SSH 私钥。Kubernetes 的 Secret 只存在于服务器上。

## 1. 准备账号

阿里云账号需要完成实名认证。在访问控制 RAM 里创建一个用户，授予 ECS 和 VPC 权限，然后创建 AccessKey。在本机终端配置，不要把密钥贴到聊天里：

```bash
export ALICLOUD_ACCESS_KEY="你的 AccessKey ID"
export ALICLOUD_SECRET_KEY="你的 AccessKey Secret"
export ALICLOUD_REGION="cn-hongkong"
```

百炼 Key 放在 `servers/my-llm-server/.env` 的 `DASHSCOPE_API_KEY`。

## 2. 创建云服务器

```bash
cd infra
terraform init
terraform apply
```

默认规格是 `ecs.e-c1m2.large`（2 核 4 GB）。这台机器要同时跑 k3s 和三个业务容器，不要再加大副本。按量付费，不用时在 `infra` 目录执行 `terraform destroy`。销毁会删掉这台机器上的数据库。

## 3. 第一次切到 k3s

云服务器已经能通过 SSH 使用，并且 `/opt/ai-langchain/.env` 里已有数据库密码、`AUTH_SECRET`、百炼 Key 和 `CORS_ORIGIN` 时，在仓库根目录执行：

```bash
./infra/k8s/bootstrap.sh
```

脚本会安装 k3s（不启用 Traefik，不开放 6443）、在服务器上构建镜像、把现有 Compose 数据库导入 Kubernetes，再把网站切到 k3s。切换时网站会短暂停机。确认登录正常之前，不要删除原来的 Docker 卷。

## 4. 推送 main 即发布

GitHub Actions 在推送到 `main` 时跑单测、构建镜像并推到 GHCR，然后 SSH 到这台机器执行 `kubectl`。先在本机写入部署私钥，不要把私钥贴到聊天里：

```bash
gh secret set ECS_SSH_KEY < infra/.ssh-key
```

镜像仓库是 `ghcr.io/charlenelbb/ai-langchain-api` 和 `ghcr.io/charlenelbb/ai-langchain-web`。工作流会把这两个包设为公开，镜像里没有密钥。如果这一步失败，到 GitHub 的 Packages 页面把它们改成 Public，否则服务器拉不到镜像。

手动发布某个已经推上去的提交：

```bash
IMAGE_TAG=<commit sha> ./infra/deploy.sh
```

脚本会先拉取镜像，拉取成功后才替换容器。用坐席账号登录，在知识库上传 FAQ 并入库后，客户才能正常提问。

## 网络

- 安全组只放行 80 和 SSH 22。不要开放 Kubernetes 的 6443。Postgres 和 API 只在集群内部。
- 已知自己的公网 IP 时，把 `ssh_cidr` 改成 `x.x.x.x/32`。
- 大陆地域如果要用域名提供网站，需要先做 ICP 备案。当前服务器在香港，`charlenecloud.com` 解析到这台机器即可。
