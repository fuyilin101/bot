# 招聘岗位包与候选人电话包

岗位命令把 UTF-8 招聘需求转成寻访策略、岗位资料 ZIP 和通用电话指南。电话包命令读取同一版的 ZIP、指南和一份候选人简历，生成 JSON 和 Markdown。两条命令在本地读写文件，无需飞书账号、机器人或数据库。

## 安装与登录

先安装 Node.js 24 或更新版本（含 npm），解压后进入本目录。首次安装依赖需要访问 npm 注册表。

| 环境 | 安装 | 登录自己的 Codex 账号 | 无法打开浏览器时 |
| --- | --- | --- | --- |
| Windows PowerShell | `npm.cmd ci` | `npm.cmd run login` | `npm.cmd run login -- --device-auth` |
| macOS / Linux | `npm ci` | `npm run login` | `npm run login -- --device-auth` |

也可将空白模板 `.env.local-recruiting.example` 复制为 `.env.local-recruiting`，仅填写自己的 `RECRUITING_CODEX_API_KEY`。真实生成时会向模型提交招聘需求或电话包所需的岗位资料与简历，需要联网及可用凭证。登录凭证与 API Key 由使用者自行配置。

## 演示与离线检查

- Windows PowerShell 执行 `npm.cmd run demo`，macOS 或 Linux 执行 `npm run demo`。演示读取 `samples/input/JD.txt`、`samples/input/CV-A.txt` 和 `samples/input/CV-B.pdf`，依次生成岗位包、A 的电话包和 B 的电话包。三份输入均为合成样例。每步调用一次真实模型，完整运行共三次，输出到新的 `output/demo-*` 目录。
- Windows 执行 `npm.cmd test`，macOS 或 Linux 执行 `npm test`。这是使用 Mock 模型的离线冒烟测试，无需登录或模型凭证。
- `samples/reference/job/` 中有 `01_search_strategy.md`、`02_source_package.zip` 和 `03_call_guide.md`。`samples/reference/candidate-a/` 和 `samples/reference/candidate-b/` 各有原 `CALLPKG` 编号命名的 JSON 和 Markdown，可以直接打开查看。

## 用自己的文件运行

岗位输入为 UTF-8 `.txt`。简历接受 UTF-8 `.txt` 或可提取文字的 `.pdf`。扫描版 PDF 需先转换为文字。将以下命令中的 `./jd.txt` 和 `./cv.pdf` 换成自己的路径。

**Windows PowerShell**

```powershell
$job = npm.cmd --silent run job:local -- --input ./jd.txt --out ./output/jobs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw '岗位生成失败' }
npm.cmd --silent run call:local -- --zip $job.files[1] --guide $job.files[2] --cv ./cv.pdf --out ./output/calls
```

**macOS / Linux**

```sh
job_json=$(npm --silent run job:local -- --input ./jd.txt --out ./output/jobs)
if [ $? -ne 0 ]; then exit 1; fi
job_dir=$(printf '%s' "$job_json" | node -p 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).output_directory')
npm --silent run call:local -- --zip "$job_dir/02_source_package.zip" --guide "$job_dir/03_call_guide.md" --cv ./cv.pdf --out ./output/calls
```

将两个命令的标准输出解析为 JSON，使用 `output_directory` 和 `files` 取得实际路径。岗位命令按顺序返回 `01_search_strategy.md`、`02_source_package.zip` 和 `03_call_guide.md`。ZIP 与电话指南须来自同一次生成，保留原始字节。电话包命令返回同一包的 `<CALLPKG>.json` 和 `<CALLPKG>.md`。成功退出码为 `0`，参数不完整或格式错误为 `2`，读取、校验或生成失败为 `1`。

## 核对输出

- 对照岗位命令和电话包 JSON 中的 `job_id` 与 `job_version`。用完全相同的 ZIP 和指南给 A、B 生成电话包时，`job_package_id` 相同，`cv_id`、`request_id` 和 `package_id` 各自独立。
- 查看电话包 JSON 的 `template_version`（`R1-call-v3`）、`candidate_summary`、`requirements` 和 `risks`。`call_outline.priority_questions` 中的 `question`、`purpose`、`verification_criteria` 分别表示问什么、为什么问、怎么核实。Markdown 以相同结构展示内容。
- A 的合成经历写明参与或协助，重点核对实际责任范围。B 自述独立负责，重点核对独立决策、验收依据和结果。对照输出时保留自述与已核实信息的区别。

## 许可证

本项目使用 MIT 许可证。详情见 [LICENSE](LICENSE)。
