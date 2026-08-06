# Krea 2 · RunningHub 调用台

这是一个纯前端的 RunningHub 工作流调用页面，已按工作流 `2080711492936511490` 配置可编辑参数：正/负提示词、尺寸、批次、采样参数和运行实例。

## 启动

请从 `D:\RH` 目录启动一个本地 HTTP 服务后打开页面，避免浏览器以 `file://` 协议限制网络请求：

```powershell
python -m http.server 5173
```

访问 `http://localhost:5173`，粘贴自己的 RunningHub API Key，即可开始生成。

## 工作方式

- 提交：`POST /openapi/v2/run/workflow/2080711492936511490`
- 查询：每 3 秒轮询 `POST /openapi/v2/query`，最多 10 分钟
- 输出：检测到 ZIP 结果后，在浏览器中下载并使用 JSZip 解压，将其中的 PNG/JPG/WebP/GIF/AVIF 图片展示在结果区域；也保留原 ZIP 下载入口。

API Key 在右上角的“API 设置”中填写。只有在你点击“保存设置”后，才会写入此浏览器的 `localStorage`；项目文件不含任何 API Key。请勿在公共电脑保存密钥。
