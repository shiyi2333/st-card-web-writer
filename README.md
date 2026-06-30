# ST Card Web Writer

移动端优先的 SillyTavern 角色卡写卡器。适合在 Windows、Linux、Termux 上运行，默认端口 `5679`。

## 功能

- 模型和 API Key 管理：保存、编辑、切换、拉取远端模型。
- 提示词管理：保存多套写卡提示词，随时切换和编辑。
- 对话存档：所有对话和消息保存在本地 `data/store.json`。
- 新版角色卡生成：使用 Markdown 章节和 Tavern Card V2 JSON，不再使用旧 `<<NAME>>` 标记。
- 角色卡预览：按章节预览名称、描述、性格、场景、开场白、作者备注、标签、绘图标签等内容。
- 单节修改：点击预览里的任意章节，会自动把 `[修改:章节名]` 填入输入框。
- 导出：可导出 Markdown、JSON；上传 PNG 底图后可导出带 `chara` 数据块的 SillyTavern PNG 卡。
- 移动端适配：底部标签栏，适合手机浏览器和 Termux 本机服务。

## 快速开始

```bash
npm install
npm start
```

打开：

```text
http://localhost:5679
```

也可以直接运行根目录脚本：

```bash
./start-writer.sh
```

Windows 可双击 `start-writer.bat`。脚本默认使用 `5679`，如果端口被其他程序占用，会自动尝试后续端口。

局域网访问时用设备 IP：

```text
http://<你的设备IP>:5679
```

## 配置

复制环境变量示例：

```bash
cp .env.example .env
```

默认：

```text
PORT=5679
HOST=0.0.0.0
STORE_PATH=./data/store.json
EXPORT_DIR=./exports
```

## Termux

```bash
pkg install nodejs git
git clone <repo-url>
cd st-card-web-writer
./start-writer.sh
```

然后用手机浏览器打开 `http://127.0.0.1:5679`。

如果执行过 `termux-setup-storage`，默认工作区会优先使用 `~/storage/downloads/角色卡`，导出的 PNG/JSON/Markdown 会落在手机下载目录下面。也可以在设置页点“使用设备默认目录”重新填入设备路径。

## 数据文件

- `data/store.json`：模型配置、API Key、提示词、对话记录。
- `exports/`：导出的 Markdown、JSON、PNG。

这些文件默认不提交到 Git。

## API 根路径

模型配置里的 API 根路径按服务填写：

- DeepSeek: `https://api.deepseek.com`
- OpenAI: `https://api.openai.com/v1`
- 其他 OpenAI 兼容服务：填写其兼容接口根路径。

## 角色卡格式

AI 输出应使用这些标题：

```text
# 名称
# 描述
# 性格
# 场景
# 开场白
# 作者备注
# 标签
# 绘图标签
```

可选：

```text
# 示例对话
# 系统提示词
# 备用开场白
```

默认规则与 OpenClaw 里的角色卡技能保持一致：默认不要状态栏；标签最多十个；作者备注写成轻小说/网文式玩家导语；绘图标签使用 Danbooru 英文 tags。

## License

MIT
